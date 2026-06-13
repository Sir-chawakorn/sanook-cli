import { tool } from 'ai';
import { z } from 'zod';
import { getSkillBody, saveSkill } from '../skills.js';

/** โหลด skill เต็มเมื่อ task ตรงกับ available_skills */
export const skillTool = tool({
  description:
    'โหลดเนื้อหา skill เต็ม (วิธีทำงานเฉพาะทาง/runbook) เมื่อ task ตรงกับ skill ใน <available_skills>. ' +
    'อ่านก่อนลงมือทำงานประเภทนั้น เพื่อทำตามขั้นตอนที่ผ่านการพิสูจน์แล้ว',
  inputSchema: z.object({
    name: z.string().describe('ชื่อ skill จาก <available_skills>'),
  }),
  execute: async ({ name }) => {
    const body = await getSkillBody(name);
    return body ?? `ไม่เจอ skill "${name}" — ดูชื่อที่มีใน <available_skills>`;
  },
});

/** self-improvement: agent เขียน skill ใหม่เมื่อเจอ procedure ที่น่าจะทำซ้ำอีก */
export const createSkillTool = tool({
  description:
    'สร้าง/อัปเดต skill ใหม่ — ใช้เมื่อเพิ่งทำงานที่ (1) มีหลายขั้นตอน (2) สำเร็จแล้ว (3) น่าจะเจออีก. ' +
    'บันทึกขั้นตอนเป็น runbook เพื่อครั้งหน้าทำได้เร็ว/ไม่พลาดซ้ำ (เก็บใน ~/.sanook/skills/). ' +
    'body ควรมี: When to Use, Steps, Common Errors/Gotchas',
  inputSchema: z.object({
    name: z.string().describe('slug a-z0-9- เช่น "deploy-vercel", "fix-eslint-flat-config"'),
    description: z.string().describe('1 บรรทัด: skill นี้ทำอะไร'),
    when_to_use: z.string().optional().describe('สถานการณ์ที่ควรหยิบ skill นี้มาใช้'),
    body: z.string().describe('เนื้อหา markdown: When to Use, Steps, Common Errors'),
  }),
  execute: async ({ name, description, when_to_use, body }) => {
    try {
      const path = await saveSkill(name, description, body, when_to_use);
      return `OK: บันทึก skill "${name}" แล้ว (${path}) — ครั้งหน้าจะเห็นใน available_skills`;
    } catch (err) {
      return `สร้าง skill ไม่ได้: ${(err as Error).message}`;
    }
  },
});
