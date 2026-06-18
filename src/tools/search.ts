import { tool } from 'ai';
import { z } from 'zod';
import { glob, readdir, stat, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { clamp, resolveAgentPath } from './util.js';
import { checkReadPath } from './permission.js';
import { agentCwd } from '../agentContext.js';

// pure-JS grep fallback — ใช้เมื่อ ripgrep (rg) ไม่ได้ติดตั้ง (เช่น Windows สะอาด) → grep ใช้ได้ทุกแพลตฟอร์ม
const FALLBACK_IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache', '.turbo', '.vercel', 'vendor']);
const FALLBACK_IGNORE_FILES = new Set(['.ds_store', '.localized', 'desktop.ini', 'thumbs.db']);
const FALLBACK_MAX_FILE = 2 * 1024 * 1024; // ข้ามไฟล์ใหญ่ (กันช้า/binary)
const PER_FILE_CAP = 50; // เหมือน rg --max-count 50

function isFallbackIgnoredFile(name: string): boolean {
  return FALLBACK_IGNORE_FILES.has(name.toLowerCase()) || name.startsWith('._');
}

function isFallbackIgnoredDir(name: string): boolean {
  return FALLBACK_IGNORE.has(name.toLowerCase()) || name.startsWith('.');
}

function otherAsciiCase(ch: string): string | undefined {
  const code = ch.charCodeAt(0);
  if (code >= 65 && code <= 90) return ch.toLowerCase();
  if (code >= 97 && code <= 122) return ch.toUpperCase();
  return undefined;
}

function isAsciiLower(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 97 && code <= 122;
}

function isAsciiUpper(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 65 && code <= 90;
}

function findCharClassEnd(source: string, start: number): number {
  let escaping = false;
  const literalRightBracket = source[start] === '^' ? start + 1 : start;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (ch === ']' && i !== literalRightBracket) return i;
  }
  return -1;
}

function findScopedGroupEnd(source: string, start: number): number {
  let depth = 1;
  let escaping = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (ch === '[') {
      const end = findCharClassEnd(source, i + 1);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function foldAsciiRegexCharClass(source: string): string {
  let out = '';
  const literalRightBracket = source[0] === '^' ? 1 : 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === ']' && i === literalRightBracket) {
      out += '\\]';
      continue;
    }
    if (ch === '\\' && i + 1 < source.length) {
      out += `${ch}${source[i + 1]}`;
      i += 1;
      continue;
    }
    if (
      i + 2 < source.length &&
      source[i + 1] === '-' &&
      source[i + 2] !== ']' &&
      ((isAsciiLower(ch) && isAsciiLower(source[i + 2])) || (isAsciiUpper(ch) && isAsciiUpper(source[i + 2]))) &&
      ch.charCodeAt(0) <= source[i + 2].charCodeAt(0)
    ) {
      out += `${ch}-${source[i + 2]}${otherAsciiCase(ch)}-${otherAsciiCase(source[i + 2])}`;
      i += 2;
      continue;
    }
    const other = i === 0 && ch === '^' ? undefined : otherAsciiCase(ch);
    out += other ? `${ch}${other}` : ch;
  }
  return out;
}

function foldAsciiRegexLetters(source: string): string {
  let out = '';
  let escaping = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (escaping) {
      out += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaping = true;
      continue;
    }
    if (ch === '[') {
      const end = findCharClassEnd(source, i + 1);
      if (end < 0) {
        out += ch;
        continue;
      }
      out += `[${foldAsciiRegexCharClass(source.slice(i + 1, end))}]`;
      i = end;
      continue;
    }
    const other = otherAsciiCase(ch);
    out += other ? `[${ch}${other}]` : ch;
  }
  return out;
}

function expandScopedCaseInsensitiveGroups(pattern: string): string | undefined {
  let out = '';
  let changed = false;
  let escaping = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (escaping) {
      out += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaping = true;
      continue;
    }
    if (ch === '[') {
      const end = findCharClassEnd(pattern, i + 1);
      if (end < 0) return undefined;
      out += pattern.slice(i, end + 1);
      i = end;
      continue;
    }
    if (!pattern.startsWith('(?i:', i)) {
      out += ch;
      continue;
    }
    const end = findScopedGroupEnd(pattern, i + 4);
    if (end < 0) return undefined;
    out += `(?:${foldAsciiRegexLetters(pattern.slice(i + 4, end))})`;
    i = end;
    changed = true;
  }
  return changed ? out : undefined;
}

function compileFallbackRegex(pattern: string): RegExp {
  const caseInsensitive = pattern.match(/^\(\?i\)([\s\S]*)$/);
  if (caseInsensitive) {
    const source = expandScopedCaseInsensitiveGroups(caseInsensitive[1]) ?? caseInsensitive[1];
    return new RegExp(source, 'i');
  }
  const scopedCaseInsensitive = expandScopedCaseInsensitiveGroups(pattern);
  if (scopedCaseInsensitive) return new RegExp(scopedCaseInsensitive);
  return new RegExp(pattern); // rg ใช้ Rust regex; JS regex ใกล้เคียงพอสำหรับ pattern ทั่วไป
}

