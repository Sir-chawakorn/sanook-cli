import { isAbsolute, resolve } from 'node:path';
import { agentCwd } from '../agentContext.js';

export const MAX_OUTPUT = 30_000;

/** ตัด output ที่ยาวเกิน กัน context ระเบิด */
export function clamp(s: string, max = MAX_OUTPUT): string {
  return s.length > max ? s.slice(0, max) + `\n... [truncated ${s.length - max} chars]` : s;
}

/**
 * resolve path ของ tool ให้ผูกกับ working dir ของ agent ปัจจุบัน (agentCwd) ไม่ใช่ process.cwd().
 * สำคัญตอน sub-agent รันใน git worktree แยก: relative path ("src/foo.ts") ต้องชี้เข้า worktree
 * ของ sub-agent นั้น ไม่ใช่ main tree (ไม่งั้น isolation หลุด — แก้ผิดไฟล์). absolute path คงเดิม.
 */
export function resolveAgentPath(p: string): string {
  return isAbsolute(p) ? p : resolve(agentCwd(), p);
}
