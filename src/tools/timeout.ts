import { inspect } from 'node:util';
import type { ToolSet } from 'ai';
import { redactKey, redactUnknown } from '../providers/keys.js';

// ครอบ tool ด้วย timeout — กัน read/grep/glob/edit บนไฟล์ใหญ่ค้าง แล้วแขวน loop ทั้ง session ไม่จบ
// tool ที่จัดการ timeout เองอยู่แล้ว → ไม่ครอบ: run_bash (120s ในตัว), sub-agent orchestration (อาจรัน/รอนานโดยตั้งใจ)
const SELF_TIMED = new Set(['run_bash', 'task', 'task_parallel', 'task_collect']);
export const DEFAULT_TOOL_TIMEOUT = 120_000;

function formatToolError(e: unknown): string {
  if (e instanceof Error) return redactKey(e.message || e.name);
  if (typeof e === 'string') return redactKey(e);
  if (e == null) return String(e);
  const safe = redactUnknown(e);
  try {
    const json = JSON.stringify(safe);
    if (json) return json;
  } catch {
    return inspect(safe, { breakLength: Infinity, depth: 2 });
  }
  return redactKey(String(e));
}

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
          return `ERROR: ${formatToolError(e)}`;
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
    };
  }
  return out as ToolSet;
}
