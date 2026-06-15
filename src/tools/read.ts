import { tool } from 'ai';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { clamp, resolveAgentPath } from './util.js';
import { checkReadPath } from './permission.js';

export const readFileTool = tool({
  description: 'อ่านไฟล์ใน workspace แล้วคืนเนื้อหา (UTF-8). อ่านก่อนแก้ไฟล์เสมอ',
  inputSchema: z.object({
    path: z.string().describe('relative หรือ absolute path ของไฟล์ที่จะอ่าน'),
  }),
  execute: async ({ path }) => {
    const full = resolveAgentPath(path); // relative ผูกกับ agentCwd (worktree ของ sub-agent ถ้ามี)
    const guard = await checkReadPath(full);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    try {
      return clamp(await readFile(full, 'utf8'));
    } catch (err) {
      return `ERROR: อ่านไฟล์ "${path}" ไม่ได้ — ${(err as Error).message}`;
    }
  },
});
