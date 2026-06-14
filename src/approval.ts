import { AsyncLocalStorage } from 'node:async_hooks';
import type { ToolSet } from 'ai';

// interactive approval — ขออนุมัติก่อนรัน tool ที่เปลี่ยน state (เลียน Claude Code ask-mode)
// mode 'auto' (default — act-first) รันเลย · 'ask' ขอ y/n ก่อน
export type ApprovalFn = (tool: string, summary: string) => Promise<boolean>;

export interface ApprovalCtx {
  mode: 'auto' | 'ask';
  approve?: ApprovalFn;
}

export const approvalContext = new AsyncLocalStorage<ApprovalCtx>();

// tool ที่เปลี่ยน state จริง → ต้องขออนุมัติใน ask-mode
// NOTE: ต้อง sync กับ tools ที่ mutate — มี test guard ใน approval.test.ts กันหลุด
export const MUTATE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'run_bash',
  'git_commit',
  'schedule_task',
  'cancel_scheduled',
  'remember', // เขียน auto-memory ถาวร
  'create_skill', // เขียน skill ถาวร
]);

/** สรุป tool input เป็นบรรทัดเดียวให้ user ตัดสินใจ */
export function summarizeToolCall(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (tool) {
    case 'run_bash':
      return `$ ${String(i.cmd ?? '')}`;
    case 'write_file':
      return `เขียนไฟล์ ${String(i.path ?? '')}`;
    case 'edit_file':
      return `แก้ไฟล์ ${String(i.path ?? '')}`;
    case 'git_commit':
      return `git commit -m "${String(i.message ?? '')}"`;
    case 'schedule_task':
      return `ตั้ง cron: ${String(i.when ?? '')} → ${String(i.task ?? '').slice(0, 40)}`;
    case 'cancel_scheduled':
      return `ยกเลิก task ${String(i.id ?? '')}`;
    case 'remember':
      return `จำ: ${String(i.fact ?? '').slice(0, 50)}`;
    case 'create_skill':
      return `สร้าง skill ${String(i.name ?? '')}`;
    default:
      return tool;
  }
}

/** ครอบ mutate tools ด้วย approval gate — ask-mode เรียก approve() ก่อน execute */
export function wrapToolsWithApproval(tools: ToolSet): ToolSet {
  const out: Record<string, unknown> = {};
  for (const [name, t] of Object.entries(tools as Record<string, { execute?: unknown }>)) {
    if (!MUTATE_TOOLS.has(name) || typeof t.execute !== 'function') {
      out[name] = t;
      continue;
    }
    const orig = t.execute as (i: unknown, o: unknown) => Promise<unknown>;
    out[name] = {
      ...t,
      execute: async (input: unknown, opts: unknown) => {
        const ctx = approvalContext.getStore();
        if (ctx?.mode === 'ask') {
          const ok = ctx.approve ? await ctx.approve(name, summarizeToolCall(name, input)) : false;
          if (!ok) return `⛔ ผู้ใช้ปฏิเสธการรัน ${name} (${summarizeToolCall(name, input)})`;
        }
        return orig(input, opts);
      },
    };
  }
  return out as ToolSet;
}
