import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { ToolSet } from 'ai';
import { appHomePath, BRAND_ENV, envFlag } from './brand.js';
import { hasUntrustedProjectConfig, projectConfigPathIfTrusted, projectRoot } from './trust.js';

// hooks = รัน command ของ user ก่อน/หลัง tool (เลียน Claude Code hooks) — บังคับ lint/format/policy
// config: ~/.sanook/hooks.json + project .sanook/hooks.json (merge)
// { "PreToolUse": [{ "matcher": "write_file|edit_file", "command": "..." }], "PostToolUse": [...] }
// PreToolUse: command exit != 0 → block tool (stdout/stderr = เหตุผล) · PostToolUse: observe เฉยๆ
interface HookEntry {
  matcher: string;
  command: string;
}
interface HooksConfig {
  PreToolUse?: HookEntry[];
  PostToolUse?: HookEntry[];
}

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'TERM', 'NODE_PATH', 'NVM_DIR', 'APPDATA'];
function safeEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SAFE_ENV_KEYS) {
    const v = process.env[k];
    if (v != null) out[k] = v;
  }
  return out;
}

async function readHooksFile(path: string, merged: HooksConfig): Promise<void> {
  const cfg = JSON.parse(await readFile(path, 'utf8')) as HooksConfig;
  const valid = (h: unknown): h is HookEntry =>
    Boolean(
      h &&
        typeof h === 'object' &&
        typeof (h as HookEntry).matcher === 'string' &&
        typeof (h as HookEntry).command === 'string',
    );
  if (Array.isArray(cfg.PreToolUse)) merged.PreToolUse!.push(...cfg.PreToolUse.filter(valid));
  if (Array.isArray(cfg.PostToolUse)) merged.PostToolUse!.push(...cfg.PostToolUse.filter(valid));
}

export async function loadHooksConfig(cwd: string = process.cwd()): Promise<HooksConfig> {
  const merged: HooksConfig = { PreToolUse: [], PostToolUse: [] };
  try {
    await readHooksFile(appHomePath('hooks.json'), merged);
  } catch {
    /* ไม่มี global config = ข้าม */
  }
  const root = await projectRoot(cwd);
  const projectPath = await projectConfigPathIfTrusted('hooks.json', root);
  if (projectPath) {
    await readHooksFile(projectPath, merged);
  } else if (await hasUntrustedProjectConfig('hooks.json', root)) {
    /* project hook config มีอยู่แต่ยังไม่ trusted = ข้ามแบบ fail-closed */
  }
  return merged;
}

export function matches(matcher: string, tool: string): boolean {
  if (!matcher || matcher === '*') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return matcher === tool; // regex พัง → เทียบตรงๆ
  }
}

/** รัน command — payload เข้า stdin (เป็น DATA ไม่ใช่ shell arg → กัน injection); command = config ของ user (trusted) */
function runCommand(command: string, payload: unknown, timeoutMs = 10_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      env: envFlag(BRAND_ENV.hooksInheritEnv) ? process.env : safeEnv(),
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: 124, out: 'hook timeout' });
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, out: (stdout || stderr).trim() });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: 127, out: 'hook spawn error' });
    });
    child.stdin.on('error', () => {}); // กัน EPIPE ถ้า command ไม่อ่าน stdin
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export interface HookGate {
  block: boolean;
  reason?: string;
}

async function runPre(list: HookEntry[], tool: string, input: unknown): Promise<HookGate> {
  for (const h of list) {
    if (!matches(h.matcher, tool)) continue;
    const { code, out } = await runCommand(h.command, { event: 'PreToolUse', tool, input });
    if (code !== 0) return { block: true, reason: out.slice(0, 300) || `hook exit ${code}` };
  }
  return { block: false };
}

async function runPost(list: HookEntry[], tool: string, input: unknown, result: unknown): Promise<void> {
  for (const h of list) {
    if (!matches(h.matcher, tool)) continue;
    await runCommand(h.command, { event: 'PostToolUse', tool, input, result });
  }
}

/** ครอบทุก tool ด้วย pre/post hook (cfg ที่โหลดแล้ว) — PreToolUse block ได้, PostToolUse observe */
function wrapToolsWithHooks(tools: ToolSet, cfg: HooksConfig): ToolSet {
  const pre = cfg.PreToolUse ?? [];
  const post = cfg.PostToolUse ?? [];
  const out: Record<string, unknown> = {};
  for (const [name, t] of Object.entries(tools as Record<string, { execute?: unknown }>)) {
    const orig = t.execute;
    if (typeof orig !== 'function') {
      out[name] = t;
      continue;
    }
    out[name] = {
      ...t,
      execute: async (input: unknown, opts: unknown) => {
        const gate = await runPre(pre, name, input);
        if (gate.block) return `⛔ tool "${name}" ถูก block โดย hook: ${gate.reason}`;
        const result = await (orig as (i: unknown, o: unknown) => Promise<unknown>)(input, opts);
        await runPost(post, name, input, result);
        return result;
      },
    };
  }
  return out as ToolSet;
}

/** wrap tools ด้วย hooks ถ้ามี config (ไม่มี → คืน tools เดิม zero overhead) */
export async function maybeWrapHooks(tools: ToolSet, cwd: string = process.cwd()): Promise<ToolSet> {
  const cfg = await loadHooksConfig(cwd);
  if (!(cfg.PreToolUse?.length || cfg.PostToolUse?.length)) return tools;
  return wrapToolsWithHooks(tools, cfg);
}
