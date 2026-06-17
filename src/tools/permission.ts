import { homedir } from 'node:os';
import { realpath, stat } from 'node:fs/promises';
import { dirname, resolve, join, sep } from 'node:path';
import { getBrainPath } from '../memory.js';
import { BRAND_ENV, envFlag } from '../brand.js';
import { agentCwd } from '../agentContext.js';

// Permission gate (M1): ก่อนมี interactive ask (M4) — hard-deny อันตราย, allow ที่เหลือ
// คำสั่ง shell ที่ทำลายล้าง irreversible
const DESTRUCTIVE_CMD =
  /(\bgit\s+reset\s+--hard\b|\bgit\s+push\b.*--force|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|\bchmod\s+-R\s+777\b|>\s*\/dev\/sd|\bsudo\b|\bcrontab\b)/i;
const PROTECTED_CMD_PATH =
  /(\$HOME|~)?\/?(\.ssh|\.aws|\.gnupg|\.sanook)(\/|\b)/i;
const ENV_READ_CMD =
  /(?:^|[\r\n;&|]\s*|\$\(\s*|[<>]\(\s*|`\s*)(?:(?:if|then|elif|while|until|do|time|command|builtin|exec)\s+)*(?:env\s+(?:-\S+\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(cat|less|more|sed|awk|tail|head|grep|rg)\b/gi;
const ENV_SOURCE_CMD =
  /(?:^|[\r\n;&|]\s*|\$\(\s*|[<>]\(\s*|`\s*)(?:(?:if|then|elif|while|until|do|time|command|builtin|exec)\s+)*(source\b|\.)/gi;
const ENV_WRITE_CMD =
  /(?:^|[\r\n;&|]\s*|\$\(\s*|[<>]\(\s*|`\s*)(?:(?:if|then|elif|while|until|do|time|command|builtin|exec)\s+)*(?:env\s+(?:-\S+\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(tee)\b/gi;
const NESTED_SHELL_CMD =
  /(?:^|[\r\n;&|]\s*|\$\(\s*|[<>]\(\s*|`\s*)(?:(?:if|then|elif|while|until|do|time|command|builtin|exec)\s+)*(?:env\s+(?:-\S+\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(sh|bash|zsh|dash|ksh|fish|csh|tcsh)\b/gi;
const ENV_CMD =
  /(?:^|[\r\n;&|]\s*|\$\(\s*|[<>]\(\s*|`\s*)(?:(?:if|then|elif|while|until|do|time|command|builtin|exec)\s+)*(env)\b/gi;

const HOME = homedir();
// ไฟล์ที่ห้ามเขียน (persistence backdoor): shell rc, git/npm config, ~/.sanook (token/mcp/hooks)
const PROTECTED_EXACT = new Set(
  ['.gitconfig', '.zshrc', '.bashrc', '.bash_profile', '.profile', '.zprofile', '.npmrc'].map((f) => join(HOME, f)),
);
// โฟลเดอร์ที่ห้ามเขียนเข้าไป (credentials + sanook internal)
const PROTECTED_DIRS = ['.ssh', '.aws', '.gnupg', '.sanook'].map((d) => join(HOME, d));
const PROTECTED_SEGMENTS = new Set(['.git', 'node_modules', '.ssh', '.aws', '.gnupg', '.sanook']);
const ENV_OPTIONS_WITH_VALUE = new Set(['-C', '--chdir', '-S', '--split-string', '-u', '--unset']);
const GIT_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--config-env',
  '--exec-path',
  '--git-dir',
  '--namespace',
  '--super-prefix',
  '--work-tree',
]);
const SHELL_OPTIONS_WITH_VALUE = new Set(['--init-file', '--rcfile']);

export type GateResult = { ok: true } | { ok: false; reason: string };

function hasRmRecursiveForce(cmd: string): boolean {
  for (const match of cmd.matchAll(/\brm\b([^;&|]*)/gi)) {
    const parts = match[1].split(/\s+/).filter(Boolean);
    const shortFlags = parts.filter((part) => /^-[^-]/.test(part)).join('');
    const recursive = /r/i.test(shortFlags) || parts.includes('--recursive') || parts.includes('--dir');
    const force = /f/i.test(shortFlags) || parts.includes('--force');
    if (recursive && force) return true;
  }
  return false;
}

function hasGitForcePush(cmd: string): boolean {
  for (const match of cmd.matchAll(/\bgit\b/gi)) {
    const args = shellishArgsAfter(cmd, match.index + match[0].length).map(cleanShellToken);
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '--') break;
      if (arg === 'push') {
        if (gitPushHasForceFlag(args.slice(i + 1))) return true;
        break;
      }
      if (gitOptionConsumesNext(arg)) {
        i += 1;
        continue;
      }
      if (arg.startsWith('-')) continue;
      break;
    }
  }
  return false;
}

function gitOptionConsumesNext(arg: string): boolean {
  return GIT_OPTIONS_WITH_VALUE.has(arg);
}

function gitPushHasForceFlag(args: string[]): boolean {
  for (const arg of args) {
    if (arg === '--') break;
    if (/^--force(?:$|[=-])/.test(arg) || /^-[^-]*f/.test(arg)) return true;
  }
  return false;
}

function protectedEnvToken(token: string): boolean {
  const clean = cleanShellToken(token);
  if (!clean || clean.startsWith('-')) return false;
  return hasProtectedEnvSegment(clean);
}

function decodeEscapedCodePoint(match: string, value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);
  return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
}

function decodeAnsiCQuoteBody(body: string): string {
  return body
    .replace(/\\x([0-9a-fA-F]{1,2})/g, (match, hex: string) => decodeEscapedCodePoint(match, hex, 16))
    .replace(/\\u([0-9a-fA-F]{1,4})/g, (match, hex: string) => decodeEscapedCodePoint(match, hex, 16))
    .replace(/\\U([0-9a-fA-F]{1,8})/g, (match, hex: string) => decodeEscapedCodePoint(match, hex, 16))
    .replace(/\\([0-7]{1,3})/g, (match, octal: string) => decodeEscapedCodePoint(match, octal, 8))
    .replace(/\\([abefnrtv\\'"])/g, (_match, escaped: string) => {
      const mapped: Record<string, string> = {
        a: '\x07',
        b: '\b',
        e: '\x1b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
        v: '\v',
        '\\': '\\',
        "'": "'",
        '"': '"',
      };
      return mapped[escaped] ?? escaped;
    });
}

function expandAnsiCQuotes(token: string): string {
  return token.replace(/\$'((?:\\.|[^'])*)'/g, (_match, body: string) => decodeAnsiCQuoteBody(body));
}

function cleanShellToken(token: string): string {
  return expandAnsiCQuotes(token)
    .trim()
    .replace(/\$(['"])/g, '$1')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/['"`]/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/^\d*(?:<|>)+/, '')
    .replace(/[),\]}]+$/g, '');
}

function cleanRedirectionToken(token: string): string {
  return token
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/[),\]}]+$/g, '');
}

