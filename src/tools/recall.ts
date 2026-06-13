import { tool } from 'ai';
import { z } from 'zod';
import { recall } from '../knowledge.js';

/** ค้น knowledge ที่สะสม (memory + skills + session เก่า) — reuse ไม่เริ่มจากศูนย์ */
export const recallTool = tool({
  description:
    'ค้นความรู้ที่สะสมไว้ (สิ่งที่จำไว้, skills, งานที่เคยทำใน session เก่า) — เรียกตอนเริ่ม task ' +
    'เพื่อ reuse ของเดิม/ไม่ลืมว่าเคยทำอะไรไปแล้ว ก่อนลงมือทำใหม่',
  inputSchema: z.object({
    query: z.string().describe('คำค้น — หัวข้อ/เทคโนโลยี/ชื่องาน'),
  }),
  execute: async ({ query }) => recall(query),
});
