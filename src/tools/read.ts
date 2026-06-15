import { tool } from 'ai';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { clamp, resolveAgentPath } from './util.js';
import { checkReadPath } from './permission.js';

export const readFileTool = tool({
  description:
    'อ่านไฟล์ใน workspace (UTF-8). อ่านก่อนแก้ไฟล์เสมอ. ' +
    'ไฟล์ใหญ่หรือต้องการแค่บางส่วน → ใส่ offset/limit อ่านเฉพาะช่วงบรรทัด (ประหยัด token มาก — คู่กับ grep ที่ให้เลขบรรทัด)',
  inputSchema: z.object({
    path: z.string().describe('relative หรือ absolute path ของไฟล์ที่จะอ่าน'),
    offset: z.number().int().min(1).optional().describe('บรรทัดเริ่ม (1-based) — อ่านเฉพาะช่วง ไม่ใส่ = ต้นไฟล์'),
    limit: z.number().int().min(1).optional().describe('จำนวนบรรทัดจาก offset — ไม่ใส่ = ถึงท้ายไฟล์'),
  }),
  execute: async ({ path, offset, limit }) => {
    const full = resolveAgentPath(path); // relative ผูกกับ agentCwd (worktree ของ sub-agent ถ้ามี)
    const guard = await checkReadPath(full);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    try {
      const content = await readFile(full, 'utf8');
      // ไม่ระบุช่วง → คืนทั้งไฟล์ (clamp) เหมือนเดิม
      if (offset == null && limit == null) return clamp(content);
      // ระบุช่วง → อ่านเฉพาะบรรทัด start..end (ส่งเฉพาะที่ต้องการเข้า context, ประหยัด token)
      const lines = content.split('\n');
      const start = Math.max(0, (offset ?? 1) - 1);
      if (start >= lines.length) return `(ไฟล์มี ${lines.length} บรรทัด — offset ${offset} เกินช่วง)`;
      const end = limit == null ? lines.length : Math.min(lines.length, start + limit);
      const slice = lines.slice(start, end).join('\n');
      return clamp(`[บรรทัด ${start + 1}-${end} จาก ${lines.length}]\n${slice}`);
    } catch (err) {
      return `ERROR: อ่านไฟล์ "${path}" ไม่ได้ — ${(err as Error).message}`;
    }
  },
});
