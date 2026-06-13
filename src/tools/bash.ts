import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { clamp } from './util.js';
import { checkBash } from './permission.js';

const execAsync = promisify(exec);

export const bashTool = tool({
  description: 'รันคำสั่ง shell (ls/grep/find/cat/test/npm ฯลฯ) เพื่อค้นหา ตรวจสอบ หรือรัน build/test',
  inputSchema: z.object({
    cmd: z.string().describe('คำสั่ง shell ที่จะรัน'),
  }),
  execute: async ({ cmd }) => {
    const guard = checkBash(cmd);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
      const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
      return clamp(out) || '(no output)';
    } catch (err) {
      return `ERROR: คำสั่งล้มเหลว — ${(err as Error).message}`;
    }
  },
});
