// ============================================================================
// src/search/index-core.ts — the zero-dependency search FLOOR.
//
// A pure-TS inverted index with REAL BM25 (k1=1.2, b=0.75, genuine corpus-stat
// IDF via df/N). No SQLite, no Bun, no native binary, no network — it works the
// instant a corpus exists, on any OS Node 22 runs on. This is deliberately NOT
// node:sqlite FTS5: that is experimental, its FTS5 build is not guaranteed across
// platforms, and it reintroduces a quasi-native dependency that fights the
// zero-config/portability contract. A few hundred lines of TS give us a real
// ranking model that FTS5's bm25() only approximates without true global IDF.
//
// Tokenization REUSES memory-store.ts normalize() (the canonical, Thai-safe,
// stopword-aware tokenizer) so memory matching and search matching never drift.
//
// addDoc/removeDoc MUTATE the index in place and return it — an index over a
// large vault must not deep-copy its postings map on every chunk (that is the
// one place we diverge from memory-store's small-array immutability). bm25Search
// is pure and read-only. Re-adding the same doc id replaces its postings, so the
// index can never accumulate duplicate postings the way arra's FTS5
// delete-then-insert can drift.
// ============================================================================
import { normalize } from '../memory-store.js';

export const SEARCH_SOURCES = ['memory', 'vault', 'session', 'skill'] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

/** BM25 params — Robertson/Spärck-Jones defaults; title terms get weighted tf. */
const K1 = 1.2;
const B = 0.75;
const TITLE_BOOST = 2; // a term in a doc's title counts this many times toward tf

/** an input document (one vault chunk, one memory fact, one session turn, one skill). */
export interface Doc {
  id: string;
  source: SearchSource;
  title: string;
  text: string;
  path?: string; // vault-relative file path for chunks
  noteType?: string;
  tags?: string[];
  links?: string[]; // [[wikilink]] targets, for 1-hop graph expansion
  importance?: number; // memory ranking prior (0..1)
  updatedMs?: number;
}

/** stored per-doc metadata (everything except the postings, which live in the term map). */
export interface DocMeta {
  id: string;
  source: SearchSource;
  title: string;
  text: string;
  path?: string;
  noteType?: string;
  tags: string[];
  links: string[];
  importance?: number;
  updatedMs?: number;
  dl: number; // doc length in tokens (BM25 length normalization)
}

interface Posting {
  docId: string;
  tf: number; // term frequency (title occurrences pre-weighted by TITLE_BOOST)
}

export interface InvertedIndex {
  version: number;
  postings: Map<string, Posting[]>;
  docs: Map<string, DocMeta>;
  totalDl: number; // Σ dl → avgdl = totalDl / docs.size
}

export const INDEX_VERSION = 1;

export function emptyIndex(): InvertedIndex {
  return { version: INDEX_VERSION, postings: new Map(), docs: new Map(), totalDl: 0 };
}

/**
 * Ordered tokens WITH repeats — BM25 needs term frequencies, so unlike
 * memory-store's tokens() (a deduped Set) we keep counts. Same normalize() and
 * same length>1 filter, so the two tokenizers stay byte-for-byte consistent.
 */
export function termList(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length > 1);
}

/** combined term-frequency map for a doc, with title terms weighted, + the token length. */
function termFreqs(title: string, text: string): { tf: Map<string, number>; dl: number } {
  const tf = new Map<string, number>();
  const body = termList(text);
  const head = termList(title);
  for (const t of body) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const t of head) tf.set(t, (tf.get(t) ?? 0) + TITLE_BOOST);
  return { tf, dl: body.length + head.length };
}

/** add (or REPLACE, if id already present) a document. Mutates + returns idx. */
export function addDoc(idx: InvertedIndex, doc: Doc): InvertedIndex {
  if (idx.docs.has(doc.id)) removeDoc(idx, doc.id); // replace → no posting creep
  const { tf, dl } = termFreqs(doc.title, doc.text);
  const meta: DocMeta = {
    id: doc.id,
    source: doc.source,
    title: doc.title,
    text: doc.text,
    path: doc.path,
    noteType: doc.noteType,
    tags: doc.tags ?? [],
    links: doc.links ?? [],
    importance: doc.importance,
    updatedMs: doc.updatedMs,
    dl,
  };
  idx.docs.set(doc.id, meta);
  idx.totalDl += dl;
  for (const [term, freq] of tf) {
    const plist = idx.postings.get(term);
    if (plist) plist.push({ docId: doc.id, tf: freq });
    else idx.postings.set(term, [{ docId: doc.id, tf: freq }]);
  }
  return idx;
}

