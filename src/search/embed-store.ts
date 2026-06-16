// ============================================================================
// src/search/embed-store.ts — OPTIONAL L1 semantic layer (BYOK embeddings).
//
// arra-oracle's semantic search needs LanceDB/sqlite-vec/Qdrant native binaries
// (~100MB, no Windows for LanceDB) plus an Ollama model download and a Python
// reranker sidecar. We need NONE of that: embeddings go through the user's
// EXISTING ai-SDK provider key (embedMany), vectors live as a compact Float32
// blob next to index.json, and cosine runs in-process over a BM25-PREFILTERED
// candidate set (so we never scan the whole corpus per query). The whole layer is
// LAZY — absent without a key, the engine degrades to BM25 with zero ceremony.
//
// Pure math (normalize, cosineTopK, (de)serialize) is unit-tested with fake
// vectors; the only networked function is embedTexts(), kept thin.
// ============================================================================
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { embedMany } from 'ai';
import { appHomePath, persistenceEnabled } from '../brand.js';
import { resolveEmbedder, type ResolvedEmbedder } from '../providers/registry.js';
import type { Scored } from './index-core.js';

export const VECTORS_PATH = join(appHomePath('search'), 'vectors.json');

/** an in-memory vector set: flat Float32 (length = ids.length * dim), L2-normalized at insert. */
export interface VectorIndex {
  tag: string; // provider:model — a mismatch self-invalidates the cache
  dim: number;
  ids: string[];
  data: Float32Array; // row i (ids[i]) = data[i*dim .. i*dim+dim]
}

export function emptyVectors(tag = ''): VectorIndex {
  return { tag, dim: 0, ids: [], data: new Float32Array(0) };
}

/** L2-normalize in place and return — lets cosine reduce to a dot product. */
export function normalizeVec(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/** build a VectorIndex from rows (vectors normalized on the way in). */
export function buildVectorIndex(tag: string, rows: { id: string; vec: number[] | Float32Array }[]): VectorIndex {
  if (!rows.length) return emptyVectors(tag);
  const dim = rows[0].vec.length;
  if (dim <= 0) return emptyVectors(tag);
  const data = new Float32Array(rows.length * dim);
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].vec.length !== dim) {
      throw new Error(`vector dimension mismatch for "${rows[i].id}": expected ${dim}, got ${rows[i].vec.length}`);
    }
    const v = Float32Array.from(rows[i].vec);
    normalizeVec(v);
    data.set(v, i * dim);
    ids.push(rows[i].id);
  }
  return { tag, dim, ids, data };
}

/**
 * Cosine top-K over a normalized vector index. `queryVec` is normalized here.
 * An optional candidate allow-list (the BM25 prefilter) means cosine touches only
 * a bounded set, never the whole corpus. Pure + deterministic.
 */
export function cosineTopK(
  vi: VectorIndex,
  queryVec: number[] | Float32Array,
  k = 50,
  candidates?: ReadonlySet<string>,
): Scored[] {
  if (!vi.dim || !vi.ids.length) return [];
  const q = normalizeVec(Float32Array.from(queryVec));
  if (q.length !== vi.dim) return [];
  const out: Scored[] = [];
  for (let i = 0; i < vi.ids.length; i++) {
    const id = vi.ids[i];
    if (candidates && !candidates.has(id)) continue;
    let dot = 0;
    const base = i * vi.dim;
    for (let d = 0; d < vi.dim; d++) dot += q[d] * vi.data[base + d];
    out.push({ id, score: dot });
  }
  return out
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, k);
}

/** map id → row index, for incremental updates / lookups. */
export function vectorIds(vi: VectorIndex): Set<string> {
  return new Set(vi.ids);
}

// ---- (de)serialization: Float32 blob ⇄ base64 (compact, one JSON file) ----
interface VectorsJSON {
  v: number;
  tag: string;
  dim: number;
  ids: string[];
  b64: string; // base64 of the Float32 buffer
}
const VEC_FILE_VERSION = 1;

