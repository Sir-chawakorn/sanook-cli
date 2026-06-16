import { tool } from 'ai';
import { z } from 'zod';
import { runGit } from '../git.js';
import { agentCwd } from '../agentContext.js';

const gitErr = (e: unknown): string => `git error: ${(e as Error).message}`;
// รัน git ใน cwd ของ agent (worktree ของ sub-agent ถ้ามี) — ไม่งั้น git_commit/status/diff ไปโดน MAIN repo
// แทนที่ของ sub-agent ที่ isolate ไว้ (worktree isolation พัง / commit ผิด tree)
const gitCwd = (): string => agentCwd();

export const gitStatusTool = tool({
  description: 'ดู git status — ไฟล์ที่เปลี่ยน/staged/untracked + branch',
  inputSchema: z.object({
    path: z.string().optional().describe('จำกัดเฉพาะ path (ไม่ใส่ = ทั้ง repo)'),
  }),
  execute: async ({ path }) => {
    try {
      const args = ['status', '--short', '--branch', ...(path ? ['--', path] : [])];
      return (await runGit(args, gitCwd())).trim() || '(clean)';
    } catch (e) {
      return gitErr(e);
    }
  },
});

export const gitDiffTool = tool({
  description: 'ดู git diff — เนื้อหาที่เปลี่ยน (staged=true ดูที่ stage แล้ว)',
  inputSchema: z.object({
    staged: z.boolean().optional().describe('true = diff ของที่ staged แล้ว'),
    path: z.string().optional().describe('จำกัดเฉพาะไฟล์/โฟลเดอร์'),
  }),
  execute: async ({ staged, path }) => {
    try {
      const args = ['diff', ...(staged ? ['--staged'] : []), ...(path ? ['--', path] : [])];
      const out = await runGit(args, gitCwd());
      return out.length > 20000 ? `${out.slice(0, 20000)}\n... [diff ยาว, ตัด]` : out || '(no changes)';
    } catch (e) {
      return gitErr(e);
    }
  },
});

export const gitLogTool = tool({
  description: 'ดู git log — commit ล่าสุด (oneline)',
  inputSchema: z.object({
    count: z.number().optional().describe('จำนวน commit (default 10, max 50)'),
  }),
  execute: async ({ count = 10 }) => {
    try {
      return (await runGit(['log', '--oneline', '-n', String(Math.min(Math.max(count, 1), 50))], gitCwd())) || '(no commits)';
    } catch (e) {
      return gitErr(e);
    }
  },
});

export const gitCommitTool = tool({
  description:
    'git commit — commit ที่ staged ไว้ (addAll=true เพื่อ git add -A ก่อน). ' +
    'ใช้เมื่อ user สั่งให้ commit เท่านั้น. ไม่ push (push ต้องให้ user ทำเอง)',
  inputSchema: z.object({
    message: z.string().describe('commit message'),
    addAll: z.boolean().optional().describe('true = git add -A ก่อน commit'),
  }),
  execute: async ({ message, addAll }) => {
    try {
      const cwd = gitCwd();
      if (addAll) await runGit(['add', '-A'], cwd);
      return (await runGit(['commit', '-m', message], cwd)).trim();
    } catch (e) {
      return gitErr(e);
    }
  },
});
