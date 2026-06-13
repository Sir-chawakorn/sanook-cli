// Permission gate (M1): ก่อนมี interactive ask (M4) — hard-deny อันตราย, allow ที่เหลือ
// คำสั่ง shell ที่ทำลายล้าง irreversible
const DESTRUCTIVE_CMD =
  /(\brm\s+-rf\b|\bgit\s+reset\s+--hard\b|\bgit\s+push\b.*--force|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|\bchmod\s+-R\s+777\b|>\s*\/dev\/sd|\bsudo\b)/i;

// path ที่ห้ามเขียนทับ (ความลับ/ระบบ git/deps)
const PROTECTED_PATH =
  /(^|\/)\.git(\/|$)|(^|\/)\.env($|\.|\/)|(^|\/)node_modules(\/|$)|(^|\/)\.ssh(\/|$)|(^|\/)\.aws(\/|$)/i;

export type GateResult = { ok: true } | { ok: false; reason: string };

export function checkBash(cmd: string): GateResult {
  if (DESTRUCTIVE_CMD.test(cmd)) {
    return { ok: false, reason: `คำสั่งทำลายล้าง/irreversible ถูกปฏิเสธ: "${cmd}"` };
  }
  return { ok: true };
}

export function checkWritePath(path: string): GateResult {
  if (PROTECTED_PATH.test(path)) {
    return { ok: false, reason: `path ที่ป้องกันไว้ถูกปฏิเสธ: "${path}" (.git/.env/node_modules/credentials)` };
  }
  return { ok: true };
}
