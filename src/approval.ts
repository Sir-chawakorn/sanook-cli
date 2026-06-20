import { AsyncLocalStorage } from 'node:async_hooks';
import type { ToolSet } from 'ai';

// interactive approval — ขออนุมัติก่อนรัน tool ที่เปลี่ยน state (เลียน Claude Code ask-mode)
// mode 'auto' รันเลย · 'ask' ขอ y/n ก่อน (default ปลอดภัยอยู่ที่ config/loop)
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
  'run_python',
  'run_rust',
  'git_commit',
  'schedule_task',
  'cancel_scheduled',
  'remember', // เขียน auto-memory ถาวร
  'create_skill', // เขียน skill ถาวร
  'ha_call_service', // ควบคุมอุปกรณ์ Home Assistant จริง
]);

// capability-based gate: tool ที่ "อ่านอย่างเดียว" เท่านั้นที่ผ่านโดยไม่ขออนุมัติ
// อย่างอื่น (รวม MCP tools ที่ไม่รู้จัก เช่น fs write / postgres DELETE) = treat as mutating → gate ใน ask-mode
const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_dir',
  'glob',
  'grep',
  'recall',
  'find_skills',
  'skill',
  'git_status',
  'git_diff',
  'git_log',
  'list_scheduled',
  'ha_list_entities',
  'ha_get_state',
  'ha_list_services',
  'web_fetch',
]);

export function isReadOnlyTool(tool: string): boolean {
  return READ_ONLY_TOOLS.has(tool);
}

export function isMutatingTool(tool: string): boolean {
  return !isReadOnlyTool(tool);
}

/** สรุป tool input เป็นบรรทัดเดียวให้ user ตัดสินใจ */
export function summarizeToolCall(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (tool) {
    case 'run_bash':
      return `$ ${String(i.cmd ?? '')}`;
    case 'run_python':
      return i.path ? `python ${String(i.path)}` : `python snippet (${String(i.code ?? '').length} chars)`;
    case 'run_rust':
      return i.path ? `rustc ${String(i.path)} && run` : `rust snippet (${String(i.code ?? '').length} chars)`;
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
    case 'ha_call_service':
      return `Home Assistant ${String(i.domain ?? '')}.${String(i.service ?? '')}${i.entity_id ? ` ${String(i.entity_id)}` : ''}`;
    default:
      return tool;
  }
}

/** ครอบ mutate tools ด้วย approval gate — ask-mode เรียก approve() ก่อน execute */
export function wrapToolsWithApproval(tools: ToolSet): ToolSet {
  const out: Record<string, unknown> = {};
  for (const [name, t] of Object.entries(tools as Record<string, { execute?: unknown }>)) {
    // read-only → ผ่าน · ที่เหลือ (mutate + MCP/unknown) → gate ใน ask-mode (deny-by-default)
    if (READ_ONLY_TOOLS.has(name) || typeof t.execute !== 'function') {
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
