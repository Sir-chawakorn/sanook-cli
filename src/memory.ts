import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

const MEMORY_FILE = 'SANOOK.md';
// auto-memory: สิ่งที่ agent จำเองข้าม session (เลียน MEMORY.md ของ Claude Code)
const AUTO_MEMORY_DIR = join(homedir(), '.sanook', 'memory');
const AUTO_MEMORY_FILE = join(AUTO_MEMORY_DIR, 'MEMORY.md');
// เดินขึ้นหยุดที่ project root — ไม่เลยขึ้นไปถึง filesystem root
// (กัน prompt-injection จาก SANOOK.md ที่ใครก็วางใน parent dir ที่ share กันได้)
const BOUNDARY_MARKERS = ['.git', 'package.json'];

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * โหลด project memory (SANOOK.md) แบบ hierarchical:
 * global (~/.sanook/SANOOK.md) → project root → ... → cwd
 * - หยุดเดินขึ้นที่ project boundary (.git/package.json) ไม่ถึง / (security)
 * - normalize cwd เป็น absolute ก่อนเดิน (กัน infinite loop จาก relative path)
 * ไฟล์ที่ specific กว่า (ใกล้ cwd) อยู่ท้าย = override general
 */
export async function loadMemory(cwd: string = process.cwd()): Promise<string> {
  const start = resolve(cwd); // → absolute เสมอ

  // chain จาก cwd ขึ้นไปจนเจอ project boundary (หรือถึง fs root)
  const chain: string[] = [];
  let dir = start;
  for (;;) {
    chain.push(dir);
    const atBoundary = (await Promise.all(BOUNDARY_MARKERS.map((mk) => exists(join(dir, mk))))).some(Boolean);
    if (atBoundary) break;
    const parent = dirname(dir);
    if (parent === dir) break; // ถึง fs root — guard กัน infinite loop
    dir = parent;
  }
  chain.reverse(); // project root ก่อน → cwd ท้าย (local override general)

  const paths = [join(homedir(), '.sanook', MEMORY_FILE), ...chain.map((d) => join(d, MEMORY_FILE))];

  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    try {
      const content = (await readFile(p, 'utf8')).trim();
      if (content) blocks.push(`<memory src="${p}">\n${content}\n</memory>`);
    } catch {
      // ไม่มีไฟล์ = ข้าม
    }
  }
  return blocks.join('\n\n');
}

/** โหลด auto-memory (สิ่งที่ agent จำเองข้าม session) จาก ~/.sanook/memory/MEMORY.md */
export async function loadAutoMemory(): Promise<string> {
  try {
    const content = (await readFile(AUTO_MEMORY_FILE, 'utf8')).trim();
    return content ? `<auto_memory note="สิ่งที่จำไว้จาก session ก่อน">\n${content}\n</auto_memory>` : '';
  } catch {
    return '';
  }
}

/** บันทึก fact ลง auto-memory (remember tool เรียก) — dedup บรรทัดซ้ำ */
export async function appendMemory(fact: string): Promise<void> {
  const line = `- ${fact.trim().replace(/\s+/g, ' ')}`;
  await mkdir(AUTO_MEMORY_DIR, { recursive: true });
  let existing = '';
  try {
    existing = await readFile(AUTO_MEMORY_FILE, 'utf8');
  } catch {
    /* ยังไม่มีไฟล์ */
  }
  if (existing.includes(line)) return; // จำแล้ว ไม่ซ้ำ
  const header = existing.trim() ? existing.trimEnd() : '# Sanook Auto-Memory';
  await writeFile(AUTO_MEMORY_FILE, `${header}\n${line}\n`);
}