/** remove a document and all its postings. Mutates + returns idx. No-op if absent. */
export function removeDoc(idx: InvertedIndex, id: string): InvertedIndex {
  const meta = idx.docs.get(id);
  if (!meta) return idx;
  const { tf } = termFreqs(meta.title, meta.text);
  for (const term of tf.keys()) {
    const plist = idx.postings.get(term);
    if (!plist) continue;
    const next = plist.filter((p) => p.docId !== id);
    if (next.length) idx.postings.set(term, next);
    else idx.postings.delete(term);
  }
  idx.totalDl -= meta.dl;
  idx.docs.delete(id);
  return idx;
}

export interface Scored {
  id: string;
  score: number;
}

/**
 * BM25 ranking — pure, read-only. Genuine IDF from df/N (the always-positive
 * BM25+ form ln(1 + (N-df+0.5)/(df+0.5))), length-normalized by avgdl. Optional
 * source allow-list keeps cross-corpus queries cheap. Deterministic tie-break by id.
 */
export function bm25Search(
  idx: InvertedIndex,
  query: string,
  limit = 50,
  sources?: ReadonlySet<SearchSource>,
): Scored[] {
  const n = idx.docs.size;
  if (!n) return [];
  const avgdl = idx.totalDl / n || 1;
  const qTerms = [...new Set(termList(query))];
  if (!qTerms.length) return [];

  const scores = new Map<string, number>();
  for (const term of qTerms) {
    const plist = idx.postings.get(term);
    if (!plist) continue;
    const df = plist.length;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    for (const p of plist) {
      const meta = idx.docs.get(p.docId);
      if (!meta) continue;
      if (sources && !sources.has(meta.source)) continue;
      const denom = p.tf + K1 * (1 - B + B * (meta.dl / avgdl));
      const contrib = idf * ((p.tf * (K1 + 1)) / denom);
      scores.set(p.docId, (scores.get(p.docId) ?? 0) + contrib);
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}

export interface IndexStats {
  docs: number;
  terms: number;
  bySource: Record<string, number>;
  avgdl: number;
}

export function indexStats(idx: InvertedIndex): IndexStats {
  const bySource: Record<string, number> = {};
  for (const m of idx.docs.values()) bySource[m.source] = (bySource[m.source] ?? 0) + 1;
  return {
    docs: idx.docs.size,
    terms: idx.postings.size,
    bySource,
    avgdl: idx.docs.size ? idx.totalDl / idx.docs.size : 0,
  };
}

// ---- JSON (de)serialization — Maps don't survive JSON.stringify on their own ----
interface IndexJSON {
  version: number;
  totalDl: number;
  postings: Record<string, Posting[]>;
  docs: DocMeta[];
}

export function indexToJSON(idx: InvertedIndex): IndexJSON {
  const postings: Record<string, Posting[]> = {};
  for (const [term, plist] of idx.postings) postings[term] = plist;
  return { version: idx.version, totalDl: idx.totalDl, postings, docs: [...idx.docs.values()] };
}

export function indexFromJSON(raw: unknown): InvertedIndex {
  const obj = raw as Partial<IndexJSON> | null;
  if (!obj || obj.version !== INDEX_VERSION || !obj.postings || !Array.isArray(obj.docs)) {
    return emptyIndex(); // unknown/old shape degrades to empty rather than throwing
  }
  const idx = emptyIndex();
  idx.totalDl = obj.totalDl ?? 0;
  for (const [term, plist] of Object.entries(obj.postings)) idx.postings.set(term, plist);
  for (const m of obj.docs) idx.docs.set(m.id, m);
  return idx;
}
