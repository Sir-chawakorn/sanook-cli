import { tool } from 'ai';
import { z } from 'zod';
import { readdir } from 'node:fs/promises';
import { clamp } from './util.js';
import { checkReadPath } from './permission.js';

export const listDirTool = tool({
  description: 'list ไฟล์และโฟลเดอร์ใน directory (โฟลเดอร์ลงท้ายด้วย /)',
  inputSchema: z.object({
    path: z.string().default('.').describe('directory ที่จะ list (default: current dir)'),
  }),
  execute: async ({ path }) => {
    const guard = await checkReadPath(path);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    try {
      const entries = await readdir(path, { withFileTypes: true });
      const out = entries
        .filter((e) => !e.name.startsWith('.') || e.name === '.env.example' || e.name === '.gitignore')
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join('\n');
      return clamp(out) || '(empty)';
    } catch (err) {
      return `ERROR: list "${path}" ไม่ได้ — ${(err as Error).message}`;
    }
  },
});
