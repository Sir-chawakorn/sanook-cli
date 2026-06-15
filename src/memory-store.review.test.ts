import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { rm, writeFile, mkdir, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Fact, MemoryStore } from './memory-store.js';
import { redactKey } from './providers/keys.js';

// Regression tests locking in the 8 confirmed findings from the adversarial review.
// HOME is stubbed before the first (dynamic) import so memory-store's frozen paths land in a temp dir.
let M: typeof import('./memory-store.js');
let HOME: string;
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

beforeAll(async () => {
  HOME = mkdtempSync(join(tmpdir(), 'sanook-review-'));
  vi.stubEnv('HOME', HOME);
  M = await import('./memory-store.js');
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(HOME, { recursive: true, force: true });
});

function mk(over: Partial<Fact> & { text: string }): Fact {
  return {
    id: M.deriveId(over.text),
    noteType: 'reference', tier: 'durable', trust: 'agent', tags: [], importance: 0.5, accessCount: 0,
    status: 'active', validFrom: NOW, invalidatedAt: null, supersededBy: null, supersedes: [], related: [],
    parent: 'auto-memory', source: null, created: NOW, updated: NOW, lastAccessed: NOW, reviewAfter: null,
    ...over,
  };
}
const store = (facts: Fact[]): MemoryStore => ({
  version: 2, meta: { lastConsolidated: 0, activeAtLastConsolidate: 0, migratedFrom: null }, facts,
});

describe('finding: inbox/quarantined facts must NOT reach prompt or MEMORY.md', () => {
  it('renderPromptBlock + renderView exclude tier:inbox, keep durable/protected', () => {
    const s = store([
      mk({ text: 'public durable fact' }),
      mk({ text: 'PROTECTED ground truth', tier: 'protected', importance: 0.9 }),
      mk({ text: 'quarantined untrusted claim', tier: 'inbox', trust: 'untrusted' }),
    ]);
    const block = M.renderPromptBlock(s, NOW);
    expect(block).toContain('public durable fact');
    expect(block).toContain('PROTECTED ground truth');
    expect(block).not.toContain('quarantined');
    expect(M.renderView(s, NOW)).not.toContain('quarantined');
  });
  it('a store with only inbox facts renders an empty prompt block', () => {
    expect(M.renderPromptBlock(store([mk({ text: 'inbox only', tier: 'inbox' })]), NOW)).toBe('');
  });
});

describe('finding: punctuation/emoji-only facts are dropped (no shared-empty-id collapse)', () => {
  it('punctuation-only → NOOP, nothing stored, real facts untouched', () => {
    const r1 = M.mergeFact(store([]), { text: '!!! ???' }, NOW);
    expect(r1.op).toBe('NOOP');
    expect(r1.store.facts).toHaveLength(0);
    const withReal = M.mergeFact(store([]), { text: 'a real fact here' }, NOW).store;
    const r2 = M.mergeFact(withReal, { text: '🎉🎉🎉' }, NOW);
    expect(r2.op).toBe('NOOP');
    expect(M.activeFacts(r2.store)).toHaveLength(1);
  });
});

describe('finding: deriveId collision — re-adding superseded text gets a unique id', () => {
  it('Thai negation supersede + resurrection keeps all ids unique', () => {
    const a = M.mergeFact(store([]), { text: 'deploy ด้วย vercel', noteType: 'decision' }, NOW);
    const b = M.mergeFact(a.store, { text: 'ไม่ deploy ด้วย vercel', noteType: 'decision' }, NOW + 1);
    expect(b.op).toBe('SUPERSEDE'); // Thai now tokenizes "ไม่" separately → contradiction fires
    const c = M.mergeFact(b.store, { text: 'deploy ด้วย vercel', noteType: 'decision' }, NOW + 2);
    const ids = c.store.facts.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length); // no two facts share an id
    expect(c.fact?.id).not.toBe(a.fact?.id); // resurrected fact disambiguated from the superseded one
  });
  it('same text in two tiers yields distinct ids', () => {
    const a = M.mergeFact(store([]), { text: 'shared text across tiers' }, NOW);
    const b = M.mergeFact(a.store, { text: 'shared text across tiers', tier: 'protected' }, NOW);
    expect(b.op).toBe('ADD');
    expect(b.fact?.id).not.toBe(a.fact?.id);
  });
});

describe('finding: Thai similarity/contradiction now works (Intl.Segmenter)', () => {
  it('sim of a Thai claim vs its negation lands in the RELATED band', () => {
    expect(M.sim('deploy ด้วย vercel', 'ไม่ deploy ด้วย vercel')).toBeGreaterThanOrEqual(0.45);
  });
  it('normalize keeps Thai tone/vowel marks (does not strip \\p{M})', () => {
    expect(M.normalize('มืด')).toBe('มืด');
  });
});

describe('finding: consolidate report is idempotent / dedup-free', () => {
  it('rerunning consolidate does not re-flag needsReview', () => {
    const untrusted = mk({ text: 'untrusted inbox item awaiting scan', tier: 'inbox', trust: 'untrusted', created: NOW - 15 * DAY });
    const r1 = M.consolidate(store([untrusted]), NOW);
    expect(r1.report.needsReview).toContain(untrusted.id);
    const r2 = M.consolidate(r1.store, NOW);
    expect(r2.report.needsReview).toHaveLength(0); // already flagged ⇒ not re-emitted
  });
});

describe('finding: redactKey catches AWS AKIA access-key ids', () => {
  it('redacts AKIA… while leaving ordinary prose intact', () => {
    expect(redactKey('AKIAIOSFODNN7EXAMPLE')).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redactKey('hello world this is fine')).toBe('hello world this is fine');
  });
});

describe('finding: FS — concurrent appendMemory + MEMORY.md permissions', () => {
  beforeEach(async () => {
    await rm(M.MEMORY_DIR, { recursive: true, force: true });
  });

  it('two concurrent appendMemory calls both persist (no lost update)', async () => {
    const { appendMemory } = await import('./memory.js');
    await Promise.all([appendMemory('alpha concurrent fact'), appendMemory('beta concurrent fact')]);
    expect(M.activeFacts(await M.loadStore())).toHaveLength(2);
  });

  it('saveStore tightens a pre-existing 0o644 MEMORY.md to 0o600', async () => {
    await mkdir(M.MEMORY_DIR, { recursive: true });
    await writeFile(M.AUTO_MEMORY_FILE, '# Sanook Auto-Memory\n- legacy\n', { mode: 0o644 });
    await chmod(M.AUTO_MEMORY_FILE, 0o644);
    await M.saveStore(M.mergeFact(M.emptyStore(), { text: 'fresh fact' }, NOW).store);
    expect((await stat(M.AUTO_MEMORY_FILE)).mode & 0o777).toBe(0o600);
  });
});
