// ============================================================================
// src/lsp/index.ts — diagnose(file): spawn the right LSP server, get diagnostics.
//
// Ties the pieces together: resolveServer() picks an installed server, a real
// Content-Length stdio transport drives an LspSession, and diagnostics come back
// converted + human-1-based. Servers are POOLED per (binary, workspace) and
// reused across calls — re-opening a file becomes a didChange, so the agent's
// repeated "edit → check" loop pays the (slow) server init only once. Graceful at
// every step: no server installed / spawn fails / silent server → a clear message,
// never a crash.
// ============================================================================
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { getRepoRoot } from '../worktree.js';
import { encode, LspDecoder } from './framing.js';
import { LspSession, waitForDiagnostics, type Diagnostic, type LspTransport } from './client.js';
import { resolveServer } from './servers.js';

// รวม Windows-critical (SystemRoot/windir/PATHEXT/ComSpec/USERPROFILE/LOCALAPPDATA/TMP) —
// ถ้าขาด SystemRoot/PATHEXT โปรเซสลูกบน Windows มัก spawn ไม่ขึ้น/หา .cmd ไม่เจอ
const SAFE_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'TERM', 'NODE_PATH', 'NVM_DIR',
  'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'SystemRoot', 'SystemDrive', 'windir', 'PATHEXT', 'ComSpec',
];
function safeEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SAFE_ENV_KEYS) {
    const v = process.env[k];
    if (v != null) out[k] = v;
  }
  return out;
}

/** real stdio transport: spawn the server, frame with Content-Length both ways. */
function spawnTransport(binPath: string, args: string[], cwd: string): { transport: LspTransport; proc: ChildProcess } {
  // Windows: LSP bin มัก resolve เป็น .cmd shim → spawn ตรงไม่ขึ้น ต้อง shell
  const proc = spawn(binPath, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: safeEnv(), shell: process.platform === 'win32' });
  const decoder = new LspDecoder();
  let handler: ((m: Parameters<LspTransport['onMessage']>[0] extends (m: infer M) => void ? M : never) => void) | null = null;
  proc.stdout?.on('data', (buf: Buffer) => {
    for (const m of decoder.push(buf)) handler?.(m as never);
  });
  proc.stdout?.on('error', () => {});
  proc.stderr?.on('data', () => {}); // swallow server logs (stdout is the protocol)
  proc.stdin?.on('error', () => {}); // guard EPIPE if the server dies
  const transport: LspTransport = {
    send: (msg) => {
      if (proc.stdin?.writable) proc.stdin.write(encode(msg));
    },
    onMessage: (cb) => {
      handler = cb as typeof handler;
    },
    close: () => {
      try {
        proc.kill();
      } catch {
        /* already dead */
      }
    },
  };
  return { transport, proc };
}

interface Pooled {
  session: LspSession;
  proc: ChildProcess;
  opened: Map<string, number>; // uri → last version
}
const pool = new Map<string, Pooled>(); // key = binPath\0rootUri
let exitHooked = false;

function hookExitOnce(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.on('exit', closeAllServers);
}

export interface DiagnoseResult {
  ok: true;
  serverId: string;
  diagnostics: Diagnostic[];
}
export interface DiagnoseUnavailable {
  ok: false;
  reason: string;
}

export interface DiagnoseOptions {
  cwd?: string;
  content?: string; // diagnose this in-memory content instead of reading from disk (e.g. unsaved edits)
  settleMs?: number;
  timeoutMs?: number;
}

/**
 * Get language-server diagnostics for a file. Returns {ok:false,reason} when no
 * server is configured/installed or the server can't start; otherwise the
 * (possibly empty) diagnostics list. Never throws.
 */
export async function diagnose(filePath: string, opts: DiagnoseOptions = {}): Promise<DiagnoseResult | DiagnoseUnavailable> {
  const cwd = opts.cwd ?? process.cwd();
  const abs = resolvePath(cwd, filePath);
  const resolved = await resolveServer(abs, cwd);
  if ('unavailable' in resolved) return { ok: false, reason: resolved.unavailable };

  const rootUri = pathToFileURL((await getRepoRoot(cwd)) ?? cwd).toString();
  const key = `${resolved.binPath}\0${rootUri}`;
  hookExitOnce();

  let pooled = pool.get(key);
  if (!pooled) {
    let proc: ChildProcess | undefined;
    try {
      const t = spawnTransport(resolved.binPath, resolved.def.args, cwd);
      proc = t.proc;
      const session = new LspSession(t.transport);
      let died = false;
      proc.on('exit', () => {
        died = true;
        pool.delete(key);
      });
      // timeout: server ที่ค้าง (ไม่ตอบ initialize) ไม่ทำ diagnose แฮงค์ + reject → catch kill child กัน leak
      await Promise.race([
        session.initialize(rootUri),
        new Promise((_, rej) => setTimeout(() => rej(new Error('initialize timeout (8s)')), 8000)),
      ]);
      if (died) return { ok: false, reason: `${resolved.def.command} ออกก่อนเริ่มงาน (ติดตั้งครบไหม?)` };
      pooled = { session, proc, opened: new Map() };
      pool.set(key, pooled);
    } catch (e) {
      pool.delete(key);
      try {
        proc?.kill(); // init ล้ม/timeout → kill child + ปิด stdio pipes กัน orphan/leak
      } catch {
        /* already dead */
      }
      return { ok: false, reason: `เริ่ม ${resolved.def.command} ไม่สำเร็จ: ${(e as Error).message}` };
    }
  }

  let text = opts.content;
  if (text == null) {
    try {
      text = await readFile(abs, 'utf8');
    } catch (e) {
      return { ok: false, reason: `อ่านไฟล์ไม่ได้: ${(e as Error).message}` };
    }
  }

  const uri = pathToFileURL(abs).toString();
  const waitOpts = { settleMs: opts.settleMs, timeoutMs: opts.timeoutMs };
  // subscribe before sending open/change so we never miss an early publish
  const wait = waitForDiagnostics(pooled.session, uri, waitOpts);
  const prevVersion = pooled.opened.get(uri);
  if (prevVersion == null) {
    pooled.opened.set(uri, 1);
    pooled.session.didOpen(uri, resolved.languageId, text);
  } else {
    const version = prevVersion + 1;
    pooled.opened.set(uri, version);
    pooled.session.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }], // full-document sync
    });
  }
  const diagnostics = await wait;
  return { ok: true, serverId: resolved.def.id, diagnostics };
}

/** shut down all pooled servers (called on process exit). */
export function closeAllServers(): void {
  for (const p of pool.values()) p.session.close();
  pool.clear();
}
