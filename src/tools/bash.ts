import { tool } from 'ai';
import { z } from 'zod';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clamp } from './util.js';
import { checkBash } from './permission.js';
import { maybeSandbox } from './sandbox.js';
import { agentCwd } from '../agentContext.js';
import { safeProcessEnv } from '../process-runner.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const bashTool = tool({
  description: 'รันคำสั่ง shell (ls/grep/find/cat/test/npm ฯลฯ) เพื่อค้นหา ตรวจสอบ หรือรัน build/test',
  inputSchema: z.object({
    cmd: z.string().describe('คำสั่ง shell ที่จะรัน'),
  }),
  execute: async ({ cmd }) => {
    const guard = checkBash(cmd);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    const cwd = agentCwd(); // worktree ของ sub-agent ถ้ามี (sandbox confine write ตาม cwd นี้)
    const opts = { cwd, env: safeProcessEnv(), timeout: 120_000, maxBuffer: 10 * 1024 * 1024 };
    try {
      // OS sandbox (Seatbelt/bubblewrap) confine write ให้อยู่ใน workspace ถ้ามี — ไม่งั้นรันตรงตามเดิม
      const sb = await maybeSandbox(cmd, cwd);
      const { stdout, stderr } = sb
        ? await execFileAsync(sb.file, sb.args, opts)
        : await execAsync(cmd, opts);
      const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
      return clamp(out) || '(no output)';
    } catch (err) {
      return `ERROR: คำสั่งล้มเหลว — ${(err as Error).message}`;
    }
  },
});
