import { homedir } from 'node:os';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve, join, sep } from 'node:path';
import { getBrainPath } from '../memory.js';
import { BRAND_ENV, envFlag } from '../brand.js';
import { agentCwd } from '../agentContext.js';

// Permission gate (M1): ก่อนมี interactive ask (M4) — hard-deny อันตราย, allow ที่เหลือ
// คำสั่ง shell ที่ทำลายล้าง irreversible
const DESTRUCTIVE_CMD =
  /(\bgit\s+reset\s+--hard\b|\bgit\s+push\b.*--force|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|\bchmod\s+-R\s+777\b|>\s*\/dev\/sd|\bsudo\b|\bcrontab\b)/i;
const PROTECTED_CMD_PATH =
  /(\$HOME|~)?\/?(\.ssh|\.aws|\.gnupg|\.sanook)(\/|\b)|(^|\s)(cat|less|more|sed|awk|tail|head)\s+[^|;&]*\.env(\.|\b)/i;

const HOME = homedir();
// ไฟล์ที่ห้ามเขียน (persistence backdoor): shell rc, git/npm config, ~/.sanook (token/mcp/hooks)
const PROTECTED_EXACT = new Set(
  ['.gitconfig', '.zshrc', '.bashrc', '.bash_profile', '.profile', '.zprofile', '.npmrc'].map((f) => join(HOME, f)),
);
// โฟลเดอร์ที่ห้ามเขียนเข้าไป (credentials + sanook internal)
const PROTECTED_DIRS = ['.ssh', '.aws', '.gnupg', '.sanook'].map((d) => join(HOME, d));
const PROTECTED_SEGMENTS = new Set(['.git', 'node_modules', '.ssh', '.aws', '.gnupg', '.sanook']);

export type GateResult = { ok: true } | { ok: false; reason: string };

function hasRmRecursiveForce(cmd: string): boolean {
  for (const match of cmd.matchAll(/\brm\b([^;&|]*)/gi)) {
    const parts = match[1].split(/\s+/).filter(Boolean);
    const shortFlags = parts.filter((part) => /^-[^-]/.test(part)).join('');
    const recursive = /r/i.test(shortFlags) || parts.includes('--recursive') || parts.includes('--dir');
    const force = /f/i.test(shortFlags) || parts.includes('--force');
    if (recursive && force) return true;
  }
  return false;
}

export function checkBash(cmd: string): GateResult {
  if (hasRmRecursiveForce(cmd) || DESTRUCTIVE_CMD.test(cmd)) {
    return { ok: false, reason: `คำสั่งทำลายล้าง/irreversible ถูกปฏิเสธ: "${cmd}"` };
  }
  if (PROTECTED_CMD_PATH.test(cmd)) {
    return { ok: false, reason: `คำสั่งที่อ่าน/แตะ path ลับถูกปฏิเสธ: "${cmd}"` };
  }
  return { ok: true };
}

async function canonicalExisting(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function existingAncestor(path: string): Promise<string> {
  let dir = resolve(path);
  for (;;) {
    try {
      await stat(dir);
      return canonicalExisting(dir);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return dir;
      dir = parent;
    }
  }
}

async function allowedRoots(): Promise<string[]> {
  if (envFlag(BRAND_ENV.allowOutsideWorkspace)) return ['/'];
  // agentCwd() = worktree ของ sub-agent ที่ถูก isolate (ถ้ามี) ไม่งั้น = process.cwd().
  // ผล: sub-agent ใน worktree เขียนได้เฉพาะใน worktree ตัวเอง (isolation) ส่วน main agent เขียนใน workspace ปกติ
  const roots = [await canonicalExisting(agentCwd())];
  const brain = await getBrainPath();
  if (brain) roots.push(await canonicalExisting(brain));
  return roots;
}

function inside(abs: string, root: string): boolean {
  return abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep);
}

function protectedSegment(abs: string): boolean {
  const parts = abs.split(/[\\/]+/);
  if (parts.some((p) => PROTECTED_SEGMENTS.has(p))) return true;
  const base = basename(abs);
  return base.startsWith('.env') && base !== '.env.example';
}

async function checkPathScope(path: string, intent: 'read' | 'write'): Promise<GateResult> {
  const abs = intent === 'write' ? await existingAncestor(path) : await canonicalExisting(path);
  const roots = await allowedRoots();
  if (!roots.some((root) => inside(abs, root))) {
    return {
      ok: false,
      reason: `path อยู่นอก workspace/brain ที่อนุญาต: "${path}" (ตั้ง ${BRAND_ENV.allowOutsideWorkspace}=1 เพื่อ opt-in)`,
    };
  }
  return { ok: true };
}

/** กันอ่าน secrets/.git/node_modules และกันอ่านนอก workspace/brain */
export async function checkReadPath(path: string): Promise<GateResult> {
  const abs = await canonicalExisting(path);
  if (protectedSegment(abs)) {
    return { ok: false, reason: `path ที่ป้องกันถูกปฏิเสธ: "${path}" (secrets / .git / .env / node_modules)` };
  }
  return checkPathScope(path, 'read');
}

/** กันเขียนทับ secrets/shell-rc/.sanook + กันเขียนนอก workspace/brain */
export async function checkWritePath(path: string): Promise<GateResult> {
  const abs = resolve(path);
  const canonical = await existingAncestor(path);
  const inProtectedDir = (p: string): boolean => PROTECTED_DIRS.some((d) => p === d || p.startsWith(d + sep));
  if (
    PROTECTED_EXACT.has(abs) ||
    PROTECTED_EXACT.has(canonical) ||
    inProtectedDir(abs) ||
    inProtectedDir(canonical) ||
    protectedSegment(abs) ||
    protectedSegment(canonical)
  ) {
    return {
      ok: false,
      reason: `path ที่ป้องกันถูกปฏิเสธ: "${path}" (secrets / shell-rc / .sanook / .git / .env / node_modules)`,
    };
  }
  return checkPathScope(path, 'write');
}
