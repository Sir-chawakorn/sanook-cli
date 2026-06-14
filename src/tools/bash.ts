import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { clamp } from './util.js';
import { checkBash } from './permission.js';

const execAsync = promisify(exec);
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'TERM', 'NODE_PATH', 'NVM_DIR', 'APPDATA'];

function safeEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SAFE_ENV_KEYS) {
    const v = process.env[k];
    if (v != null) out[k] = v;
  }
  return out;
}

export const bashTool = tool({
  description: 'รันคำสั่ง shell (ls/grep/find/cat/test/npm ฯลฯ) เพื่อค้นหา ตรวจสอบ หรือรัน build/test',
  inputSchema: z.object({
    cmd: z.string().describe('คำสั่ง shell ที่จะรัน'),
  }),
  execute: async ({ cmd }) => {
    const guard = checkBash(cmd);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: process.cwd(),
        env: safeEnv(),
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
      return clamp(out) || '(no output)';
    } catch (err) {
      return `ERROR: คำสั่งล้มเหลว — ${(err as Error).message}`;
    }
  },
});
