import { tool } from 'ai';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { clamp } from './util.js';

export const readFileTool = tool({
  description: 'อ่านไฟล์ใน workspace แล้วคืนเนื้อหา (UTF-8). อ่านก่อนแก้ไฟล์เสมอ',
  inputSchema: z.object({
    path: z.string().describe('relative หรือ absolute path ของไฟล์ที่จะอ่าน'),
  }),
  execute: async ({ path }) => {
    try {
      return clamp(await readFile(path, 'utf8'));
    } catch (err) {
      return `ERROR: อ่านไฟล์ "${path}" ไม่ได้ — ${(err as Error).message}`;
    }
  },
});
