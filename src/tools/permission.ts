import { homedir } from 'node:os';
import { resolve, join, sep } from 'node:path';

// Permission gate (M1): ก่อนมี interactive ask (M4) — hard-deny อันตราย, allow ที่เหลือ
// คำสั่ง shell ที่ทำลายล้าง irreversible
const DESTRUCTIVE_CMD =
  /(\brm\s+-rf\b|\bgit\s+reset\s+--hard\b|\bgit\s+push\b.*--force|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|\bchmod\s+-R\s+777\b|>\s*\/dev\/sd|\bsudo\b|\bcrontab\b)/i;

const HOME = homedir();
// ไฟล์ที่ห้ามเขียน (persistence backdoor): shell rc, git/npm config, ~/.sanook (token/mcp/hooks)
const PROTECTED_EXACT = new Set(
  ['.gitconfig', '.zshrc', '.bashrc', '.bash_profile', '.profile', '.zprofile', '.npmrc'].map((f) => join(HOME, f)),
);
// โฟลเดอร์ที่ห้ามเขียนเข้าไป (credentials + sanook internal)
const PROTECTED_DIRS = ['.ssh', '.aws', '.gnupg', '.sanook'].map((d) => join(HOME, d));
// segment ที่ห้ามไม่ว่าอยู่ที่ไหน (.git internals / .env / deps / credentials dir)
const PROTECTED_SEGMENT = /(^|\/)(\.git|node_modules|\.ssh|\.aws|\.gnupg)(\/|$)|(^|\/)\.env($|\.)/i;

export type GateResult = { ok: true } | { ok: false; reason: string };

export function checkBash(cmd: string): GateResult {
  if (DESTRUCTIVE_CMD.test(cmd)) {
    return { ok: false, reason: `คำสั่งทำลายล้าง/irreversible ถูกปฏิเสธ: "${cmd}"` };
  }
  return { ok: true };
}

/** กันเขียนทับ secrets/shell-rc/.sanook — resolve เป็น absolute ก่อน (กัน ../ และ symlink-ish bypass) */
export function checkWritePath(path: string): GateResult {
  const abs = resolve(path);
  const inProtectedDir = PROTECTED_DIRS.some((d) => abs === d || abs.startsWith(d + sep));
  if (PROTECTED_EXACT.has(abs) || inProtectedDir || PROTECTED_SEGMENT.test(abs)) {
    return {
      ok: false,
      reason: `path ที่ป้องกันถูกปฏิเสธ: "${path}" (secrets / shell-rc / .sanook / .git / .env / node_modules)`,
    };
  }
  return { ok: true };
}
