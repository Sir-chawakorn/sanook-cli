import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { checkReadPath } from '../tools/permission.js';

// @-file mentions: "@path" ใน prompt → inline เนื้อหาไฟล์ (text) หรือแนบเป็น image (รูป)
// ลด tool round-trip (agent ไม่ต้อง read_file เอง) + เปิดทาง vision input
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const MENTION_RE = /(?:^|\s)@([^\s]+)/g;
const MAX_INLINE = 60_000;

export interface ExpandedInput {
  /** prompt ที่ inline เนื้อหาไฟล์ text แล้ว */
  text: string;
  /** path ของรูปที่ mention (แนบเป็น image part) */
  images: string[];
  /** ไฟล์ที่อ้างถึงแต่อ่านไม่ได้ (แจ้ง user) */
  errors: string[];
}

/** แตก @mention ใน prompt: text file → inline, image → คืน path ไปแนบ, ที่เหลือคงไว้ */
export async function expandMentions(input: string): Promise<ExpandedInput> {
  const mentions = [...input.matchAll(MENTION_RE)].map((m) => m[1]);
  if (!mentions.length) return { text: input, images: [], errors: [] };

  const images: string[] = [];
  const errors: string[] = [];
  const inlined: string[] = [];

  for (const rel of [...new Set(mentions)]) {
    const abs = resolve(rel);
    if (IMAGE_EXT.has(extname(rel).toLowerCase())) {
      const guard = await checkReadPath(abs);
      if (guard.ok) images.push(abs);
      else errors.push(`@${rel} (${guard.reason})`);
      continue;
    }
    const guard = await checkReadPath(abs);
    if (!guard.ok) {
      errors.push(`@${rel} (${guard.reason})`);
      continue;
    }
    try {
      const content = (await readFile(abs, 'utf8')).slice(0, MAX_INLINE);
      inlined.push(`<file path="${rel}">\n${content}\n</file>`);
    } catch (e) {
      errors.push(`@${rel} (${(e as Error).message})`);
    }
  }

  const text = inlined.length ? `${input}\n\n${inlined.join('\n\n')}` : input;
  return { text, images, errors };
}
