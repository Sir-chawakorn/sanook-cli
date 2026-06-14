import { tool } from 'ai';
import { z } from 'zod';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { checkWritePath } from './permission.js';
import { summarizeWrite } from '../diff.js';

export const writeFileTool = tool({
  description: 'เขียนไฟล์ใหม่ (overwrite ถ้ามีอยู่แล้ว) — สร้าง directory ให้อัตโนมัติ. ใช้สร้างไฟล์ใหม่ทั้งไฟล์ (แก้บางส่วนใช้ edit_file)',
  inputSchema: z.object({
    path: z.string().describe('path ของไฟล์ที่จะเขียน'),
    content: z.string().describe('เนื้อหาทั้งหมดของไฟล์'),
  }),
  execute: async ({ path, content }) => {
    const guard = await checkWritePath(path);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    const previous = await readFile(path, 'utf8').catch(() => undefined); // มีอยู่เดิมไหม (โชว์ before→after)
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
      return `OK: "${path}" — ${summarizeWrite(content, previous)}`;
    } catch (err) {
      return `ERROR: เขียนไฟล์ "${path}" ไม่ได้ — ${(err as Error).message}`;
    }
  },
});
