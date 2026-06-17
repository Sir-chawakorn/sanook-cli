import { tool } from 'ai';
import { z } from 'zod';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { clamp, resolveAgentPath } from './util.js';
import { checkReadPath } from './permission.js';

export const listDirTool = tool({
  description: 'list ไฟล์และโฟลเดอร์ใน directory (โฟลเดอร์ลงท้ายด้วย /)',
  inputSchema: z.object({
    path: z.string().default('.').describe('directory ที่จะ list (default: current dir)'),
  }),
  execute: async ({ path }) => {
    const full = resolveAgentPath(path); // relative ผูกกับ agentCwd (worktree ของ sub-agent ถ้ามี)
    const guard = await checkReadPath(full);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    try {
      const entries = await readdir(full, { withFileTypes: true });
      const visible: string[] = [];
      for (const e of entries) {
        if (e.name.startsWith('.') && e.name !== '.env.example' && e.name !== '.gitignore') continue;
        const entryPath = join(full, e.name);
        const entryGuard = await checkReadPath(entryPath);
        if (!entryGuard.ok) continue;
        let isDirectory = e.isDirectory();
        if (!isDirectory && e.isSymbolicLink()) {
          isDirectory = await stat(entryPath)
            .then((s) => s.isDirectory())
            .catch(() => false);
        }
        visible.push(isDirectory ? `${e.name}/` : e.name);
      }
      const out = visible.sort().join('\n');
      return clamp(out) || '(empty)';
    } catch (err) {
      return `ERROR: list "${path}" ไม่ได้ — ${(err as Error).message}`;
    }
  },
});
