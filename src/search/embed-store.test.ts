import { describe, it, expect } from 'vitest';
import {
  buildVectorIndex,
  cosineTopK,
  normalizeVec,
  serializeVectors,
  deserializeVectors,
  emptyVectors,
} from './embed-store.js';

describe('normalizeVec', () => {
  it('produces a unit vector', () => {
    const v = normalizeVec(Float32Array.from([3, 4]));
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 6);
  });
  it('zero vector stays finite (no NaN)', () => {
    const v = normalizeVec(Float32Array.from([0, 0]));
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe('cosineTopK', () => {
  const vi = buildVectorIndex('fake:model', [
    { id: 'east', vec: [1, 0] },
    { id: 'north', vec: [0, 1] },
    { id: 'ne', vec: [1, 1] },
  ]);

  it('ranks by cosine to the query direction', () => {
    const hits = cosineTopK(vi, [1, 0]); // pointing east
    expect(hits[0].id).toBe('east');
    expect(hits[1].id).toBe('ne'); // 45° beats 90°
    expect(hits[2].id).toBe('north');
  });

  it('honors a candidate allow-list (the BM25 prefilter)', () => {
    const hits = cosineTopK(vi, [1, 0], 50, new Set(['north', 'ne']));
    expect(hits.map((h) => h.id)).toEqual(['ne', 'north']); // 'east' excluded
  });

  it('dimension mismatch → no hits (defensive)', () => {
    expect(cosineTopK(vi, [1, 0, 0])).toEqual([]);
  });

  it('empty index → no hits', () => {
    expect(cosineTopK(emptyVectors('x'), [1, 0])).toEqual([]);
  });
});

describe('serialize round-trip', () => {
  it('restores vectors, ids, dim, and tag exactly', () => {
    const vi = buildVectorIndex('openai:text-embedding-3-small', [
      { id: 'a', vec: [0.1, 0.2, 0.3] },
      { id: 'b', vec: [0.9, 0.1, 0.0] },
    ]);
    const restored = deserializeVectors(JSON.parse(JSON.stringify(serializeVectors(vi))));
    expect(restored.tag).toBe(vi.tag);
    expect(restored.dim).toBe(3);
    expect(restored.ids).toEqual(['a', 'b']);
    // same ranking after round-trip
    expect(cosineTopK(restored, [0.1, 0.2, 0.3])[0].id).toBe('a');
  });

  it('rejects inconsistent row dimensions before serializing a corrupt index', () => {
    expect(() =>
      buildVectorIndex('fake:model', [
        { id: 'a', vec: [1, 0] },
        { id: 'b', vec: [0, 1, 0] },
      ]),
    ).toThrow(/dimension mismatch/);
  });

  it('garbage / wrong version degrades to empty (self-invalidates)', () => {
    expect(deserializeVectors({ v: 999 }).ids).toEqual([]);
    expect(deserializeVectors(null).ids).toEqual([]);
  });

  it('corrupt vector payloads degrade to empty instead of throwing', () => {
    const corrupt = { v: 1, tag: 'fake:model', dim: 2, ids: ['a'], b64: Buffer.from([1, 2, 3]).toString('base64') };
    expect(deserializeVectors(corrupt).ids).toEqual([]);
    expect(deserializeVectors({ v: 1, tag: 'fake:model', dim: 2, ids: [123], b64: '' }).ids).toEqual([]);
  });

  it('tag mismatch is observable so a model change can invalidate the cache', () => {
    const vi = buildVectorIndex('openai:text-embedding-3-small', [{ id: 'a', vec: [1, 0] }]);
    const restored = deserializeVectors(JSON.parse(JSON.stringify(serializeVectors(vi))));
    expect(restored.tag).not.toBe('mistral:mistral-embed'); // caller compares tag → re-embed
  });
});
