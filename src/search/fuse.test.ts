import { describe, it, expect } from 'vitest';
import { rrf, rrfFuse } from './fuse.js';

describe('rrf', () => {
  it('a doc present in both lists outranks a doc strong in only one', () => {
    // 'both' is rank 1 in each list; 'solo' is rank 0 in only the first
    const fused = rrfFuse([
      { ids: ['solo', 'both', 'x'] },
      { ids: ['y', 'both', 'z'] },
    ]);
    expect(fused[0]).toBe('both');
  });

  it('is scale-free: only ranks matter, never raw scores', () => {
    const a = rrf([{ ids: ['p', 'q'] }, { ids: ['q', 'p'] }]);
    // p: 1/60 + 1/61 ; q: 1/61 + 1/60 → equal
    expect(a.get('p')).toBeCloseTo(a.get('q') as number, 12);
  });

  it('weights let one list nudge without dominating', () => {
    const fused = rrfFuse([
      { ids: ['a', 'b'] },
      { ids: ['b'], weight: 0.5 }, // prior gently lifts b
    ]);
    // b: 1/61 + 0.5/60 = 0.0164 + 0.0083 = 0.0247 ; a: 1/60 = 0.0167 → b wins
    expect(fused[0]).toBe('b');
  });

  it('deterministic ordering + limit', () => {
    const fused = rrfFuse([{ ids: ['a', 'b', 'c'] }], 2);
    expect(fused).toEqual(['a', 'b']);
  });

  it('empty input → empty output', () => {
    expect(rrfFuse([])).toEqual([]);
    expect(rrfFuse([{ ids: [] }])).toEqual([]);
  });
});
