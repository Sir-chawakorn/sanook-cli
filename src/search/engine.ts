// ============================================================================
// src/search/engine.ts — the search orchestrator (the one module callers use).
//
// Implements the degradation ladder as a single search() call:
//   mode='fts'      → pure BM25 (the always-on floor)
//   mode='semantic' → cosine over BYOK vectors (full recall)
//   mode='hybrid'   → BM25 ⊕ cosine ⊕ memory-importance prior, fused by RRF
//   mode='auto'     → hybrid when vectors are usable, else fts (the smart default)
//
// rankSearch() is the PURE core (index + optional vectors + optional query vector
// in, ranked hits out) so the whole ranking pipeline unit-tests with zero disk
// and zero network. search() is the thin disk/embedding wrapper: it caches the
// index by mtime, caches query embeddings in an LRU, resolves a BYOK embedder
// lazily, and on ANY embedding error degrades to BM25 with a `degraded` flag —
// search must never throw at the floor.
// ============================================================================
import { bm25Search, termList, type InvertedIndex, type SearchSource } from './index-core.js';
import { rrfFuse } from './fuse.js';
import {
  cosineTopK,
  embedQuery,
  getEmbedder,
  loadVectors,
  vectorsMtimeMs,
  type VectorIndex,
} from './embed-store.js';
import { embeddingModelSpec } from './embedding-config.js';
import { indexMtimeMs, loadIndex } from './store.js';

export type SearchMode = 'auto' | 'fts' | 'semantic' | 'hybrid';

export interface SearchOptions {
  mode?: SearchMode;
  limit?: number;
  sources?: SearchSource[];
  snippets?: boolean;
  /** embeddings spec ('provider' | 'provider:model'); default = config/env/auto. */
  embeddingModel?: string;
}

export interface SearchHit {
  id: string;
  source: SearchSource;
  title: string;
  path?: string;
  noteType?: string;
  tags: string[];
  score: number;
  snippet: string;
  importance?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  mode: SearchMode; // the mode actually executed
  degraded?: string; // set when the requested mode could not run (e.g. no embedder)
  total: number; // distinct candidates considered
}

const CAND = 60; // candidate pool depth per leg before fusion/limit
const SNIPPET_WIDTH = 64;

