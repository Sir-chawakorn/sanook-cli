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
const FALLBACK_MAX_FILE = 2 * 1024 * 1024; // ข้ามไฟล์ใหญ่ (กันช้า/binary)
const PER_FILE_CAP = 50; // เหมือน rg --max-count 50

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
    const lines = content.split(/\r?\n/);
    let perFile = 0;
    for (let i = 0; i < lines.length && out.length < MAX_RESULTS; i++) {
      if (re.test(lines[i])) {
        out.push(`${rel}:${i + 1}:${lines[i].slice(0, 300)}`);
        if (++perFile >= PER_FILE_CAP) break;
      }
    }
  };
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= MAX_RESULTS) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (out.length >= MAX_RESULTS) return;
      if (e.isDirectory()) {
        if (!FALLBACK_IGNORE.has(e.name) && !e.name.startsWith('.')) await walk(join(dir, e.name));
      } else if (e.isFile()) {
        await scanFile(join(dir, e.name));
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
  return `${clamp(out.join('\n'))}\n[JS fallback — ติดตั้ง ripgrep (rg) เพื่อความเร็ว + เคารพ .gitignore: brew/apt/choco/scoop install ripgrep]`;
}

const execFileAsync = promisify(execFile);
const MAX_RESULTS = 200;

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
      for await (const f of glob(pattern, { cwd: base })) {
        const match = String(f);
        const itemGuard = await checkReadPath(join(base, match));
        if (!itemGuard.ok) continue;
        out.push(match);
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
      const lines = stdout.trim().split('\n').slice(0, MAX_RESULTS);
      return clamp(lines.join('\n')) || '(no matches)';
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
