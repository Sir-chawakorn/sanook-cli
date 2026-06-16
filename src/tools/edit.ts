import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { checkWritePath } from './permission.js';
import { resolveAgentPath } from './util.js';
import { renderEditDiff } from '../diff.js';

export interface Match {
  start: number;
  end: number;
  count: number;
}

/** tier 1: exact substring match + นับจำนวนครั้ง */
export function exactMatch(content: string, needle: string): Match | null {
  if (needle.length === 0) return null; // กัน infinite loop จาก empty needle
  const first = content.indexOf(needle);
  if (first === -1) return null;
  let count = 0;
  let i = 0;
  // i += 1 เพื่อ count overlapping occurrences ถูก (เช่น 'aaa'/'aa' = 2, '\n\n\n'/'\n\n' = 2)
  while ((i = content.indexOf(needle, i)) !== -1) {
    count++;
    i += 1;
  }
  return { start: first, end: first + needle.length, count };
}

/**
 * tier 2: whitespace-flexible — เทียบทีละบรรทัดแบบ trim (indentation/trailing space ต่างได้)
 * คืน offset ของบล็อกที่ match ในไฟล์จริง (รวม indentation เดิม)
 */
export function whitespaceFlexMatch(content: string, needle: string): Match | null {
  const needleLines = needle.split('\n').map((l) => l.trim());
  const contentLines = content.split('\n');

  // offset อักขระของจุดเริ่มแต่ละบรรทัด
  const offsets: number[] = [];
  let acc = 0;
  for (const l of contentLines) {
    offsets.push(acc);
    acc += l.length + 1; // +1 = '\n'
  }

  const matchStarts: number[] = [];
  for (let i = 0; i + needleLines.length <= contentLines.length; i++) {
    let ok = true;
    for (let j = 0; j < needleLines.length; j++) {
      if (contentLines[i + j].trim() !== needleLines[j]) {
        ok = false;
        break;
      }
    }
    if (ok) matchStarts.push(i);
  }
  if (matchStarts.length === 0) return null;

  const i = matchStarts[0];
  const lastLineIdx = i + needleLines.length - 1;
  const start = offsets[i];
  const end = offsets[lastLineIdx] + contentLines[lastLineIdx].length; // ไม่รวม '\n' ท้าย
  return { start, end, count: matchStarts.length };
}

/** หา match แบบ multi-tier: exact ก่อน แล้วค่อย whitespace-flexible */
export function findMatch(content: string, needle: string): Match | null {
  return exactMatch(content, needle) ?? whitespaceFlexMatch(content, needle);
}

