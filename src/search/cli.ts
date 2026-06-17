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

function inlineValue(flag: string, value: string): string | undefined {
  const prefix = `${flag}=`;
  if (!value.startsWith(prefix)) return undefined;
  const parsed = value.slice(prefix.length);
  return parsed === '' ? undefined : parsed;
}

function inlineSourceValue(value: string): string | undefined {
  return inlineValue('--source', value) ?? inlineValue('--sources', value);
}

export function parseSearchArgs(args: string[]): SearchArgsResult {
  const queryParts: string[] = [];
  let mode: SearchMode = 'auto';
  let limit = 8;
  let sources: SearchSource[] | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      queryParts.push(...args.slice(i + 1));
      break;
    } else if (a === '--mode' || a.startsWith('--mode=')) {
      const v = a === '--mode' ? args[++i] : inlineValue('--mode', a);
      if (!v || !isSearchMode(v)) return { ok: false, message: `--mode ต้องเป็น ${SEARCH_MODES.join('|')}` };
      mode = v;
    } else if (a === '--limit' || a.startsWith('--limit=')) {
      const raw = a === '--limit' ? args[++i] : inlineValue('--limit', a);
      const n = parsePositiveInteger(raw);
      if (n === undefined) return { ok: false, message: '--limit ต้องเป็น integer บวก เช่น 8' };
      limit = n;
    } else if (a === '--source' || a === '--sources' || a.startsWith('--source=') || a.startsWith('--sources=')) {
      const raw = a === '--source' || a === '--sources' ? args[++i] : inlineSourceValue(a);
      const requested = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const bad = requested.filter((s) => !isSearchSource(s));
      if (!requested.length || bad.length) {
        return { ok: false, message: `--source ต้องเป็น ${SEARCH_SOURCES.join(',')} (คั่นหลายค่าได้ด้วย comma)` };
      }
      sources = [...new Set(requested)] as SearchSource[];
    } else {
      queryParts.push(a);
    }
  }

  const query = queryParts.join(' ').trim();
  if (!query) return { ok: false, message: 'ต้องใส่ query สำหรับค้นหา' };
  return { ok: true, value: { query, mode, limit, sources } };
}
