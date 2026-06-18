import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

export interface CompletionItem {
  text: string;
  display: string;
  meta: string;
}

export type SlashCompletionItem = CompletionItem;

export interface CompletionResult {
  items: CompletionItem[];
  replaceFrom: number;
}

const PATH_TOKEN_RE = /((?:\.{1,2}\/|~\/?|\/|@|[^"'`\s]+\/)[^"'`\s]*)$/;
const MAX_PATH_COMPLETIONS = 40;
const DETAIL_SECTIONS: CompletionItem[] = [
  { text: 'thinking ', display: 'thinking', meta: 'details section' },
  { text: 'tools ', display: 'tools', meta: 'details section' },
];
const DETAIL_MODES: CompletionItem[] = [
  { text: 'hidden', display: 'hidden', meta: 'details mode' },
  { text: 'collapsed', display: 'collapsed', meta: 'details mode' },
  { text: 'expanded', display: 'expanded', meta: 'details mode' },
];
const TRAIL_MODES: CompletionItem[] = [
  { text: 'compact', display: 'compact', meta: 'trail mode' },
  { text: 'expanded', display: 'expanded', meta: 'trail mode' },
];
const COPY_TARGETS: CompletionItem[] = [{ text: 'last', display: 'last', meta: 'copy target' }];

const BUILTIN_SLASH_COMPLETIONS: CompletionItem[] = [
  { text: '/help', display: '/help', meta: 'command list + pager' },
  { text: '/hotkeys', display: '/hotkeys', meta: 'keyboard shortcuts' },
  { text: '/details', display: '/details', meta: 'thinking/tool trail visibility' },
  { text: '/model', display: '/model', meta: 'pick or switch model' },
  { text: '/mcp', display: '/mcp', meta: 'browse MCP servers' },
  { text: '/skills', display: '/skills', meta: 'browse loaded skills' },
  { text: '/sessions', display: '/sessions', meta: 'resume saved sessions' },
  { text: '/status', display: '/status', meta: 'session/model status' },
  { text: '/platforms', display: '/platforms', meta: 'providers + gateways' },
  { text: '/trail', display: '/trail', meta: 'toggle tool trail detail' },
  { text: '/tools', display: '/tools', meta: 'agent tools' },
  { text: '/diff', display: '/diff', meta: 'git diff stat' },
  { text: '/copy', display: '/copy', meta: 'copy latest assistant response' },
  { text: '/retry', display: '/retry', meta: 'rerun last prompt' },
  { text: '/stop', display: '/stop', meta: 'stop current turn' },
  { text: '/undo', display: '/undo', meta: 'stash recent file edits' },
  { text: '/rewind', display: '/rewind', meta: 'restore previous turn' },
  { text: '/cost', display: '/cost', meta: 'last usage/cost' },
  { text: '/usage', display: '/usage', meta: 'last usage/cost' },
  { text: '/insights', display: '/insights', meta: 'local usage insights' },
  { text: '/personality', display: '/personality', meta: 'set response style' },
  { text: '/compact', display: '/compact', meta: 'compress context' },
  { text: '/compress', display: '/compress', meta: 'compress context' },
  { text: '/new', display: '/new', meta: 'new conversation' },
  { text: '/reset', display: '/reset', meta: 'new conversation' },
  { text: '/clear', display: '/clear', meta: 'clear conversation' },
  { text: '/quit', display: '/quit', meta: 'exit REPL' },
];

export function slashCompletionItems(input: string): CompletionItem[] {
  if (!/^\/[a-z0-9-?]*$/i.test(input)) return [];
  const query = input.slice(1).toLowerCase();
  return BUILTIN_SLASH_COMPLETIONS.filter((item) => item.text.slice(1).startsWith(query));
}

export function completionForInput(input: string, cwd = process.cwd()): CompletionResult {
  const slash = slashCompletionItems(input);
  if (slash.length) return { items: slash, replaceFrom: 0 };

  const slashArgs = slashArgumentCompletion(input);
  if (slashArgs.items.length) return slashArgs;

  const path = pathCompletion(input, cwd);
  if (path.items.length) return path;

  return { items: [], replaceFrom: 0 };
}

function slashArgumentCompletion(input: string): CompletionResult {
  const commandMatch = /^\/([a-z0-9-?]+)\s+/i.exec(input);
  if (!commandMatch) return { items: [], replaceFrom: 0 };

  const command = commandMatch[1].toLowerCase();
  const rawArgs = input.slice(commandMatch[0].length);
  const hasTrailingSpace = /\s$/.test(input);
  const args = rawArgs.trim() ? rawArgs.trim().split(/\s+/) : [];
  const activeIndex = hasTrailingSpace ? args.length : Math.max(0, args.length - 1);
  const prefix = hasTrailingSpace ? '' : (args.at(-1) ?? '');
  const replaceFrom = input.length - prefix.length;

  if (command === 'trail' && activeIndex === 0) {
    return { items: filterArgumentItems(TRAIL_MODES, prefix), replaceFrom };
  }

  if (command === 'copy' && activeIndex === 0) {
    return { items: filterArgumentItems(COPY_TARGETS, prefix), replaceFrom };
  }

  if (command === 'details') {
    if (activeIndex === 0) return { items: filterArgumentItems(DETAIL_SECTIONS, prefix), replaceFrom };
    const section = args[0]?.toLowerCase();
    if (activeIndex === 1 && (section === 'thinking' || section === 'tools')) {
      return { items: filterArgumentItems(DETAIL_MODES, prefix), replaceFrom };
    }
  }

  return { items: [], replaceFrom: 0 };
}

function filterArgumentItems(items: CompletionItem[], prefix: string): CompletionItem[] {
  const query = prefix.toLowerCase();
  return items.filter((item) => item.text.toLowerCase().startsWith(query));
}

function pathCompletion(input: string, cwd: string): CompletionResult {
  const match = PATH_TOKEN_RE.exec(input);
  if (!match) return { items: [], replaceFrom: 0 };

  const token = match[1];
  const replaceFrom = input.length - token.length;
  const mention = token.startsWith('@');
  const rawToken = mention ? token.slice(1) : token;
  const raw = rawToken === '~' ? '~/' : rawToken;
  const hasTrailingSlash = raw.endsWith('/');
  const rawDir = hasTrailingSlash ? raw : dirname(raw);
  const prefix = hasTrailingSlash ? '' : basename(raw);
  const dirPart = rawDir === '.' ? '' : rawDir;
  const absoluteDir = resolveInputPath(dirPart || '.', cwd);

  if (!existsSync(absoluteDir)) return { items: [], replaceFrom };

  let entries;
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return { items: [], replaceFrom };
  }

  const head = `${mention ? '@' : ''}${dirPart ? `${dirPart.replace(/\/?$/, '/')}` : ''}`;
  const items = entries
    .filter((entry) => !entry.name.startsWith('.') && entry.name.startsWith(prefix))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, MAX_PATH_COMPLETIONS)
    .map((entry) => {
      const suffix = entry.isDirectory() ? '/' : '';
      const text = `${head}${entry.name}${suffix}`;
      return { display: text, meta: entry.isDirectory() ? 'dir' : 'file', text };
    });

  return { items, replaceFrom };
}

function resolveInputPath(input: string, cwd: string): string {
  if (input === '~') return homedir();
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2));
  if (isAbsolute(input)) return input;
  return resolve(cwd, input);
}

export function clampCompletionIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

export function completionReplaceValue(input: string, item: CompletionItem | undefined, replaceFrom = 0): string | null {
  if (!item) return null;
  const next = `${input.slice(0, replaceFrom)}${item.text}`;
  return next === input ? null : next;
}
