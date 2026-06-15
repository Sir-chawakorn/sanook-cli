import { describe, it, expect } from 'vitest';
import { emptyIndex, addDoc, type Doc } from './index-core.js';
import { buildVectorIndex } from './embed-store.js';
import { rankSearch } from './engine.js';

const d = (id: string, source: Doc['source'], title: string, text: string, extra: Partial<Doc> = {}): Doc => ({
  id,
  source,
  title,
  text,
  ...extra,
});

function corpus() {
  const idx = emptyIndex();
  addDoc(idx, d('vault:deploy', 'vault', 'Deploy Runbook', 'how to deploy the next app to vercel edge functions'));
  addDoc(idx, d('mem:pup', 'memory', '', 'ปิ๊ก uses Playwright not Puppeteer for automation', { importance: 0.9 }));
  addDoc(idx, d('sess:pg', 'session', '', 'set up the postgres migration with drizzle', { updatedMs: 1 }));
  addDoc(idx, d('skill:ship', 'skill', 'ship', 'ship code to production safely'));
  return idx;
}

describe('rankSearch — fts (the floor)', () => {
  it('ranks across all sources and extracts a snippet around the matched term', () => {
    const idx = corpus();
    const res = rankSearch(idx, 'deploy vercel', { mode: 'fts' });
    expect(res.mode).toBe('fts');
    expect(res.hits[0].id).toBe('vault:deploy');
    expect(res.hits[0].snippet.toLowerCase()).toContain('vercel');
  });

  it('source filter restricts results', () => {
    const idx = corpus();
    const res = rankSearch(idx, 'postgres migration', { mode: 'fts', sources: ['session'] });
    expect(res.hits.map((h) => h.id)).toEqual(['sess:pg']);
  });

  it('respects limit', () => {
    const idx = corpus();
    addDoc(idx, d('vault:deploy2', 'vault', 'Deploy more', 'deploy deploy deploy vercel vercel'));
    const res = rankSearch(idx, 'deploy', { mode: 'fts', limit: 1 });
    expect(res.hits).toHaveLength(1);
  });
});

describe('rankSearch — degradation', () => {
  it('mode=auto with no vectors silently runs fts (no degraded flag)', () => {
    const res = rankSearch(corpus(), 'deploy', { mode: 'auto' });
    expect(res.mode).toBe('fts');
    expect(res.degraded).toBeUndefined();
  });

  it('mode=semantic with no vectors flags semantic-unavailable, still returns BM25 hits', () => {
    const res = rankSearch(corpus(), 'deploy vercel', { mode: 'semantic' });
    expect(res.mode).toBe('fts');
    expect(res.degraded).toBe('semantic-unavailable');
    expect(res.hits[0].id).toBe('vault:deploy');
  });
});

describe('rankSearch — hybrid with vectors', () => {
  it('fuses cosine + bm25 so a semantically-near doc with weak lexical overlap can surface', () => {
    const idx = corpus();
    // fake 2-d vectors: query points at 'mem:pup'; lexically the query barely overlaps it
    const vectors = buildVectorIndex('fake:model', [
      { id: 'vault:deploy', vec: [0, 1] },
      { id: 'mem:pup', vec: [1, 0] },
      { id: 'sess:pg', vec: [0.2, 0.2] },
      { id: 'skill:ship', vec: [0, 1] },
    ]);
    const queryVec = [1, 0]; // aligned with mem:pup
    const res = rankSearch(idx, 'automation tooling choice', { mode: 'hybrid' }, vectors, queryVec);
    expect(res.mode).toBe('hybrid');
    expect(res.hits.map((h) => h.id)).toContain('mem:pup');
  });

  it('mode=auto upgrades to hybrid when usable vectors + query vector are present', () => {
    const idx = corpus();
    const vectors = buildVectorIndex('fake:model', [
      { id: 'vault:deploy', vec: [1, 0] },
      { id: 'mem:pup', vec: [0, 1] },
      { id: 'sess:pg', vec: [0, 1] },
      { id: 'skill:ship', vec: [0, 1] },
    ]);
    const res = rankSearch(idx, 'deploy', { mode: 'auto' }, vectors, [1, 0]);
    expect(res.mode).toBe('hybrid');
    expect(res.hits[0].id).toBe('vault:deploy');
  });

  it('dimension-mismatched query vector falls back to fts', () => {
    const idx = corpus();
    const vectors = buildVectorIndex('fake:model', [{ id: 'vault:deploy', vec: [1, 0] }]);
    const res = rankSearch(idx, 'deploy', { mode: 'hybrid' }, vectors, [1, 0, 0]);
    expect(res.mode).toBe('fts');
    expect(res.degraded).toBe('semantic-unavailable');
  });
});
