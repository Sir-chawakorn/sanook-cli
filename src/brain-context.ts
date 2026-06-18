import { stat } from 'node:fs/promises';
import { inlineValue, takeValue } from './cli-option-values.js';
import {
  buildBrainContextParts,
  renderBrainContext,
  type BrainContextPart,
} from './memory.js';
import { checkSearchIndexFreshness } from './brain-doctor.js';
import { search, type SearchHit, type SearchMode, type SearchOptions, type SearchResult } from './search/engine.js';
import { SEARCH_SOURCES, type SearchSource } from './search/index-core.js';
import { INDEX_PATH } from './search/store.js';

const SEARCH_MODES = ['auto', 'fts', 'semantic', 'hybrid'] as const satisfies readonly SearchMode[];
const DEFAULT_CONTEXT_WARNING_CHARS = 6500;
const DEFAULT_TASK_SOURCES = ['vault', 'session', 'skill'] as const satisfies readonly SearchSource[];

export interface ParsedBrainContextArgs {
  task?: string;
  mode: SearchMode;
  limit: number;
  sources?: SearchSource[];
  showContent: boolean;
}

export type BrainContextArgsResult =
  | { ok: true; value: ParsedBrainContextArgs }
  | { ok: false; message: string };

export type BrainContextSearch = (query: string, opts: SearchOptions) => Promise<SearchResult>;

export interface BrainContextSourceReport {
  id: BrainContextPart['id'];
  label: string;
  relPath: string;
  path: string;
  status: BrainContextPart['status'];
  chars: number;
  maxChars: number;
}

export interface BrainContextTaskReport {
  query: string;
  mode: SearchMode;
  degraded?: string;
  total: number;
  hits: SearchHit[];
  sources: SearchSource[];
}

export interface BrainContextReport {
  ok: boolean;
  brainPath?: string;
  context: string;
  contextChars: number;
  sources: BrainContextSourceReport[];
  warnings: string[];
  task?: BrainContextTaskReport;
}

export interface InspectBrainContextOptions {
  brainPath?: string;
  task?: string;
  mode?: SearchMode;
  limit?: number;
  sources?: SearchSource[];
  indexPath?: string;
  indexFreshnessToleranceMs?: number;
  maxContextChars?: number;
  searchImpl?: BrainContextSearch;
}

function isSearchMode(value: string): value is SearchMode {
  return (SEARCH_MODES as readonly string[]).includes(value);
}

function isSearchSource(value: string): value is SearchSource {
  return (SEARCH_SOURCES as readonly string[]).includes(value);
}

function parsePositiveInteger(raw: string | undefined): number | undefined {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

function inlineSourceValue(value: string): string | undefined {
  return inlineValue('--source', value) ?? inlineValue('--sources', value);
}

export function parseBrainContextArgs(args: string[]): BrainContextArgsResult {
  const taskParts: string[] = [];
  let task: string | undefined;
  let mode: SearchMode = 'auto';
  let limit = 5;
  let sources: SearchSource[] | undefined;
  let showContent = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      taskParts.push(...args.slice(i + 1));
      break;
    } else if (a === '--task' || a.startsWith('--task=')) {
      const next = a === '--task' ? takeValue(args, i) : undefined;
      const raw = next ? next.value : inlineValue('--task', a);
      if (next) i = next.nextIndex;
      if (!raw) return { ok: false, message: '--task ต้องระบุข้อความ task' };
      task = raw.trim();
      if (!task) return { ok: false, message: '--task ต้องระบุข้อความ task' };
    } else if (a === '--mode' || a.startsWith('--mode=')) {
      const next = a === '--mode' ? takeValue(args, i) : undefined;
      const raw = next ? next.value : inlineValue('--mode', a);
      if (next) i = next.nextIndex;
      if (!raw) return { ok: false, message: `--mode ต้องระบุค่าเป็น ${SEARCH_MODES.join('|')}` };
      if (!isSearchMode(raw)) return { ok: false, message: `--mode ต้องเป็น ${SEARCH_MODES.join('|')}` };
      mode = raw;
    } else if (a === '--limit' || a.startsWith('--limit=')) {
      const next = a === '--limit' ? takeValue(args, i) : undefined;
      const raw = next ? next.value : inlineValue('--limit', a);
      if (next) i = next.nextIndex;
      const n = parsePositiveInteger(raw);
      if (n === undefined) return { ok: false, message: '--limit ต้องเป็น integer บวก เช่น 5' };
      limit = n;
    } else if (a === '--source' || a === '--sources' || a.startsWith('--source=') || a.startsWith('--sources=')) {
      const next = a === '--source' || a === '--sources' ? takeValue(args, i) : undefined;
      const raw = next ? next.value : inlineSourceValue(a);
      if (next) i = next.nextIndex;
      const requested = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!requested.length) return { ok: false, message: `--source ต้องระบุค่าเป็น ${SEARCH_SOURCES.join(',')}` };
      const bad = requested.filter((s) => !isSearchSource(s));
      if (bad.length) return { ok: false, message: `--source ต้องเป็น ${SEARCH_SOURCES.join(',')}` };
      sources = [...new Set(requested)] as SearchSource[];
    } else if (a === '--no-content' || a === '--summary') {
      showContent = false;
    } else if (a === '--content') {
      showContent = true;
    } else {
      taskParts.push(a);
    }
  }

  const positionalTask = taskParts.join(' ').trim();
  const finalTask = (task ?? positionalTask).trim();
  return { ok: true, value: { task: finalTask || undefined, mode, limit, sources, showContent } };
}

