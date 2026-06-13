import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { checkWritePath } from './permission.js';

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
    'แก้ไฟล์โดยแทนที่ old_string ด้วย new_string. old_string ต้องมีอยู่จริงและ unique ในไฟล์ (ใส่ context รอบๆ ให้พอระบุตำแหน่งเดียว). อ่านไฟล์ด้วย read_file ก่อนเสมอ',
  inputSchema: z.object({
    path: z.string().describe('path ของไฟล์ที่จะแก้'),
    old_string: z.string().describe('ข้อความเดิมที่จะถูกแทนที่ (ต้องตรงและ unique)'),
    new_string: z.string().describe('ข้อความใหม่'),
  }),
  execute: async ({ path, old_string, new_string }) => {
    const guard = checkWritePath(path);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    if (old_string === '') return `ERROR: old_string ต้องไม่ว่าง`;
    if (old_string === new_string) {
      return `ERROR: old_string กับ new_string เหมือนกัน — ไม่มีอะไรเปลี่ยน`;
    }

    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      return `ERROR: อ่านไฟล์ "${path}" ไม่ได้ — ${(err as Error).message}`;
    }

    // normalize CRLF→LF เพื่อให้ match/offset consistent แล้ว restore EOL เดิมตอนเขียน
    // (กัน flex match กิน \r แล้วทำ line ending พังบนไฟล์ Windows)
    const usesCRLF = raw.includes('\r\n');
    const content = usesCRLF ? raw.replace(/\r\n/g, '\n') : raw;
    const oldNorm = old_string.replace(/\r\n/g, '\n');
    const newNorm = new_string.replace(/\r\n/g, '\n');

    const m = findMatch(content, oldNorm);
    if (!m) {
      return `ERROR: ไม่พบ old_string ในไฟล์ "${path}" — อ่านไฟล์ใหม่ด้วย read_file แล้วคัดข้อความที่ตรงเป๊ะมาใช้`;
    }
    if (m.count > 1) {
      return `ERROR: old_string พบ ${m.count} ที่ในไฟล์ "${path}" (ต้อง unique) — ใส่ context รอบๆ ให้มากขึ้นเพื่อระบุตำแหน่งเดียว`;
    }

    let updated = content.slice(0, m.start) + newNorm + content.slice(m.end);
    if (usesCRLF) updated = updated.replace(/\n/g, '\r\n');
    try {
      await writeFile(path, updated, 'utf8');
    } catch (err) {
      return `ERROR: เขียนไฟล์ "${path}" ไม่ได้ — ${(err as Error).message}`;
    }
    return `OK: แก้ "${path}" สำเร็จ (แทนที่ 1 ที่)`;
  },
});
