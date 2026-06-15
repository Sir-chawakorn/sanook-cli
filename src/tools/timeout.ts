import type { ToolSet } from 'ai';

// ครอบ tool ด้วย timeout — กัน read/grep/glob/edit บนไฟล์ใหญ่ค้าง แล้วแขวน loop ทั้ง session ไม่จบ
// tool ที่จัดการ timeout เองอยู่แล้ว → ไม่ครอบ: run_bash (120s ในตัว), task (sub-agent อาจรันนาน)
const SELF_TIMED = new Set(['run_bash', 'task']);
export const DEFAULT_TOOL_TIMEOUT = 120_000;

/** Promise.race tool execute กับ timer — timeout คืนเป็น ERROR string (tool ไม่ throw เข้า loop) */
export function wrapToolsWithTimeout(tools: ToolSet, ms = DEFAULT_TOOL_TIMEOUT): ToolSet {
  const out: Record<string, unknown> = {};
  for (const [name, t] of Object.entries(tools as Record<string, { execute?: unknown }>)) {
    if (SELF_TIMED.has(name) || typeof t.execute !== 'function') {
      out[name] = t;
      continue;
    }
    const orig = t.execute as (i: unknown, o: unknown) => Promise<unknown>;
    out[name] = {
      ...t,
      execute: async (input: unknown, opts: unknown) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<string>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`tool "${name}" ค้างเกิน ${ms}ms — ยกเลิก`)), ms);
        });
        try {
          return await Promise.race([Promise.resolve(orig(input, opts)), timeout]);
        } catch (e) {
          return `ERROR: ${(e as Error).message}`;
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
    };
  }
  return out as ToolSet;
}