export const editFileTool = tool({
  description:
    'แก้ไฟล์แบบ search/replace — แทนที่เฉพาะ "ช่วงที่ส่งมา" ไม่ใช่ทั้งไฟล์/ทั้งบรรทัด. ' +
    'ให้ old_string สั้นที่สุดเท่าที่ยัง unique (ประหยัด token — ไม่ต้องลอกทั้งบรรทัด/ทั้ง block ถ้าไม่จำเป็น). ' +
    'จะแก้ token เดิมหลายที่ (rename) → ตั้ง replace_all:true แล้วใส่ old_string สั้นๆ ได้เลย ไม่ต้องทำให้ unique. อ่านไฟล์ด้วย read_file ก่อนเสมอ',
  inputSchema: z.object({
    path: z.string().describe('path ของไฟล์ที่จะแก้'),
    old_string: z.string().describe('ข้อความเดิมที่จะถูกแทนที่ — สั้นที่สุดที่ยัง unique (replace_all:true ไม่ต้อง unique)'),
    new_string: z.string().describe('ข้อความใหม่'),
    replace_all: z.boolean().optional().describe('true = แทนที่ทุกที่ที่ตรง old_string เป๊ะ (เหมาะกับ rename) — old_string ไม่ต้อง unique'),
  }),
  execute: async ({ path, old_string, new_string, replace_all = false }) => {
    const full = resolveAgentPath(path); // relative ผูกกับ agentCwd (worktree ของ sub-agent ถ้ามี)
    const guard = await checkWritePath(full);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    if (old_string === '') return `ERROR: old_string ต้องไม่ว่าง`;
    if (old_string === new_string) {
      return `ERROR: old_string กับ new_string เหมือนกัน — ไม่มีอะไรเปลี่ยน`;
    }

    let raw: string;
    try {
      raw = await readFile(full, 'utf8');
    } catch (err) {
      return `ERROR: อ่านไฟล์ "${path}" ไม่ได้ — ${(err as Error).message}`;
    }

    // normalize CRLF→LF เพื่อให้ match/offset consistent แล้ว restore EOL เดิมตอนเขียน
    // (กัน flex match กิน \r แล้วทำ line ending พังบนไฟล์ Windows)
    const usesCRLF = raw.includes('\r\n');
    const content = usesCRLF ? raw.replace(/\r\n/g, '\n') : raw;
    const oldNorm = old_string.replace(/\r\n/g, '\n');
    const newNorm = new_string.replace(/\r\n/g, '\n');

    // replace_all: แทนที่ทุกที่ที่ตรง "เป๊ะ" (exact เท่านั้น — flex หลายช่วงกำกวม) → old_string สั้นได้ ไม่ต้อง unique
    if (replace_all) {
      const exact = exactMatch(content, oldNorm);
      if (!exact) {
        return `ERROR: ไม่พบ old_string ในไฟล์ "${path}" — replace_all ใช้ match แบบตรงเป๊ะเท่านั้น (อ่านไฟล์ใหม่แล้วคัดข้อความที่ตรง)`;
      }
      const parts = content.split(oldNorm); // split/join = แทนที่ทุกที่ (string literal, ไม่ใช่ regex)
      let updated = parts.join(newNorm);
      if (usesCRLF) updated = updated.replace(/\n/g, '\r\n');
      try {
        await writeFile(full, updated, 'utf8');
      } catch (err) {
        return `ERROR: เขียนไฟล์ "${path}" ไม่ได้ — ${(err as Error).message}`;
      }
      // นับจาก split (non-overlapping จริง) ไม่ใช่ exact.count ที่นับ overlapping → เลขตรงกับที่แทนจริง
      return `OK: แก้ "${path}" (${parts.length - 1} ที่)\n${renderEditDiff(oldNorm, newNorm)}`;
    }

    const exact = exactMatch(content, oldNorm);
    const m = exact ?? whitespaceFlexMatch(content, oldNorm);
    const isFlex = !exact && !!m; // match มาจาก tier whitespace-flex (old_string indentation ไม่ตรงไฟล์)
    if (!m) {
      return `ERROR: ไม่พบ old_string ในไฟล์ "${path}" — อ่านไฟล์ใหม่ด้วย read_file แล้วคัดข้อความที่ตรงเป๊ะมาใช้`;
    }
    if (m.count > 1) {
      // flex tier: replace_all ใช้ไม่ได้ (exact-only) → แนะให้ใส่ context อย่างเดียว กัน dead-end loop
      return isFlex
        ? `ERROR: old_string ตรง ${m.count} ที่ในไฟล์ "${path}" (แบบ flex) — ใส่ context รอบๆ ให้ unique แล้วลองใหม่`
        : `ERROR: old_string พบ ${m.count} ที่ในไฟล์ "${path}" — ตั้ง replace_all:true เพื่อแก้ทุกที่ หรือใส่ context รอบๆ ให้พอ unique (ใช้เท่าที่จำเป็น ประหยัด token)`;
    }

    // flex match กิน indentation เดิมของไฟล์ (เทียบแบบ trim) — ต้อง re-apply indent ให้ replacement
    // ไม่งั้น code โดน de-indent (พัง Python/YAML + เยื้องเพี้ยนทุกภาษา) แบบเงียบๆ
    let replacement = newNorm;
    if (isFlex) {
      const baseIndent = content.slice(m.start).match(/^[ \t]*/)?.[0] ?? '';
      if (baseIndent) {
        const newLines = newNorm.split('\n');
        const nonBlank = newLines.filter((l) => l.trim() !== '');
        const commonNew = nonBlank.length ? Math.min(...nonBlank.map((l) => (l.match(/^[ \t]*/)?.[0].length ?? 0))) : 0;
        replacement = newLines.map((l) => (l.trim() === '' ? l : baseIndent + l.slice(commonNew))).join('\n');
      }
    }

    let updated = content.slice(0, m.start) + replacement + content.slice(m.end);
    if (usesCRLF) updated = updated.replace(/\n/g, '\r\n');
    try {
      await writeFile(full, updated, 'utf8');
    } catch (err) {
      return `ERROR: เขียนไฟล์ "${path}" ไม่ได้ — ${(err as Error).message}`;
    }
    return `OK: แก้ "${path}" (1 ที่)\n${renderEditDiff(oldNorm, newNorm)}`;
  },
});
