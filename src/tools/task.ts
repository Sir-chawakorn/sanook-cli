import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { agentContext } from '../agentContext.js';
import { approvalContext } from '../approval.js';

// task = มอบงานย่อยให้ sub-agent ทำใน context แยก (เลียน Claude Code Task tool)
// depth/model/budget thread ผ่าน AsyncLocalStorage (parallel-safe, ไม่ใช่ process.env)
const MAX_DEPTH = 2;
// read-only = อ่าน/ค้นเท่านั้น — ตัด run_bash ออก (shell = เลี่ยง read-only contract ได้)
const READ_TOOLS = ['read_file', 'list_dir', 'glob', 'grep', 'git_status', 'git_diff', 'git_log', 'skill', 'find_skills'];
// sub-agent ห้ามมี: task (recursion), scheduling (side-effect ที่ควรเป็น main agent)
const SUBAGENT_EXCLUDE = ['task', 'schedule_task', 'list_scheduled', 'cancel_scheduled'];

export const taskTool = tool({
  description:
    'มอบงานย่อยให้ sub-agent ทำใน context แยก — ใช้ตอนต้องสำรวจหลายไฟล์/ค้นหาเยอะแล้วอยากได้แค่บทสรุป ' +
    '(กัน context หลักบวม). sub-agent เริ่มสะอาด ไม่เห็น conversation นี้ → เขียน prompt ให้ครบในตัว. ' +
    'default read-only (อ่าน/ค้น); readonly=false ให้แก้ไฟล์/รัน bash ได้ด้วย',
  inputSchema: z.object({
    description: z.string().describe('สรุปงาน 3-5 คำ'),
    prompt: z.string().describe('คำสั่งเต็ม self-contained ให้ sub-agent (มันไม่เห็น context นี้)'),
    readonly: z.boolean().optional().describe('true (default) = อ่าน/ค้นเท่านั้น; false = แก้ไฟล์/bash ได้'),
  }),
  execute: async ({ prompt, readonly = true }) => {
    const ctx = agentContext.getStore();
    const depth = ctx?.depth ?? 0;
    if (depth >= MAX_DEPTH) {
      return 'ถึงขีดจำกัดความลึก sub-agent แล้ว (กัน spawn ไม่จบ) — ทำงานนี้เองแทน';
    }
    const { runAgent } = await import('../loop.js');
    const { tools } = await import('./index.js');
    const entries = Object.entries(tools as Record<string, unknown>);
    const picked = readonly
      ? entries.filter(([k]) => READ_TOOLS.includes(k))
      : entries.filter(([k]) => !SUBAGENT_EXCLUDE.includes(k));

    const appr = approvalContext.getStore();
    const { text } = await runAgent({
      model: ctx?.model ?? 'sonnet', // inherit จาก main
      budgetUsd: ctx?.budgetUsd, // cap เดียวกับ main (กัน sub-agent วิ่ง uncapped)
      subagentDepth: depth + 1, // thread depth ผ่าน param — ไม่ mutate global
      permissionMode: appr?.mode ?? 'ask', // inherit ask-mode (กัน sub-agent เลี่ยง approval)
      approve: appr?.approve,
      prompt,
      maxSteps: 15,
      tools: Object.fromEntries(picked) as unknown as ToolSet,
    });
    return text || '(sub-agent ไม่มีผลลัพธ์)';
  },
});