function cleanCommandPayloadToken(token: string): string {
  return expandAnsiCQuotes(token)
    .trim()
    .replace(/[),\]}]+$/g, '')
    .replace(/\$(['"])/g, '$1')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\\(.)/g, '$1');
}

function readerOptionReadsProtectedEnv(command: string, token: string): boolean {
  if (!['awk', 'grep', 'rg', 'sed'].includes(command)) return false;
  const clean = cleanShellToken(token);
  const longFile = clean.match(/^--file=(.+)$/);
  if (longFile) return optionValueHasProtectedEnvSegment(longFile[1]);
  const shortFile = clean.match(/^-f(.+)$/);
  if (shortFile) return optionValueHasProtectedEnvSegment(shortFile[1]);
  if (command === 'grep') {
    const include = clean.match(/^--include=(.+)$/);
    return include ? optionValueHasProtectedEnvSegment(include[1]) : false;
  }
  if (command === 'rg') {
    const glob = clean.match(/^--i?glob=(.+)$/);
    if (glob) return rgGlobReadsProtectedEnv(glob[1]);
    const shortGlob = clean.match(/^-g(.+)$/);
    return shortGlob ? rgGlobReadsProtectedEnv(shortGlob[1]) : false;
  }
  return false;
}

function optionValueHasProtectedEnvSegment(value: string): boolean {
  return hasProtectedEnvSegment(cleanShellToken(value));
}

function rgGlobReadsProtectedEnv(value: string): boolean {
  const clean = cleanShellToken(value);
  return !clean.startsWith('!') && hasProtectedEnvSegment(clean);
}

function hasProtectedEnvSegment(path: string): boolean {
  return path.split(/[\\/]+/).some((part) => part.startsWith('.env') && part !== '.env.example');
}

function shellTokenExcludesProtectedEnvPath(token: string): boolean {
  const clean = cleanShellToken(token);
  return /^(?:--exclude|--exclude-dir)=/.test(clean) && clean.split('=').slice(1).every(optionValueHasProtectedEnvSegment);
}

function mentionsProtectedEnvPath(cmd: string): boolean {
  return shellishTokens(cmd).some((token) => {
    if (shellTokenExcludesProtectedEnvPath(token)) return false;
    return cleanShellToken(token)
      .split(/[=$(){}\[\],;<>|&]+/)
      .some((part) => hasProtectedEnvSegment(cleanShellToken(part)));
  });
}

function shellishArgsAfter(cmd: string, start: number): string[] {
  const args: string[] = [];
  let token = '';
  let quote = '';
  let escaping = false;

  for (let i = start; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (escaping) {
      token += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaping = true;
      token += ch;
      continue;
    }
    if (quote) {
      token += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      token += ch;
      continue;
    }
    if (ch === '`' || ch === ';' || ch === '&' || ch === '|') break;
    if (/\s/.test(ch)) {
      if (token) {
        args.push(token);
        token = '';
      }
      continue;
    }
    token += ch;
  }
  if (token) args.push(token);
  return args;
}

function shellishTokens(cmd: string): string[] {
  const args: string[] = [];
  let token = '';
  let quote = '';
  let escaping = false;

  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (escaping) {
      token += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaping = true;
      token += ch;
      continue;
    }
    if (quote) {
      token += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      token += ch;
      continue;
    }
    if (/[\s;|&]/.test(ch)) {
      if (token) {
        args.push(token);
        token = '';
      }
      continue;
    }
    token += ch;
  }
  if (token) args.push(token);
  return args;
}

function inlineRedirectionTarget(token: string): string | undefined {
  const clean = cleanRedirectionToken(token);
  const match = clean.match(/^(?:\d*|&)(?:<>|>>|>|<)(?![<(])(.+)$/);
  return match?.[1];
}

function standaloneRedirection(token: string): boolean {
  return /^(?:\d*|&)(?:<>|>>|>|<)$/.test(cleanRedirectionToken(token));
}

function commandSubstitutionTouchesProtectedEnv(cmd: string): boolean {
  for (const match of cmd.matchAll(/\$\(\s*(?:\d*|&)(?:<>|>>|>|<)\s*([^\s)]+)/g)) {
    if (optionValueHasProtectedEnvSegment(match[1])) return true;
  }
  return false;
}

function redirectionTouchesProtectedEnv(cmd: string): boolean {
  if (commandSubstitutionTouchesProtectedEnv(cmd)) return true;
  const tokens = shellishTokens(cmd);
  for (let i = 0; i < tokens.length; i += 1) {
    const inlineTarget = inlineRedirectionTarget(tokens[i]);
    if (inlineTarget && optionValueHasProtectedEnvSegment(inlineTarget)) return true;
    if (standaloneRedirection(tokens[i]) && protectedEnvToken(tokens[i + 1] ?? '')) return true;
  }
  return false;
}

function writerArgsTouchProtectedEnv(args: string[]): boolean {
  let optionsDone = false;
  for (const arg of args) {
    const clean = cleanShellToken(arg);
    if (!optionsDone) {
      if (clean === '--') {
        optionsDone = true;
        continue;
      }
      if (clean.startsWith('-')) continue;
    }
    if (protectedEnvToken(arg)) return true;
  }
  return false;
}

function shellOptionConsumesNext(clean: string): boolean {
  return SHELL_OPTIONS_WITH_VALUE.has(clean) || /^[-+]o$/i.test(clean);
}

function envOptionConsumesNext(clean: string): boolean {
  return ENV_OPTIONS_WITH_VALUE.has(clean);
}

function inlineEnvSplitStringPayload(clean: string): string | undefined {
  return clean.match(/^-S(.+)$/)?.[1] ?? clean.match(/^--split-string=(.+)$/)?.[1];
}

function envWrappedCommandDenied(cmd: string, depth: number): boolean {
  if (depth >= 4) return false;
  for (const match of cmd.matchAll(ENV_CMD)) {
    const args = shellishArgsAfter(cmd, match.index + match[0].length);
    let commandIndex = -1;
    for (let i = 0; i < args.length; i += 1) {
      const clean = cleanShellToken(args[i]);
      if (clean === '--') {
        commandIndex = i + 1;
        break;
      }
      const inlineSplitPayload = inlineEnvSplitStringPayload(clean);
      if (inlineSplitPayload !== undefined) {
        if (!checkBash(cleanCommandPayloadToken(inlineSplitPayload), depth + 1).ok) return true;
        continue;
      }
      if (clean === '-S' || clean === '--split-string') {
        const payload = args[i + 1];
        if (payload && !checkBash(cleanCommandPayloadToken(payload), depth + 1).ok) return true;
        i += 1;
        continue;
      }
      if (envOptionConsumesNext(clean)) {
        i += 1;
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(clean)) continue;
      if (clean.startsWith('-')) continue;
      commandIndex = i;
      break;
    }
    if (commandIndex >= 0) {
      const payload = args.slice(commandIndex).join(' ');
      if (payload && !checkBash(payload, depth + 1).ok) return true;
    }
  }
  return false;
}

function nestedShellCommandDenied(cmd: string, depth: number): boolean {
  if (depth >= 4) return false;
  for (const match of cmd.matchAll(NESTED_SHELL_CMD)) {
    const args = shellishArgsAfter(cmd, match.index + match[0].length);
    for (let i = 0; i < args.length; i += 1) {
      const clean = cleanShellToken(args[i]);
      if (clean === '--') break;
      if (shellOptionConsumesNext(clean)) {
        i += 1;
        continue;
      }
      if (clean.startsWith('--')) continue;
      if (!clean.startsWith('-')) break;
      const inlineCommand = clean.match(/^-[^-]*?c(.+)$/);
      if (inlineCommand || /^-[^-]*?c$/.test(clean)) {
        const payload = inlineCommand?.[1] || args[i + 1];
        if (payload && !checkBash(cleanCommandPayloadToken(payload), depth + 1).ok) return true;
        break;
      }
    }
  }
  return false;
}

function readsProtectedEnvFile(cmd: string): boolean {
  for (const match of cmd.matchAll(ENV_READ_CMD)) {
    const args = shellishArgsAfter(cmd, match.index + match[0].length);
    const command = match[1].toLowerCase();
    if (args.some((arg) => protectedEnvToken(arg) || readerOptionReadsProtectedEnv(command, arg))) return true;
  }
  for (const match of cmd.matchAll(ENV_SOURCE_CMD)) {
    const args = shellishArgsAfter(cmd, match.index + match[0].length);
    if (protectedEnvToken(args[0] ?? '')) return true;
  }
  for (const match of cmd.matchAll(ENV_WRITE_CMD)) {
    const args = shellishArgsAfter(cmd, match.index + match[0].length);
    if (writerArgsTouchProtectedEnv(args)) return true;
  }
  if (redirectionTouchesProtectedEnv(cmd)) return true;
  return false;
}

export function checkBash(cmd: string, depth = 0): GateResult {
  if (hasRmRecursiveForce(cmd) || hasGitForcePush(cmd) || DESTRUCTIVE_CMD.test(cmd)) {
    return { ok: false, reason: `คำสั่งทำลายล้าง/irreversible ถูกปฏิเสธ: "${cmd}"` };
  }
  if (PROTECTED_CMD_PATH.test(cmd) || mentionsProtectedEnvPath(cmd) || readsProtectedEnvFile(cmd)) {
    return { ok: false, reason: `คำสั่งที่อ่าน/แตะ path ลับถูกปฏิเสธ: "${cmd}"` };
  }
  if (nestedShellCommandDenied(cmd, depth)) {
    return { ok: false, reason: `คำสั่ง nested shell ที่อันตรายถูกปฏิเสธ: "${cmd}"` };
  }
  if (envWrappedCommandDenied(cmd, depth)) {
    return { ok: false, reason: `คำสั่ง env wrapper ที่อันตรายถูกปฏิเสธ: "${cmd}"` };
  }
  return { ok: true };
}

async function canonicalExisting(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function existingAncestor(path: string): Promise<string> {
  let dir = resolve(path);
  for (;;) {
    try {
      await stat(dir);
      return canonicalExisting(dir);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return dir;
      dir = parent;
    }
  }
}

async function allowedRoots(): Promise<string[]> {
  if (envFlag(BRAND_ENV.allowOutsideWorkspace)) return ['/'];
  // agentCwd() = worktree ของ sub-agent ที่ถูก isolate (ถ้ามี) ไม่งั้น = process.cwd().
  // ผล: sub-agent ใน worktree เขียนได้เฉพาะใน worktree ตัวเอง (isolation) ส่วน main agent เขียนใน workspace ปกติ
  const roots = [await canonicalExisting(agentCwd())];
  const brain = await getBrainPath();
  if (brain) roots.push(await canonicalExisting(brain));
  return roots;
}

function inside(abs: string, root: string): boolean {
  return abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep);
}

function protectedSegment(abs: string): boolean {
  const parts = abs.split(/[\\/]+/);
  if (parts.some((p) => PROTECTED_SEGMENTS.has(p))) return true;
  return hasProtectedEnvSegment(abs);
}

async function checkPathScope(path: string, intent: 'read' | 'write'): Promise<GateResult> {
  const abs = intent === 'write' ? await existingAncestor(path) : await canonicalExisting(path);
  const roots = await allowedRoots();
  if (!roots.some((root) => inside(abs, root))) {
    return {
      ok: false,
      reason: `path อยู่นอก workspace/brain ที่อนุญาต: "${path}" (ตั้ง ${BRAND_ENV.allowOutsideWorkspace}=1 เพื่อ opt-in)`,
    };
  }
  return { ok: true };
}

/** กันอ่าน secrets/.git/node_modules และกันอ่านนอก workspace/brain */
export async function checkReadPath(path: string): Promise<GateResult> {
  const abs = await canonicalExisting(path);
  if (protectedSegment(abs)) {
    return { ok: false, reason: `path ที่ป้องกันถูกปฏิเสธ: "${path}" (secrets / .git / .env / node_modules)` };
  }
  return checkPathScope(path, 'read');
}

/** กันเขียนทับ secrets/shell-rc/.sanook + กันเขียนนอก workspace/brain */
export async function checkWritePath(path: string): Promise<GateResult> {
  const abs = resolve(path);
  const canonical = await existingAncestor(path);
  const inProtectedDir = (p: string): boolean => PROTECTED_DIRS.some((d) => p === d || p.startsWith(d + sep));
  if (
    PROTECTED_EXACT.has(abs) ||
    PROTECTED_EXACT.has(canonical) ||
    inProtectedDir(abs) ||
    inProtectedDir(canonical) ||
    protectedSegment(abs) ||
    protectedSegment(canonical)
  ) {
    return {
      ok: false,
      reason: `path ที่ป้องกันถูกปฏิเสธ: "${path}" (secrets / shell-rc / .sanook / .git / .env / node_modules)`,
    };
  }
  return checkPathScope(path, 'write');
}
