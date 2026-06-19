import { describe, expect, it } from 'vitest';
import { buildTurnRetrieval, buildRetrievalQuery, PROJECT_SOURCES, type TurnSearch } from './turn-retrieval.js';
import type { SearchHit } from './search/engine.js';

function hit(over: Partial<SearchHit> & { id: string; score: number }): SearchHit {
  return { source: 'vault', title: '', tags: [], snippet: '', ...over };
}
const fake = (hits: SearchHit[]): TurnSearch => async () => hits;

describe('PROJECT_SOURCES (H6)', () => {
  it('targets project knowledge and excludes skills (already injected via renderAvailableSkills)', () => {
    expect([...PROJECT_SOURCES]).toEqual(['vault', 'memory', 'session']);
    expect([...PROJECT_SOURCES]).not.toContain('skill');
  });
});

describe('buildRetrievalQuery (H10)', () => {
  it('returns the prompt unchanged when there is no recent context', () => {
    expect(buildRetrievalQuery('fix the auth bug', [])).toBe('fix the auth bug');
  });
  it('folds recent context in, repeating the prompt so it stays BM25-dominant', () => {
    const q = buildRetrievalQuery('optimize that', ['the orders query on customer_id is slow']);
    expect(q).toContain('orders query');
    expect(q.match(/optimize that/g)?.length).toBe(2);
  });
});

describe('buildTurnRetrieval (self-retrieving brain)', () => {
  it('H10: feeds the context-augmented query to search (anaphoric follow-up reaches the topic)', async () => {
    let received = '';
    const spy: TurnSearch = async (q) => {
      received = q;
      return [hit({ id: 'm1', score: 9, source: 'memory', snippet: 'orders query slow on customer_id' })];
    };
    await buildTurnRetrieval('optimize that', { recentTexts: ['the orders query on customer_id is slow'], searchImpl: spy });
    expect(received).toContain('orders query'); // recent context reached the search
  });

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

  it('H8 dedup: drops hits already in the statically-injected context, keeps NEW context', async () => {
    const out = await buildTurnRetrieval('which ORM are we using for the database layer', {
      excludeText: 'We decided to use Drizzle ORM, not Prisma, for the database layer.', // already in <auto_memory>
      searchImpl: fake([
        hit({ id: 'm1', score: 10, source: 'memory', snippet: 'We decided to use Drizzle ORM, not Prisma, for the database layer' }),
        hit({ id: 'v1', score: 8, source: 'vault', title: 'Schema', path: 'Notes/schema.md', snippet: 'the orders table uses a composite primary key' }),
      ]),
    });
    expect(out).not.toContain('Drizzle'); // already injected statically → deduped out
    expect(out).toContain('composite primary key'); // genuinely new context survives
  });

  it('returns empty when every hit is already statically injected (no redundant block)', async () => {
    const out = await buildTurnRetrieval('which ORM are we using here', {
      excludeText: 'We decided to use Drizzle ORM, not Prisma, for the database layer.',
      searchImpl: fake([hit({ id: 'm1', score: 10, source: 'memory', snippet: 'We decided to use Drizzle ORM, not Prisma, for the database layer' })]),
    });
    expect(out).toBe('');
  });

  it('caps at limit', async () => {
    const many = Array.from({ length: 10 }, (_, i) => hit({ id: `h${i}`, score: 10, snippet: `hit-${i}` }));
    const out = await buildTurnRetrieval('deploy sanook to production', { limit: 3, searchImpl: fake(many) });
    expect(out.match(/hit-\d/g)?.length).toBe(3);
  });
});
