import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { runGit, isGitRepo } from './git.js';

// repo map = symbol map คร่าวๆ ของ repo (zero-dep, regex per ภาษา) inject ตอน session start
// ช่วย agent เลือกไฟล์ถูกโดยไม่ต้อง grep/read ทีละไฟล์ — เลียน Aider repo-map (เวอร์ชัน lightweight)
const MAX_FILES = 400;
const MAX_FILE_BYTES = 32 * 1024;
const SYMS_PER_FILE = 12;
const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs',
  '.java', '.rb', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.swift', '.kt',
]);
const IGNORE_DIR = /(^|\/)(node_modules|dist|build|coverage|\.next|\.cache|\.git|vendor|__pycache__)(\/|$)/;

// regex ดึง top-level / exported symbol — หลายภาษา รวมกัน dedup
const SYMBOL_PATTERNS: RegExp[] = [
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm, // TS/JS export
  /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm, // JS function
  /^(?:export\s+)?class\s+([A-Za-z0-9_$]+)/gm, // JS class
  /^(?:def|class)\s+([A-Za-z0-9_]+)/gm, // Python
  /^func\s+(?:\([^)]*\)\s+)?([A-Za-z0-9_]+)/gm, // Go
  /^(?:pub\s+)?(?:fn|struct|enum|trait|impl)\s+([A-Za-z0-9_]+)/gm, // Rust
];

function extractSymbols(content: string): string[] {
  const found = new Set<string>();
  for (const re of SYMBOL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) found.add(m[1]);
      if (found.size >= SYMS_PER_FILE * 3) break;
    }
  }
  return [...found].slice(0, SYMS_PER_FILE);
}

function isSource(rel: string): boolean {
  return SOURCE_EXT.has(extname(rel).toLowerCase()) && !IGNORE_DIR.test(rel);
}

// คืน null = git ล้มชั่วคราว (อย่า cache, ลองใหม่รอบหน้า) · [] = ไม่ใช่ git repo จริงๆ (cache ได้)
async function listFiles(cwd: string): Promise<string[] | null> {
  if (await isGitRepo(cwd)) {
    try {
      return (await runGit(['ls-files'], cwd)).split('\n').filter(Boolean);
    } catch {
      return null; // ls-files ล้ม (เช่น maxBuffer / index lock) ≠ repo ว่าง
    }
  }
  return [];
}

let cached: { cwd: string; map: string } | null = null;

/**
 * โครงสร้าง symbol ของ repo (cap ที่ maxChars) — cache ต่อ process ต่อ cwd (โครงสร้างไม่ค่อยเปลี่ยนกลาง session)
 * คืน '' ถ้าไม่ใช่ git repo / ไม่มี source file (เช่น brain vault ที่มีแต่ markdown)
 */
export async function loadRepoMap(cwd: string = process.cwd(), maxChars = 4000): Promise<string> {
  if (cached && cached.cwd === cwd) return cached.map;
  const raw = await listFiles(cwd);
  if (raw === null) return ''; // git ล้มชั่วคราว → คืนว่างแต่ไม่ cache (ลองใหม่รอบหน้า)
  const files = raw.filter(isSource).slice(0, MAX_FILES);
  if (!files.length) {
    cached = { cwd, map: '' };
    return '';
  }
  const entries = await Promise.all(
    files.map(async (rel) => {
      try {
        const content = (await readFile(join(cwd, rel), 'utf8')).slice(0, MAX_FILE_BYTES);
        const syms = extractSymbols(content);
        return syms.length ? `${rel}: ${syms.join(', ')}` : rel;
      } catch {
        return rel;
      }
    }),
  );

  let body = '';
  for (const e of entries) {
    if (body.length + e.length + 1 > maxChars) {
      body += '\n…';
      break;
    }
    body += (body ? '\n' : '') + e;
  }
  const map = `<repo_map note="symbol คร่าวๆ ของ repo (อาจไม่ครบ/ไม่เป๊ะ) — ใช้ glob/grep/read_file ยืนยันก่อนแก้">\n${body}\n</repo_map>`;
  cached = { cwd, map };
  return map;
}

/** เคลียร์ cache (สำหรับ test / เมื่อ cwd เปลี่ยน) */
export function clearRepoMapCache(): void {
  cached = null;
}
