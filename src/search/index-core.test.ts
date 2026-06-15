import { describe, it, expect } from 'vitest';
import {
  emptyIndex,
  addDoc,
  removeDoc,
  bm25Search,
  termList,
  indexToJSON,
  indexFromJSON,
  indexStats,
  type Doc,
} from './index-core.js';

const doc = (id: string, title: string, text: string, extra: Partial<Doc> = {}): Doc => ({
  id,
  source: 'vault',
  title,
  text,
  ...extra,
});

describe('termList', () => {
  it('keeps repeats (tf) and drops 1-char tokens, same normalize as memory-store', () => {
    expect(termList('deploy deploy to Vercel')).toEqual(['deploy', 'deploy', 'to', 'vercel']);
  });
  it('is Thai-safe (keeps Thai chars)', () => {
    expect(termList('ปิ๊ก ชอบ dark mode')).toContain('ชอบ');
    expect(termList('ปิ๊ก ชอบ dark mode')).toContain('dark');
  });
});

describe('bm25Search ranking', () => {
  it('ranks the on-topic doc first', () => {
    const idx = emptyIndex();
    addDoc(idx, doc('a', 'Vercel deploy', 'how to deploy a next app to vercel edge'));
    addDoc(idx, doc('b', 'Cooking', 'a recipe for pad thai with tamarind'));
    addDoc(idx, doc('c', 'Postgres', 'tuning a postgres index for range scans'));
    const hits = bm25Search(idx, 'deploy vercel');
    expect(hits[0].id).toBe('a');
  });

  it('title terms outrank body-only terms (field boost)', () => {
    const idx = emptyIndex();
    addDoc(idx, doc('title', 'webhook signature', 'unrelated body text about cats'));
    addDoc(idx, doc('body', 'random note', 'we verify the webhook signature once in the body'));
    const hits = bm25Search(idx, 'webhook signature');
    expect(hits[0].id).toBe('title');
  });

  it('IDF down-weights a term present in every doc', () => {
    const idx = emptyIndex();
    // "the" everywhere → near-zero idf; "raptor" rare → dominates
    addDoc(idx, doc('a', '', 'the the the raptor'));
    addDoc(idx, doc('b', '', 'the the the the'));
    addDoc(idx, doc('c', '', 'the the the the'));
    const hits = bm25Search(idx, 'the raptor');
    expect(hits[0].id).toBe('a'); // the rare discriminating term wins
  });

  it('respects a source allow-list', () => {
    const idx = emptyIndex();
    addDoc(idx, doc('v', 'deploy', 'deploy notes', { source: 'vault' }));
    addDoc(idx, doc('m', 'deploy', 'deploy memory', { source: 'memory' }));
    const hits = bm25Search(idx, 'deploy', 50, new Set(['memory']));
    expect(hits.map((h) => h.id)).toEqual(['m']);
  });

  it('empty index / empty query → no hits, no throw', () => {
    expect(bm25Search(emptyIndex(), 'deploy')).toEqual([]);
    const idx = addDoc(emptyIndex(), doc('a', 't', 'body'));
    expect(bm25Search(idx, '   ')).toEqual([]);
  });
});

describe('addDoc / removeDoc invariants', () => {
  it('re-adding the same id replaces postings (no duplicate creep)', () => {
    const idx = emptyIndex();
    addDoc(idx, doc('a', 'one', 'alpha alpha alpha'));
    addDoc(idx, doc('a', 'two', 'beta beta beta')); // same id, new content
    expect(idx.docs.size).toBe(1);
    // old term "alpha" must be fully gone, not lingering with a stale posting
    expect(idx.postings.get('alpha')).toBeUndefined();
    expect(idx.postings.get('beta')?.length).toBe(1);
    expect(bm25Search(idx, 'alpha')).toEqual([]);
  });

  it('removeDoc evicts the doc and its postings', () => {
    const idx = emptyIndex();
    addDoc(idx, doc('a', 'keep', 'keepme content'));
    addDoc(idx, doc('b', 'gone', 'removeme content'));
    removeDoc(idx, 'b');
    expect(idx.docs.size).toBe(1);
    expect(bm25Search(idx, 'removeme')).toEqual([]);
    expect(bm25Search(idx, 'keepme')[0].id).toBe('a');
  });

  it('removeDoc on absent id is a no-op', () => {
    const idx = addDoc(emptyIndex(), doc('a', 't', 'body'));
    const before = idx.docs.size;
    removeDoc(idx, 'nope');
    expect(idx.docs.size).toBe(before);
  });
});

describe('JSON round-trip', () => {
  it('serializes and restores an equivalent index', () => {
    const idx = emptyIndex();
    addDoc(idx, doc('a', 'Vercel', 'deploy to vercel', { tags: ['ops'], links: ['Deploy'] }));
    addDoc(idx, doc('b', 'Postgres', 'tune the index', { source: 'memory', importance: 0.9 }));
    const restored = indexFromJSON(JSON.parse(JSON.stringify(indexToJSON(idx))));
    expect(indexStats(restored)).toEqual(indexStats(idx));
    expect(bm25Search(restored, 'deploy vercel')[0].id).toBe('a');
    expect(restored.docs.get('b')?.importance).toBe(0.9);
  });

  it('garbage / wrong-version JSON degrades to empty', () => {
    expect(indexStats(indexFromJSON({ version: 999 })).docs).toBe(0);
    expect(indexStats(indexFromJSON(null)).docs).toBe(0);
  });
});
