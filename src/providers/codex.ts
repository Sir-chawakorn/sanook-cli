import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Codex delegate provider — spawn official `codex exec` (ChatGPT plan quota)
// ToS-safe: the user runs `codex login` via the official binary; Sanook only invokes that binary
// (ไม่ reuse/impersonate OAuth token, ไม่ reverse-engineer — เป็น official client จริง)
// ─────────────────────────────────────────────────────────────────────────────

export interface CodexStatus {
  installed: boolean;
  loggedIn: boolean;
  reason?: string;
}

export function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
}

/** เช็กว่า codex CLI ติดตั้ง + login ChatGPT แล้ว */
export async function detectCodex(): Promise<CodexStatus> {
  const hasBinary = await new Promise<boolean>((resolve) => {
    const p = spawn('codex', ['--version'], { shell: process.platform === 'win32' });
    // timeout: binary ค้าง (shim รอ stdin / Gatekeeper stall ตอนรันครั้งแรกบน macOS) → ไม่ให้ wizard ตัน
    const timer = setTimeout(() => {
      p.kill();
      resolve(false);
    }, 5000);
    p.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
  if (!hasBinary) {
    return { installed: false, loggedIn: false, reason: 'ไม่พบ codex CLI — ติดตั้ง: npm i -g @openai/codex' };
  }
  try {
    const auth = JSON.parse(await readFile(join(codexHome(), 'auth.json'), 'utf8')) as {
      auth_mode?: string;
      tokens?: { access_token?: string };
    };
    const loggedIn = auth?.auth_mode === 'chatgpt' || Boolean(auth?.tokens?.access_token);
    return { installed: true, loggedIn, reason: loggedIn ? undefined : 'ยังไม่ได้ login — รัน: codex login' };
  } catch {
    return { installed: true, loggedIn: false, reason: 'ยังไม่ได้ login — รัน: codex login' };
  }
}

export interface CodexEvent {
  type: 'text' | 'usage' | 'thread';
  text?: string;
  threadId?: string;
  usage?: unknown;
}

export interface RunCodexOptions {
  prompt: string;
  model?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  cwd?: string; // worktree isolation ของ sub-agent — codex จะรัน + แก้ไฟล์ใน dir นี้
  resumeThreadId?: string;
  onEvent?: (e: CodexEvent) => void;
  signal?: AbortSignal;
}

/**
 * รัน `codex exec` แบบ non-interactive — ส่ง prompt ทาง stdin, parse JSONL events
 * tolerant ต่อ malformed JSONL (codex bug #15451: --json ถูก ignore เมื่อมี tools active)
 */
export async function runCodex(opts: RunCodexOptions): Promise<{ text: string; threadId?: string }> {
  // `codex exec` is already non-interactive; sandbox controls whether generated commands may write.
  const args = ['exec', '--skip-git-repo-check', '--sandbox', opts.sandbox ?? 'read-only', '--json'];
  if (opts.model) args.push('-m', opts.model);
  if (opts.resumeThreadId) args.push('resume', opts.resumeThreadId);
  args.push('-'); // prompt via stdin

  return new Promise((resolve, reject) => {
    // ลบ OPENAI_API_KEY ออกจาก env ของ child — กัน BYOK key ของ Sanook ไป override/ชนกับ ChatGPT login
    // (codex bug #2733/#3286: ตั้ง OPENAI_API_KEY ค้าง env ทำให้ ChatGPT-plan auth วน loop sign-in)
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    const p = spawn('codex', args, { env, cwd: opts.cwd, shell: process.platform === 'win32' }); // Windows: codex = JS shim ผ่าน .cmd → ต้อง shell

    let finalText = '';
    let threadId: string | undefined;
    let buf = '';
    let stderr = '';
    let aborted = false;

    const handleStdoutLine = (line: string) => {
      const t = line.trim();
      if (!t) return;
      if (!t.startsWith('{')) {
        // plain stdout fallback (JSONL ถูก ignore) — เก็บเป็น final text
        finalText += (finalText ? '\n' : '') + t;
        opts.onEvent?.({ type: 'text', text: finalText });
        return;
      }
      try {
        const ev = JSON.parse(t) as { type?: string; thread_id?: string; item?: { type?: string; text?: string }; usage?: unknown };
        if (ev.type === 'thread.started' && ev.thread_id) {
          threadId = ev.thread_id;
          opts.onEvent?.({ type: 'thread', threadId });
        } else if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
          finalText = ev.item.text ?? finalText;
          opts.onEvent?.({ type: 'text', text: finalText });
        } else if (ev.type === 'turn.completed') {
          opts.onEvent?.({ type: 'usage', usage: ev.usage });
        }
      } catch {
        // malformed JSON line — ข้าม
      }
    };

    const abortHandler = () => {
      aborted = true;
      p.kill();
    };
    const cleanupAbortHandler = () => opts.signal?.removeEventListener('abort', abortHandler);
    if (opts.signal?.aborted) abortHandler();
    else opts.signal?.addEventListener('abort', abortHandler, { once: true });
    // codex อาจตายระหว่างรับ prompt → write ลง stdin ที่ปิดแล้ว = EPIPE; ถ้าไม่ดัก = crash ทั้ง CLI
    // (close handler ด้านล่าง reject error ที่อ่านรู้เรื่องแทน)
    p.stdin.on('error', () => {});
    p.stdin.write(opts.prompt);
    p.stdin.end();

    p.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        handleStdoutLine(line);
      }
    });

    p.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    p.on('error', (err) => {
      cleanupAbortHandler();
      reject(new Error(`เรียก codex ไม่ได้: ${err.message}`));
    });
    p.on('close', (code) => {
      cleanupAbortHandler();
      handleStdoutLine(buf);
      buf = '';
      if (aborted) reject(new Error(`codex exec ถูกยกเลิก${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
      else if (code === 0) resolve({ text: finalText.trim(), threadId });
      else reject(new Error(`codex exec จบด้วย exit code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    });
  });
}
