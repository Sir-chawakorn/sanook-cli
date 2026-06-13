import { tool } from 'ai';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// กัน context ระเบิด — tool output ที่ยาวเกินถูกตัด
const MAX_OUTPUT = 30_000;

// safety guard ขั้นต่ำ: ปฏิเสธคำสั่งทำลายล้าง irreversible (ก่อนมี permission gate เต็มใน M1)
const DENY = /(\brm\s+-rf\b|\bgit\s+reset\s+--hard\b|\bgit\s+push\s+.*--force\b|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|\bchmod\s+-R\s+777\b|>\s*\/dev\/sd)/i;

function clamp(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n... [truncated ${s.length - MAX_OUTPUT} chars]` : s;
}

export const readFileTool = tool({
  description: 'อ่านไฟล์ใน workspace แล้วคืนเนื้อหา (UTF-8). ใช้เพื่อดูโค้ด/ไฟล์ก่อนตอบ',
  inputSchema: z.object({
    path: z.string().describe('relative หรือ absolute path ของไฟล์ที่จะอ่าน'),
  }),
  execute: async ({ path }) => {
    try {
      return clamp(await readFile(path, 'utf8'));
    } catch (err) {
      // คืน error เป็นข้อความให้ model แก้เอง (self-heal) — ไม่ throw ออก loop
      return `ERROR: อ่านไฟล์ "${path}" ไม่ได้ — ${(err as Error).message}`;
    }
  },
});

export const bashTool = tool({
  description: 'รันคำสั่ง shell (ls/grep/find/cat ฯลฯ) เพื่อค้นหา/ตรวจสอบ workspace แล้วคืน output',
  inputSchema: z.object({
    cmd: z.string().describe('คำสั่ง shell ที่จะรัน'),
  }),
  execute: async ({ cmd }) => {
    if (DENY.test(cmd)) {
      return `BLOCKED: คำสั่ง "${cmd}" ถูกปฏิเสธโดย safety guard (destructive/irreversible)`;
    }
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
      const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
      return clamp(out) || '(no output)';
    } catch (err) {
      return `ERROR: คำสั่งล้มเหลว — ${(err as Error).message}`;
    }
  },
});

export const tools = {
  read_file: readFileTool,
  run_bash: bashTool,
};