export async function inspectBrainContext(options: InspectBrainContextOptions = {}): Promise<BrainContextReport> {
  const brainPath = options.brainPath;
  const warnings: string[] = [];
  if (!brainPath) {
    return {
      ok: false,
      context: '',
      contextChars: 0,
      sources: [],
      warnings: ['No second-brain path is configured. Run `sanook brain init [path]` first.'],
    };
  }

  try {
    if (!(await stat(brainPath)).isDirectory()) {
      return {
        ok: false,
        brainPath,
        context: '',
        contextChars: 0,
        sources: [],
        warnings: ['Configured second-brain path is not a directory.'],
      };
    }
  } catch {
    return {
      ok: false,
      brainPath,
      context: '',
      contextChars: 0,
      sources: [],
      warnings: ['Configured second-brain path does not exist.'],
    };
  }

  const parts = await buildBrainContextParts(brainPath);
  const context = renderBrainContext(brainPath, parts);
  const sourceReports = parts.map((part) => ({
    id: part.id,
    label: part.label,
    relPath: part.relPath,
    path: part.path,
    status: part.status,
    chars: part.chars,
    maxChars: part.maxChars,
  }));

  for (const part of sourceReports) {
    if (part.status === 'missing') warnings.push(`Missing context source: ${part.relPath}`);
  }
  if (!context) warnings.push('Brain context is empty; expected at least one hot context source to contain content.');
  const maxContextChars = options.maxContextChars ?? DEFAULT_CONTEXT_WARNING_CHARS;
  if (context.length > maxContextChars) {
    warnings.push(`Brain context is ${context.length} chars, above the ${maxContextChars} char warning threshold.`);
  }

  const indexCheck = await checkSearchIndexFreshness(
    brainPath,
    options.indexPath ?? INDEX_PATH,
    options.indexFreshnessToleranceMs,
  );
  if (indexCheck.status !== 'pass') warnings.push(indexCheck.message);

  const taskQuery = options.task?.trim();
  let taskReport: BrainContextTaskReport | undefined;
  if (taskQuery) {
    const taskSources = options.sources?.length ? options.sources : [...DEFAULT_TASK_SOURCES];
    const res = await (options.searchImpl ?? search)(taskQuery, {
      mode: options.mode ?? 'auto',
      limit: options.limit ?? 5,
      sources: taskSources,
    });
    taskReport = {
      query: taskQuery,
      mode: res.mode,
      degraded: res.degraded,
      total: res.total,
      hits: res.hits,
      sources: taskSources,
    };
  }

  return {
    ok: true,
    brainPath,
    context,
    contextChars: context.length,
    sources: sourceReports,
    warnings,
    task: taskReport,
  };
}

function statusLabel(status: BrainContextPart['status']): string {
  return status.toUpperCase().padEnd(7);
}

export function formatBrainContextReport(report: BrainContextReport, showContent = true): string {
  const lines: string[] = ['Sanook brain context'];
  lines.push(`vault: ${report.brainPath ?? '(not configured)'}`);
  lines.push(`context: ${report.contextChars} chars`);
  if (report.sources.length) {
    lines.push('sources:');
    for (const source of report.sources) {
      lines.push(`  [${statusLabel(source.status)}] ${source.relPath} (${source.chars} chars, cap ${source.maxChars})`);
    }
  }
  if (report.warnings.length) {
    lines.push('warnings:');
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }
  if (showContent) {
    lines.push('--- context ---');
    lines.push(report.context || '(empty)');
  }
  if (report.task) {
    lines.push(`--- task retrieval: "${report.task.query}" ---`);
    lines.push(
      `mode=${report.task.mode}${report.task.degraded ? ` degraded=${report.task.degraded}` : ''} ` +
        `sources=${report.task.sources.join(',')} hits=${report.task.hits.length}/${report.task.total}`,
    );
    if (!report.task.hits.length) {
      lines.push('(no task hits; run `sanook index` if the vault changed recently)');
    } else {
      for (const hit of report.task.hits) {
        const title = hit.title.trim();
        const body = title ? `${title} — ${hit.snippet}` : hit.snippet;
        const where = hit.path ? ` (${hit.path})` : '';
        lines.push(`[${hit.source}] ${body}${where}`);
      }
    }
  }
  return lines.join('\n');
}
