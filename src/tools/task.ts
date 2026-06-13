import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

// task = มอบงานย่อยให้ sub-agent ทำใน context แยก (เลียน Claude Code Task tool)
// sub-agent เริ่มสะอาด, tool subset, depth guard กัน spawn ไม่จบ
const DEPTH_ENV = 'SANOOK_SUBAGENT_DEPTH';
const MAX_DEPTH = 2;
const READ_TOOLS = ['read_file', 'list_dir', 'glob', 'grep', 'run_bash'];
// sub-agent ห้ามมี: task (recursion), scheduling (side-effect ที่ควรเป็น main agent)
const SUBAGENT_EXCLUDE = ['task', 'schedule_task', 'list_scheduled', 'cancel_scheduled'];

export const taskTool = tool({
  description:
    'มอบงานย่อยให้ sub-agent ทำใน context แยก — ใช้ตอนต้องสำรวจหลายไฟล์/ค้นหาเยอะแล้วอยากได้แค่บทสรุป ' +
    '(กัน context หลักบวม). sub-agent เริ่มสะอาด ไม่เห็น conversation นี้ → เขียน prompt ให้ครบในตัว. ' +
    'default read-only (สำรวจ/วิเคราะห์); readonly=false ให้แก้ไฟล์ได้ด้วย',
  inputSchema: z.object({
    description: z.string().describe('สรุปงาน 3-5 คำ'),
    prompt: z.string().describe('คำสั่งเต็ม self-contained ให้ sub-agent (มันไม่เห็น context นี้)'),
    readonly: z.boolean().optional().describe('true (default) = อ่าน/ค้นเท่านั้น; false = แก้ไฟล์ได้'),
  }),
  execute: async ({ prompt, readonly = true }) => {
    const depth = Number(process.env[DEPTH_ENV] ?? '0');
    if (depth >= MAX_DEPTH) {
      return 'ถึงขีดจำกัดความลึก sub-agent แล้ว (กัน spawn ไม่จบ) — ทำงานนี้เองแทน';
    }
    const { runAgent } = await import('../loop.js');
    const { tools } = await import('./index.js');
    const entries = Object.entries(tools as Record<string, unknown>);
    const picked = readonly
      ? entries.filter(([k]) => READ_TOOLS.includes(k))
      : entries.filter(([k]) => !SUBAGENT_EXCLUDE.includes(k));
    const model = process.env.SANOOK_ACTIVE_MODEL ?? 'sonnet';

    process.env[DEPTH_ENV] = String(depth + 1);
    try {
      const { text } = await runAgent({
        model,
        prompt,
        maxSteps: 15,
        tools: Object.fromEntries(picked) as unknown as ToolSet,
      });
      return text || '(sub-agent ไม่มีผลลัพธ์)';
    } finally {
      process.env[DEPTH_ENV] = String(depth); // คืนค่า depth เดิม
    }
  },
});