export async function jsGrep(pattern: string, base: string, target: string): Promise<string> {
  let re: RegExp;
  try {
    re = compileFallbackRegex(pattern);
  } catch {
    return `ERROR: grep regex ไม่ถูกต้อง: "${pattern}"`;
  }
  const root = isAbsolute(target) ? target : join(base, target);
  const rootGuard = await checkReadPath(root);
  if (!rootGuard.ok) return `BLOCKED: ${rootGuard.reason}`;
  const out: string[] = [];
  let truncated = false;
  const scanFile = async (full: string): Promise<void> => {
    const guard = await checkReadPath(full);
    if (!guard.ok) return;
    let s;
    try {
      s = await stat(full);
    } catch {
      return;
    }
    if (s.size > FALLBACK_MAX_FILE) return;
    let content: string;
    try {
      content = await readFile(full, 'utf8');
    } catch {
      return;
    }
    if (content.includes('\u0000')) return; // binary
    const rel = relative(base, full) || full;
    const lines = content.split(/\r\n|\n|\r/);
    let perFile = 0;
    for (let i = 0; i < lines.length && !truncated; i++) {
      if (re.test(lines[i])) {
        if (out.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }
        out.push(`${rel}:${i + 1}:${lines[i].slice(0, 300)}`);
        if (++perFile >= PER_FILE_CAP) break;
      }
    }
  };
  const walk = async (dir: string): Promise<void> => {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (truncated) return;
      const full = join(dir, e.name);
      const guard = await checkReadPath(full);
      if (!guard.ok) continue;
      if (e.isDirectory()) {
        if (!isFallbackIgnoredDir(e.name)) await walk(full);
      } else if (e.isFile() && !isFallbackIgnoredFile(e.name)) {
        await scanFile(full);
      }
    }
  };
  let st;
  try {
    st = await stat(root);
  } catch {
    return `ERROR: grep path ไม่พบ: "${target}"`;
  }
  if (st.isFile()) await scanFile(root);
  else await walk(root);
  if (!out.length) return '(no matches)';
  if (truncated) out.push(`... [>${MAX_RESULTS} matches, truncated]`);
  return `${clamp(out.join('\n'))}\n[JS fallback — ติดตั้ง ripgrep (rg) เพื่อความเร็ว + เคารพ .gitignore: brew/apt/choco/scoop install ripgrep]`;
}

const execFileAsync = promisify(execFile);
const MAX_RESULTS = 200;

export function formatRipgrepOutput(stdout: string): string {
  const text = stdout.replace(/(?:\r\n|\n|\r)$/, '');
  if (!text) return '(no matches)';
  const allLines = text.split(/\r\n|\n|\r/);
  const lines = allLines.slice(0, MAX_RESULTS);
  if (allLines.length > MAX_RESULTS) lines.push(`... [>${MAX_RESULTS} matches, truncated]`);
  return clamp(lines.join('\n')) || '(no matches)';
}

function unsafeGlobPattern(pattern: string): boolean {
  return isAbsolute(pattern) || pattern.split(/[\\/]+/).includes('..');
}

export const globTool = tool({
  description: 'หาไฟล์ด้วย glob pattern (เช่น "src/**/*.ts", "**/*.json")',
  inputSchema: z.object({
    pattern: z.string().describe('glob pattern'),
    cwd: z.string().default('.').describe('directory ที่จะค้นจาก'),
  }),
  execute: async ({ pattern, cwd }) => {
    if (unsafeGlobPattern(pattern)) {
      return `BLOCKED: glob pattern ต้องเป็น relative path ภายใน cwd และห้ามมี "..": "${pattern}"`;
    }
    const base = resolveAgentPath(cwd); // '.' → agentCwd (worktree ของ sub-agent ถ้ามี)
    const guard = await checkReadPath(base);
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    try {
      const out: string[] = [];
      let truncated = false;
      for await (const f of glob(pattern, { cwd: base })) {
        const match = String(f);
        const itemGuard = await checkReadPath(join(base, match));
        if (!itemGuard.ok) continue;
        if (out.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }
        out.push(match);
      }
      out.sort();
      if (truncated) out.push(`... [>${MAX_RESULTS} matches, truncated]`);
      return out.length ? out.join('\n') : '(no matches)';
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
    const base = agentCwd(); // รัน rg ใน worktree ของ sub-agent ถ้ามี → path relative ผูกถูก tree
    const guard = await checkReadPath(resolveAgentPath(path));
    if (!guard.ok) return `BLOCKED: ${guard.reason}`;
    try {
      // execFile (args array, ไม่ผ่าน shell) → $(...)/backtick/$VAR ใน pattern/path เป็น inert
      // กัน command injection (JSON.stringify ไม่ใช่ shell quoting — เคยรั่ว); -e กัน pattern ขึ้นต้นด้วย -
      const { stdout } = await execFileAsync(
        'rg',
        ['--line-number', '--no-heading', '--max-count', '50', '-e', pattern, '--', path],
        { cwd: base, maxBuffer: 10 * 1024 * 1024 },
      );
      return formatRipgrepOutput(stdout);
    } catch (err) {
      // ripgrep exit code 1 = ไม่เจอ match (ไม่ใช่ error จริง)
      const e = err as { code?: number | string };
      if (e.code === 1) return '(no matches)';
      // rg ไม่ได้ติดตั้ง (Windows สะอาด ฯลฯ) → fallback เป็น JS grep ให้ใช้ได้ทุกแพลตฟอร์ม
      if (e.code === 'ENOENT') return jsGrep(pattern, base, path);
      return `ERROR: grep "${pattern}" ล้มเหลว — ${(err as Error).message}`;
    }
  },
});
