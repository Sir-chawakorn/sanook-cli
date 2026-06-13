export const MAX_OUTPUT = 30_000;

/** ตัด output ที่ยาวเกิน กัน context ระเบิด */
export function clamp(s: string, max = MAX_OUTPUT): string {
  return s.length > max ? s.slice(0, max) + `\n... [truncated ${s.length - max} chars]` : s;
}