export function serializeVectors(vi: VectorIndex): VectorsJSON {
  const buf = Buffer.from(vi.data.buffer, vi.data.byteOffset, vi.data.byteLength);
  return { v: VEC_FILE_VERSION, tag: vi.tag, dim: vi.dim, ids: vi.ids, b64: buf.toString('base64') };
}

export function deserializeVectors(raw: unknown): VectorIndex {
  const o = raw as Partial<VectorsJSON> | null;
  if (
    !o ||
    o.v !== VEC_FILE_VERSION ||
    typeof o.tag !== 'string' ||
    typeof o.dim !== 'number' ||
    !Number.isInteger(o.dim) ||
    o.dim < 0 ||
    !Array.isArray(o.ids) ||
    !o.ids.every((id) => typeof id === 'string') ||
    typeof o.b64 !== 'string'
  ) {
    return emptyVectors();
  }
  // dim=0 is only valid for an empty index — normalize to emptyVectors so the invariant
  // (dim===0 ⇔ ids=[] ⇔ data empty) holds at the deserializer boundary, not just downstream.
  if (o.dim === 0) return emptyVectors(o.tag);
  const buf = Buffer.from(o.b64, 'base64');
  if (buf.byteLength % 4 !== 0) return emptyVectors(o.tag);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const data = new Float32Array(arrayBuffer);
  // defensive: row count must match ids*dim, else treat as corrupt
  if (data.length !== o.ids.length * o.dim) return emptyVectors(o.tag);
  return { tag: o.tag ?? '', dim: o.dim, ids: o.ids, data: Float32Array.from(data) };
}

// ---- fs boundary (mirrors store.ts: atomic, 0o600, persistence-gated) ----
export async function loadVectors(): Promise<VectorIndex> {
  try {
    return deserializeVectors(JSON.parse(await readFile(VECTORS_PATH, 'utf8')));
  } catch {
    return emptyVectors();
  }
}

export async function saveVectors(vi: VectorIndex): Promise<void> {
  if (!persistenceEnabled()) return;
  const dir = appHomePath('search');
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `vectors.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(serializeVectors(vi))}\n`, { mode: 0o600 });
    await chmod(tmp, 0o600).catch(() => {});
    await rename(tmp, VECTORS_PATH);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export function invalidateVectors(tag = ''): Promise<void> {
  return saveVectors(emptyVectors(tag));
}

export async function vectorsMtimeMs(): Promise<number> {
  try {
    return (await stat(VECTORS_PATH)).mtimeMs;
  } catch {
    return 0;
  }
}

// ---- networked: embedding (the only part that talks to a provider) ----
const BATCH = 64;

/** resolve a BYOK embedder (or null). Thin re-export so search code imports from one place. */
export function getEmbedder(spec?: string): ResolvedEmbedder | null {
  return resolveEmbedder(spec);
}

/**
 * Embed many texts in batches with exponential backoff on rate limits. Returns
 * one number[] per input, in order. Throws only if every retry fails — callers
 * (engine/indexer) catch and fall back to BM25.
 */
export async function embedTexts(embedder: ResolvedEmbedder, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    out.push(...(await embedBatchWithRetry(embedder, slice)));
  }
  return out;
}

/** embed a single query string. */
export async function embedQuery(embedder: ResolvedEmbedder, text: string): Promise<number[]> {
  return (await embedBatchWithRetry(embedder, [text]))[0];
}

async function embedBatchWithRetry(embedder: ResolvedEmbedder, values: string[], attempt = 0): Promise<number[][]> {
  try {
    const { embeddings } = await embedMany({ model: embedder.model, values });
    return embeddings;
  } catch (e) {
    const msg = (e as Error).message ?? '';
    const retryable = /429|rate.?limit|timeout|ECONNRESET|503|overloaded/i.test(msg);
    if (retryable && attempt < 4) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      return embedBatchWithRetry(embedder, values, attempt + 1);
    }
    throw e;
  }
}