/** ±width snippet around the first matched query term; falls back to the head for semantic-only hits. */
function makeSnippet(text: string, qTerms: string[], width = SNIPPET_WIDTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let pos = -1;
  for (const t of qTerms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  if (pos < 0) return flat.length > width * 2 ? `${flat.slice(0, width * 2).trim()}…` : flat;
  const start = Math.max(0, pos - width);
  const end = Math.min(flat.length, pos + width);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

/** ids of docs whose source is allowed (or all if no filter). */
function sourceFilteredIds(index: InvertedIndex, sources?: ReadonlySet<SearchSource>): Set<string> | undefined {
  if (!sources) return undefined;
  const out = new Set<string>();
  for (const m of index.docs.values()) if (sources.has(m.source)) out.add(m.id);
  return out;
}

/**
 * PURE ranking core. Given the index, optional vectors, and an optional query
 * vector, produce ranked hits per the requested mode. No disk, no network.
 */
export function rankSearch(
  index: InvertedIndex,
  query: string,
  opts: SearchOptions = {},
  vectors?: VectorIndex,
  queryVec?: number[],
): SearchResult {
  const mode: SearchMode = opts.mode ?? 'auto';
  const limit = opts.limit ?? 8;
  const sources = opts.sources?.length ? new Set(opts.sources) : undefined;
  const qTerms = [...new Set(termList(query))];

  const bm25 = bm25Search(index, query, CAND, sources);
  const bm25Ids = bm25.map((h) => h.id);

  const semanticPossible = !!(vectors && vectors.dim && queryVec && queryVec.length === vectors.dim);
  const wantsSemantic = mode === 'semantic' || mode === 'hybrid' || mode === 'auto';

  // resolve the executed mode + a degraded reason if the request can't be honored
  let exec: SearchMode;
  let degraded: string | undefined;
  if (!wantsSemantic) exec = 'fts';
  else if (semanticPossible) exec = mode === 'auto' ? 'hybrid' : mode;
  else {
    exec = 'fts';
    if (mode === 'semantic' || mode === 'hybrid') degraded = 'semantic-unavailable';
  }

  let orderedIds: string[];
  if (exec === 'fts') {
    orderedIds = bm25Ids;
  } else {
    const allowed = sourceFilteredIds(index, sources);
    const cosine = cosineTopK(vectors!, queryVec!, CAND, allowed).filter((h) => index.docs.has(h.id));
    const cosineIds = cosine.map((h) => h.id);
    if (exec === 'semantic') {
      orderedIds = cosineIds;
    } else {
      // hybrid: BM25 ⊕ cosine ⊕ memory-importance prior, fused by rank (scale-free)
      const priorIds = [...new Set([...bm25Ids, ...cosineIds])]
        .map((id) => index.docs.get(id))
        .filter((m): m is NonNullable<typeof m> => !!m && m.source === 'memory' && m.importance != null)
        .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
        .map((m) => m.id);
      orderedIds = rrfFuse([
        { ids: bm25Ids },
        { ids: cosineIds },
        { ids: priorIds, weight: 0.4 },
      ]);
    }
  }

  const snippets = opts.snippets !== false;
  const hits: SearchHit[] = [];
  for (const id of orderedIds.slice(0, limit)) {
    const m = index.docs.get(id);
    if (!m) continue;
    hits.push({
      id: m.id,
      source: m.source,
      title: m.title,
      path: m.path,
      noteType: m.noteType,
      tags: m.tags,
      score: 0, // rank-based; fused score isn't meaningful cross-mode, so we expose rank order
      snippet: snippets ? makeSnippet(m.text, qTerms) : '',
      importance: m.importance,
    });
  }
  return { hits, mode: exec, degraded, total: new Set(orderedIds).size };
}

// ---- disk/embedding wrapper (the only impure part) -------------------------

let indexCache: { index: InvertedIndex; mtime: number } | null = null;
let vectorCache: { vectors: VectorIndex; mtime: number } | null = null;
const queryVecLRU = new Map<string, number[]>(); // key = `${tag}\n${query}`
const LRU_CAP = 100;

/** cached index load — re-reads only when the on-disk index.json mtime changes. */
async function cachedIndex(): Promise<InvertedIndex> {
  const mtime = await indexMtimeMs();
  if (!indexCache || indexCache.mtime !== mtime) {
    indexCache = { index: (await loadIndex()).index, mtime };
  }
  return indexCache.index;
}

async function cachedVectors(): Promise<VectorIndex> {
  const mtime = await vectorsMtimeMs();
  if (!vectorCache || vectorCache.mtime !== mtime) {
    vectorCache = { vectors: await loadVectors(), mtime };
  }
  return vectorCache.vectors;
}

/** drop in-process caches (tests + after a reindex in the same process). */
export function resetSearchCaches(): void {
  indexCache = null;
  vectorCache = null;
  queryVecLRU.clear();
}

/**
 * The public search entrypoint. Loads the cached index, lazily resolves a BYOK
 * embedder (opts → env SANOOK_EMBEDDING_MODEL → config → auto-detect), embeds the
 * query (LRU-cached) only when semantic is wanted AND a usable same-tag vector set
 * exists, then delegates to rankSearch. Any embedding failure degrades to BM25.
 */
export async function search(query: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const index = await cachedIndex();
  const mode = opts.mode ?? 'auto';

  if (mode === 'fts') return rankSearch(index, query, opts);

  const spec = await embeddingModelSpec(opts.embeddingModel);
  const embedder = getEmbedder(spec);
  if (!embedder) {
    const res = rankSearch(index, query, opts);
    if (mode === 'semantic' || mode === 'hybrid') res.degraded = 'no-embedder';
    return res;
  }

  const vectors = await cachedVectors();
  // a model change (different tag) invalidates the cache → behave as no-vectors until reindex
  if (!vectors.dim || vectors.tag !== embedder.tag) {
    const res = rankSearch(index, query, opts);
    res.degraded = vectors.dim ? 'embedding-model-changed' : 'no-vectors';
    return mode === 'auto' ? { ...res, degraded: undefined } : res;
  }

  let queryVec: number[] | undefined;
  try {
    const key = `${embedder.tag}\n${query}`;
    const cached = queryVecLRU.get(key);
    if (cached) {
      queryVec = cached;
    } else {
      queryVec = await embedQuery(embedder, query);
      queryVecLRU.set(key, queryVec);
      if (queryVecLRU.size > LRU_CAP) queryVecLRU.delete(queryVecLRU.keys().next().value as string);
    }
  } catch {
    const res = rankSearch(index, query, opts); // embedding failed mid-query → BM25 floor
    res.degraded = 'semantic-unavailable';
    return res;
  }

  return rankSearch(index, query, opts, vectors, queryVec);
}
