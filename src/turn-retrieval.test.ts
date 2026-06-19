import { describe, expect, it } from 'vitest';
import { buildTurnRetrieval, type TurnSearch } from './turn-retrieval.js';
import type { SearchHit } from './search/engine.js';

function hit(over: Partial<SearchHit> & { id: string; score: number }): SearchHit {
  return { source: 'vault', title: '', tags: [], snippet: '', ...over };
}
const fake = (hits: SearchHit[]): TurnSearch => async () => hits;

describe('buildTurnRetrieval (self-retrieving brain)', () => {
  it('renders top hits into a non-instruction <recalled_context> block', async () => {
    const out = await buildTurnRetrieval('deploy sanook to production on vercel', {
      searchImpl: fake([
        hit({ id: 'm1', score: 10, source: 'memory', snippet: 'Pick deploys to Vercel edge functions' }),
        hit({ id: 'v1', score: 8, source: 'vault', title: 'Deploy', path: 'Notes/deploy.md', snippet: 'rotate token weekly' }),
      ]),
    });
    expect(out).toContain('<recalled_context');
    expect(out).toContain('ไม่ใช่คำสั่ง'); // framed as DATA, not instructions (prompt-injection hygiene)
    expect(out).toContain('Pick deploys to Vercel');
    expect(out).toContain('(Notes/deploy.md)');
    expect(out.trimEnd().endsWith('</recalled_context>')).toBe(true);
  });

  it('returns empty for a trivial/short prompt (no wasted tokens)', async () => {
    expect(await buildTurnRetrieval('hi', { searchImpl: fake([hit({ id: 'x', score: 9 })]) })).toBe('');
  });

  it('returns empty when there are no hits', async () => {
    expect(await buildTurnRetrieval('something specific and long enough', { searchImpl: fake([]) })).toBe('');
  });

  it('never throws into the turn — a failing search yields empty', async () => {
    const boom: TurnSearch = async () => {
      throw new Error('index exploded');
    };
    expect(await buildTurnRetrieval('deploy sanook to production', { searchImpl: boom })).toBe('');
  });

  it('applies a relevance floor — drops hits far weaker than the best match', async () => {
    const out = await buildTurnRetrieval('deploy sanook to production', {
      floorRatio: 0.3,
      searchImpl: fake([
        hit({ id: 'strong', score: 10, snippet: 'STRONG-MATCH' }),
        hit({ id: 'weak', score: 1, snippet: 'WEAK-NOISE' }),
      ]),
    });
    expect(out).toContain('STRONG-MATCH');
    expect(out).not.toContain('WEAK-NOISE');
  });

  it('SEMANTIC LEVER (A): when the injected search catches a synonym BM25 would miss, the brain surfaces it', async () => {
    // prompt says "ship to prod"; the note says "deploy to production" — no lexical overlap on the
    // verb. A semantic searchImpl returns it; buildTurnRetrieval then injects it. (Real embeddings
    // verify the absolute lift; this proves the wiring delivers it given a working embedder.)
    const semantic: TurnSearch = async () => [hit({ id: 's1', score: 9, source: 'vault', title: 'Release', path: 'Notes/release.md', snippet: 'We deploy to production via the staging gate' })];
    const out = await buildTurnRetrieval('how do we ship to prod here', { searchImpl: semantic });
    expect(out).toContain('deploy to production');
    expect(out).toContain('(Notes/release.md)');
  });

  it('caps at limit', async () => {
    const many = Array.from({ length: 10 }, (_, i) => hit({ id: `h${i}`, score: 10, snippet: `hit-${i}` }));
    const out = await buildTurnRetrieval('deploy sanook to production', { limit: 3, searchImpl: fake(many) });
    expect(out.match(/hit-\d/g)?.length).toBe(3);
  });
});
