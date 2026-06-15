import { tool } from 'ai';
import { z } from 'zod';
import { diagnose } from '../lsp/index.js';
import { resolveAgentPath } from './util.js';
import { agentCwd } from '../agentContext.js';
import { checkReadPath } from './permission.js';
import { clamp } from './util.js';
import type { Severity } from '../lsp/client.js';

const SYM: Record<Severity, string> = { error: '✗', warning: '⚠', info: 'ℹ', hint: '·' };
const MAX_SHOWN = 100;

/**
 * diagnostics tool — type errors/warnings จาก language server (LSP) ของไฟล์เดียว
 * โดยไม่ต้อง build ทั้งโปรเจค. ปิด verify-loop: agent แก้ไฟล์ → ตรวจ → แก้ error ต่อทันที.
 * graceful: ไม่มี server ติดตั้ง → บอกวิธีติดตั้ง (ไม่ crash). respect worktree (agentCwd).
 */
export const diagnosticsTool = tool({
  description:
    'ตรวจ type error / warning ของไฟล์ด้วย language server (LSP) — เรียก "หลังแก้ไฟล์" เพื่อจับ error ทันทีโดยไม่ต้อง build/test ทั้งโปรเจค. ' +
    'รองรับ TS/JS · Python · Go · Rust · JSON ฯลฯ (ถ้าติดตั้ง LSP server ไว้; ไม่มี = บอกวิธีติดตั้ง). ' +
    'ใส่ content เพื่อตรวจฉบับที่ยังไม่ save ได้',
  inputSchema: z.object({
    path: z.string().describe('path ไฟล์ที่จะตรวจ'),
    content: z.string().optional().describe('เนื้อหาที่จะตรวจ (ฉบับยังไม่ save) — ไม่ใส่ = อ่านจากดิสก์'),
  }),
  execute: async ({ path, content }) => {
    const full = resolveAgentPath(path);
    const guard = await checkReadPath(full);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;

    const r = await diagnose(full, { cwd: agentCwd(), content });
    if (!r.ok) return `LSP: ${r.reason}`;
    if (!r.diagnostics.length) return `✓ ไม่มี diagnostics (${r.serverId}) — ${path}`;

    const errs = r.diagnostics.filter((d) => d.severity === 'error').length;
    const warns = r.diagnostics.filter((d) => d.severity === 'warning').length;
    const lines = r.diagnostics
      .slice(0, MAX_SHOWN)
      .map((d) => `${SYM[d.severity]} ${path}:${d.line}:${d.character} ${d.message}${d.code != null ? ` [${d.code}]` : ''}`);
    const more = r.diagnostics.length > MAX_SHOWN ? `\n… +${r.diagnostics.length - MAX_SHOWN} เพิ่มเติม` : '';
    return clamp(`${errs} error · ${warns} warning (${r.serverId}):\n${lines.join('\n')}${more}`);
  },
});
