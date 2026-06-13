import { tool } from 'ai';
import { z } from 'zod';
import { glob } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { clamp } from './util.js';

const execAsync = promisify(exec);
const MAX_RESULTS = 200;

export const globTool = tool({
  description: 'หาไฟล์ด้วย glob pattern (เช่น "src/**/*.ts", "**/*.json")',
  inputSchema: z.object({
    pattern: z.string().describe('glob pattern'),
    cwd: z.string().default('.').describe('directory ที่จะค้นจาก'),
  }),
  execute: async ({ pattern, cwd }) => {
    try {
      const out: string[] = [];
      for await (const f of glob(pattern, { cwd })) {
        out.push(f);
        if (out.length >= MAX_RESULTS) {
          out.push(`... [>${MAX_RESULTS} matches, truncated]`);
          break;
        }
      }
      return out.length ? out.sort().join('\n') : '(no matches)';
    } catch (err) {
      return `ERROR: glob "${pattern}" ล้มเหลว — ${(err as Error).message}`;
    }
  },
});

export const grepTool = tool({
  description: 'ค้นข้อความใน codebase ด้วย ripgrep (regex) — คืน file:line:text, เคารพ .gitignore',
  inputSchema: z.object({
    pattern: z.string().describe('regex ที่จะค้น'),
    path: z.string().default('.').describe('directory หรือไฟล์ที่จะค้น'),
  }),
  execute: async ({ pattern, path }) => {
    try {
      // ส่ง arg ผ่าน JSON.stringify เพื่อ quote ปลอดภัย; -e กัน pattern ขึ้นต้นด้วย -
      const { stdout } = await execAsync(
        `rg --line-number --no-heading --max-count 50 -e ${JSON.stringify(pattern)} -- ${JSON.stringify(path)}`,
        { maxBuffer: 10 * 1024 * 1024 },
      );
      const lines = stdout.trim().split('\n').slice(0, MAX_RESULTS);
      return clamp(lines.join('\n')) || '(no matches)';
    } catch (err) {
      // ripgrep exit code 1 = ไม่เจอ match (ไม่ใช่ error จริง)
      const e = err as { code?: number };
      if (e.code === 1) return '(no matches)';
      return `ERROR: grep "${pattern}" ล้มเหลว — ${(err as Error).message}`;
    }
  },
});
