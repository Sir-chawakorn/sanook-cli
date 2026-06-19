import { inlineValue, takeValue } from '../cli-option-values.js';
import type { SearchMode } from './engine.js';
import { SEARCH_SOURCES, type SearchSource } from './index-core.js';

const SEARCH_MODES = ['auto', 'fts', 'semantic', 'hybrid'] as const satisfies readonly SearchMode[];

export interface ParsedSearchArgs {
  query: string;
  mode: SearchMode;
  limit: number;
  sources?: SearchSource[];
}

export type SearchArgsResult = { ok: true; value: ParsedSearchArgs } | { ok: false; message: string };

function isSearchMode(v: string): v is SearchMode {
  return (SEARCH_MODES as readonly string[]).includes(v);
}

function isSearchSource(v: string): v is SearchSource {
  return (SEARCH_SOURCES as readonly string[]).includes(v);
}

function parsePositiveInteger(raw: string | undefined): number | undefined {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

function inlineSourceValue(value: string): string | undefined {
  return inlineValue('--source', value) ?? inlineValue('--sources', value);
}

export function parseSearchArgs(args: string[]): SearchArgsResult {
  const queryParts: string[] = [];
  let mode: SearchMode = 'auto';
  let modeSet = false;
  let limit = 8;
  let limitSet = false;
  let sources: SearchSource[] | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      queryParts.push(...args.slice(i + 1));
      break;
    } else if (a === '--mode' || a.startsWith('--mode=')) {
      const next = a === '--mode' ? takeValue(args, i) : undefined;
      const v = next ? next.value : inlineValue('--mode', a);
      if (next) i = next.nextIndex;
      if (!v) return { ok: false, message: `--mode ต้องระบุค่าเป็น ${SEARCH_MODES.join('|')}` };
      if (!isSearchMode(v)) return { ok: false, message: `--mode ต้องเป็น ${SEARCH_MODES.join('|')}` };
      if (modeSet) return { ok: false, message: 'ใช้ --mode เพียงครั้งเดียว' };
      mode = v;
      modeSet = true;
    } else if (a === '--limit' || a.startsWith('--limit=')) {
      const next = a === '--limit' ? takeValue(args, i) : undefined;
      const raw = next ? next.value : inlineValue('--limit', a);
      if (next) i = next.nextIndex;
      if (!raw) return { ok: false, message: '--limit ต้องระบุค่าเป็น integer บวก เช่น 8' };
      const n = parsePositiveInteger(raw);
      if (n === undefined) return { ok: false, message: '--limit ต้องเป็น integer บวก เช่น 8' };
      if (limitSet) return { ok: false, message: 'ใช้ --limit เพียงครั้งเดียว' };
      limit = n;
      limitSet = true;
    } else if (a === '--source' || a === '--sources' || a.startsWith('--source=') || a.startsWith('--sources=')) {
      const next = a === '--source' || a === '--sources' ? takeValue(args, i) : undefined;
      const raw = next ? next.value : inlineSourceValue(a);
      if (next) i = next.nextIndex;
      const requested = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const bad = requested.filter((s) => !isSearchSource(s));
      if (!requested.length) {
        return { ok: false, message: `--source ต้องระบุค่าเป็น ${SEARCH_SOURCES.join(',')} (คั่นหลายค่าได้ด้วย comma)` };
      }
      if (bad.length) return { ok: false, message: `--source ต้องเป็น ${SEARCH_SOURCES.join(',')} (คั่นหลายค่าได้ด้วย comma)` };
      sources = [...new Set(requested)] as SearchSource[];
    } else {
      queryParts.push(a);
    }
  }

  const query = queryParts.join(' ').trim();
  if (!query) return { ok: false, message: 'ต้องใส่ query สำหรับค้นหา' };
  return { ok: true, value: { query, mode, limit, sources } };
}
