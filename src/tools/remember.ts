import { tool } from 'ai';
import { z } from 'zod';
import { appendMemory } from '../memory.js';

export const rememberTool = tool({
  description:
    'จำข้อเท็จจริง/preference/decision สำคัญข้าม session — ใช้เมื่อเจอสิ่งที่ควรจำไว้ใช้ครั้งหน้า ' +
    '(เช่น user ชอบ/ไม่ชอบอะไร, decision สำคัญ, convention ของ project). บันทึกลง ~/.sanook/memory',
  inputSchema: z.object({
    fact: z.string().describe('สิ่งที่ต้องจำ — 1 ประโยคกระชับ atomic'),
  }),
  execute: async ({ fact }) => {
    await appendMemory(fact);
    return `OK: จำแล้ว — "${fact}"`;
  },
});
