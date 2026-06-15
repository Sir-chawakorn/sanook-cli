import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Fact, MemoryStore } from './memory-store.js';

// Broad behavior coverage for the self-organizing memory store. Co-exists with memory-store.test.ts
// (which covers ADD→NOOP, PROTECTED_HALT, migrate redact+dedup) — this file covers the rest:
// UPDATE/SUPERSEDE/ambiguous/QUARANTINE, decay, consolidate, render, and the real FS boundary.
// memory-store freezes ~/.sanook/memory paths at import time, so HOME is stubbed BEFORE the first
// (dynamic) import — same approach integration.test.ts uses.
let M: typeof import('./memory-store.js');
let HOME: string;
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

beforeAll(async () => {
  HOME = mkdtempSync(join(tmpdir(), 'sanook-behav-'));
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
    noteType: 'reference',
    tier: 'durable',
    trust: 'agent',
    tags: [],
    importance: 0.5,
    accessCount: 0,
    status: 'active',
    validFrom: NOW,
    invalidatedAt: null,
    supersededBy: null,
    supersedes: [],
    related: [],
    parent: 'auto-memory',
    source: null,
    created: NOW,
    updated: NOW,
    lastAccessed: NOW,
    reviewAfter: null,
    ...over,
  };
}
const store = (facts: Fact[]): MemoryStore => ({
  version: 2,
  meta: { lastConsolidated: 0, activeAtLastConsolidate: 0, migratedFrom: null },
  facts,
});

describe('helpers: sim / deriveId', () => {
  it('sim: identical=1, disjoint=0, partial overlap lands in the RELATED band', () => {
    expect(M.sim('alpha beta gamma', 'alpha beta gamma')).toBe(1);
    expect(M.sim('alpha beta', 'delta epsilon')).toBe(0);
    expect(M.sim('pick deploys with vercel', 'pick deploys with netlify not vercel')).toBeGreaterThanOrEqual(0.45);
  });
  it('deriveId: stable across case/whitespace, distinct per text, fixed format', () => {
    expect(M.deriveId('Deploy to Vercel')).toBe(M.deriveId('deploy to   vercel '));
    expect(M.deriveId('alpha')).not.toBe(M.deriveId('beta'));
    expect(M.deriveId('anything')).toMatch(/^m_[A-Za-z0-9_-]{6}$/);
  });
});

describe('mergeFact: UPDATE / SUPERSEDE / ambiguous / QUARANTINE', () => {
  it('ADD sets the importance prior from noteType', () => {
    expect(M.mergeFact(store([]), { text: 'always run tests', noteType: 'decision' }, NOW).fact?.importance).toBe(0.7);
    expect(M.mergeFact(store([]), { text: 'pick likes short replies', noteType: 'preference' }, NOW).fact?.importance).toBe(0.6);
  });

  it('UPDATE: near-dup with more tokens edits in place, keeps id, longer text wins, importance rises', () => {
    const a = M.mergeFact(store([]), { text: 'alpha beta gamma delta epsilon' }, NOW);
    const id = a.fact!.id;
    const b = M.mergeFact(a.store, { text: 'alpha beta gamma delta epsilon zeta' }, NOW + 1);
    expect(b.op).toBe('UPDATE');
    expect(b.store.facts).toHaveLength(1);
    expect(b.fact?.id).toBe(id);
    expect(b.fact?.text).toContain('zeta');
    expect(b.fact!.importance).toBeGreaterThan(0.5);
  });

  it('SUPERSEDE: a negation flip retires the old fact bi-temporally and links the new one', () => {
    const a = M.mergeFact(store([]), { text: 'Pick deploys with vercel', noteType: 'decision' }, NOW);
    const oldId = a.fact!.id;
    const b = M.mergeFact(a.store, { text: 'Pick deploys with netlify not vercel', noteType: 'decision' }, NOW + 1);
    expect(b.op).toBe('SUPERSEDE');
    expect(M.activeFacts(b.store)).toHaveLength(1);
    expect(b.store.facts).toHaveLength(2); // old kept, queryable
    const old = b.store.facts.find((f) => f.id === oldId)!;
    expect(old.status).toBe('superseded');
    expect(old.invalidatedAt).toBe(NOW + 1);
    expect(old.supersededBy).toBe(b.fact!.id);
    expect(b.fact?.supersedes).toContain(oldId);
  });

  it('ambiguous contradiction (no polarity flip): ADD + linked + flagged, never mis-supersede', () => {
    const a = M.mergeFact(store([]), { text: 'Pick prefers tabs for indentation', noteType: 'preference' }, NOW);
    const oldId = a.fact!.id;
    const b = M.mergeFact(a.store, { text: 'Pick prefers spaces for indentation', noteType: 'preference' }, NOW + 1);
    expect(b.op).toBe('ADD');
    expect(M.activeFacts(b.store)).toHaveLength(2);
    expect(b.fact?.related).toContain(oldId);
    expect(b.fact?.reviewAfter).not.toBeNull();
  });

  it('QUARANTINE: untrusted + unresolved source lands in the inbox tier, never durable', () => {
    const r = M.mergeFact(store([]), { text: 'some scraped external claim about prices today', trust: 'untrusted' }, NOW);
    expect(r.op).toBe('QUARANTINE');
    expect(r.fact?.tier).toBe('inbox');
    expect(r.fact?.reviewAfter).toBe(NOW + 14 * DAY);
  });

  it('a resolved derived source is admitted normally (not quarantined)', () => {
    const r = M.mergeFact(store([]), { text: 'derived but verified claim', trust: 'derived', sourceResolved: true }, NOW);
    expect(r.op).toBe('ADD');
    expect(r.fact?.tier).toBe('durable');
  });
});

describe('effImportance / decay', () => {
  it('recency halves per half-life, with an access-count floor', () => {
    expect(M.effImportance(mk({ text: 'fresh', importance: 0.6, lastAccessed: NOW }), NOW)).toBeCloseTo(0.6, 5);
    expect(M.effImportance(mk({ text: 'aged', importance: 0.6, lastAccessed: NOW - 60 * DAY }), NOW)).toBeCloseTo(0.15, 2);
    expect(M.effImportance(mk({ text: 'hot', importance: 0.1, accessCount: 8, lastAccessed: NOW - 365 * DAY }), NOW)).toBeCloseTo(0.4, 5);
  });
});

describe('consolidate', () => {
  it('ARCHIVE: stale untouched low-value soft-deleted; protected exempt', () => {
    const dead = mk({ text: 'stale note nobody reads', importance: 0.3, lastAccessed: NOW - 120 * DAY, reviewAfter: NOW - DAY });
    const prot = mk({ text: 'protected ground truth', tier: 'protected', importance: 0.3, lastAccessed: NOW - 120 * DAY, reviewAfter: NOW - DAY });
    const { store: next, report } = M.consolidate(store([dead, prot]), NOW);
    expect(report.archived).toContain(dead.id);
    expect(next.facts.find((f) => f.id === dead.id)?.status).toBe('archived');
    expect(next.facts.find((f) => f.id === prot.id)?.status).toBe('active');
  });

  it('MERGE-OVERLAPPING: near-dups fold into the oldest id, accessCount summed, longer text kept', () => {
    const old = mk({ text: 'alpha beta gamma delta epsilon', created: NOW - 1000, accessCount: 2 });
    const young = mk({ text: 'alpha beta gamma delta epsilon zeta', created: NOW - 500, accessCount: 3 });
    const active = M.activeFacts(M.consolidate(store([young, old]), NOW).store);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(old.id);
    expect(active[0].accessCount).toBe(5);
    expect(active[0].text).toContain('zeta');
  });

  it('MERGE-OVERLAPPING: folds multiple near-dups into one keep without stale-reference crash', () => {
    const core = Array.from({ length: 16 }, (_, i) => `w${i}`).join(' ');
    const keep = mk({ text: core, created: NOW - 3000, accessCount: 1 });
    const dup1 = mk({ text: `${core} alpha`, created: NOW - 2000, accessCount: 2 });
    const dup2 = mk({ text: `${core} beta`, created: NOW - 1000, accessCount: 3 });

    const { store: next, report } = M.consolidate(store([keep, dup1, dup2]), NOW);
    const active = M.activeFacts(next);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(keep.id);
    expect(active[0].accessCount).toBe(6);
    expect(report.merged).toEqual([dup1.id, dup2.id]);
  });

  it('MERGE-OVERLAPPING: duplicate ids in other tiers are not removed accidentally', () => {
    const protectedFact = mk({
      text: 'alpha beta gamma delta epsilon zeta',
      tier: 'protected',
      created: NOW - 3000,
    });
    const durableKeep = mk({ text: 'alpha beta gamma delta epsilon', tier: 'durable', created: NOW - 2000 });
    const durableDup = mk({
      text: 'alpha beta gamma delta epsilon zeta',
      tier: 'durable',
      created: NOW - 1000,
    });
    expect(protectedFact.id).toBe(durableDup.id);

    const active = M.activeFacts(M.consolidate(store([protectedFact, durableKeep, durableDup]), NOW).store);
    expect(active.some((f) => f.id === protectedFact.id && f.tier === 'protected')).toBe(true);
    expect(active.filter((f) => f.tier === 'durable')).toHaveLength(1);
  });

  it('idempotent: consolidate∘consolidate === consolidate', () => {
    const s = store([
      mk({ text: 'recurring fact seen a lot', accessCount: 4, created: NOW - 100 }),
      mk({ text: 'alpha beta gamma delta epsilon', created: NOW - 1000, accessCount: 1 }),
      mk({ text: 'alpha beta gamma delta epsilon zeta', created: NOW - 500, accessCount: 1 }),
      mk({ text: 'old junk', importance: 0.2, lastAccessed: NOW - 200 * DAY, reviewAfter: NOW - DAY }),
    ]);
    const once = M.consolidate(s, NOW).store;
    const twice = M.consolidate(once, NOW).store;
    expect(twice).toEqual(once);
  });

  it('INBOX TTL: agent-origin past TTL is promoted; untrusted is kept + flagged for review', () => {
    const agent = mk({ text: 'inbox agent item ready to promote', tier: 'inbox', trust: 'agent', created: NOW - 15 * DAY });
    const untrusted = mk({ text: 'inbox untrusted item needs scan first', tier: 'inbox', trust: 'untrusted', created: NOW - 15 * DAY });
    const { store: next, report } = M.consolidate(store([agent, untrusted]), NOW);
    expect(report.promoted).toContain(agent.id);
    expect(next.facts.find((f) => f.id === agent.id)?.tier).toBe('durable');
    expect(report.needsReview).toContain(untrusted.id);
    expect(next.facts.find((f) => f.id === untrusted.id)?.tier).toBe('inbox');
  });

  it('PROMOTE: a fact accessed ≥ 3 times is raised to the importance floor 0.8 (idempotent)', () => {
    const f = mk({ text: 'frequently accessed fact', accessCount: 3, importance: 0.5 });
    const next = M.consolidate(store([f]), NOW).store;
    expect(next.facts[0].importance).toBe(0.8);
  });
});

describe('render', () => {
  it('renderPromptBlock: empty → "", non-empty → exact <auto_memory> wrapper + bullet body', () => {
    expect(M.renderPromptBlock(store([]), NOW)).toBe('');
    const out = M.renderPromptBlock(store([mk({ text: 'remember this one' })]), NOW);
    expect(out.startsWith('<auto_memory note="สิ่งที่จำไว้จาก session ก่อน">')).toBe(true);
    expect(out.trimEnd().endsWith('</auto_memory>')).toBe(true);
    expect(out).toContain('\n- remember this one');
  });

  it('renderPromptBlock: caps ~6k chars, protected/highest first, deterministic', () => {
    const facts: Fact[] = [];
    for (let i = 0; i < 30; i++) {
      facts.push(mk({ text: `fact number ${i} ${'lorem ipsum dolor sit amet '.repeat(12)}`, importance: 0.3 }));
    }
    facts.push(mk({ text: 'PROTECTED STAR FACT', tier: 'protected', importance: 0.9 }));
    const out = M.renderPromptBlock(store(facts), NOW);
    expect(out.length).toBeLessThanOrEqual(6200);
    expect(out.split('\n').find((l) => l.startsWith('- '))).toContain('PROTECTED STAR FACT');
    expect(M.renderPromptBlock(store(facts), NOW)).toBe(out); // deterministic
    expect(out.split('\n').filter((l) => l.startsWith('- ')).length).toBeLessThan(31); // cap dropped some
  });

  it('renderPromptBlock/renderView never expose inbox facts', () => {
    const s = store([
      mk({ text: 'visible durable fact' }),
      mk({ text: 'hidden inbox fact', tier: 'inbox', trust: 'untrusted' }),
    ]);

    expect(M.renderPromptBlock(s, NOW)).toContain('visible durable fact');
    expect(M.renderPromptBlock(s, NOW)).not.toContain('hidden inbox fact');
    expect(M.renderView(s, NOW)).not.toContain('hidden inbox fact');
  });

  it('renderView round-trips durable facts to "# title" + bullets', () => {
    const v = M.renderView(store([mk({ text: 'a fact' }), mk({ text: 'b fact' })]), NOW);
    expect(v.startsWith('# ')).toBe(true);
    expect(v).toContain('- a fact');
    expect(v).toContain('- b fact');
  });
});

describe('FS boundary: loadStore / saveStore', () => {
  beforeEach(async () => {
    await rm(M.MEMORY_DIR, { recursive: true, force: true });
  });

  it('saveStore writes memory.json + MEMORY.md, both 0o600', async () => {
    const s = M.mergeFact(M.emptyStore(), { text: 'persist me please' }, NOW).store;
    await M.saveStore(s);
    expect((await stat(M.MEMORY_JSON)).mode & 0o777).toBe(0o600);
    expect((await stat(M.AUTO_MEMORY_FILE)).mode & 0o777).toBe(0o600);
    const onDisk = JSON.parse(await readFile(M.MEMORY_JSON, 'utf8'));
    expect(onDisk.version).toBe(2);
    expect(onDisk.facts).toHaveLength(1);
  });

  it('loadStore round-trips a saved store', async () => {
    const s = M.mergeFact(M.emptyStore(), { text: 'round trip fact', noteType: 'decision' }, NOW).store;
    await M.saveStore(s);
    const loaded = await M.loadStore();
    expect(loaded.facts[0]?.text).toBe('round trip fact');
  });

  it('loadStore migrates a legacy MEMORY.md in memory; first save backs it up to MEMORY.md.bak', async () => {
    await mkdir(M.MEMORY_DIR, { recursive: true });
    await writeFile(M.AUTO_MEMORY_FILE, '# Sanook Auto-Memory\n- legacy vercel deploy fact\n');
    const loaded = await M.loadStore();
    expect(M.activeFacts(loaded).some((f) => f.text.includes('vercel'))).toBe(true);
    await M.saveStore(loaded);
    expect((await stat(join(M.MEMORY_DIR, 'MEMORY.md.bak'))).isFile()).toBe(true);
  });

  it('loadStore on malformed json degrades to empty (never throws into the agent)', async () => {
    await mkdir(M.MEMORY_DIR, { recursive: true });
    await writeFile(M.MEMORY_JSON, '{ not valid json');
    const loaded = await M.loadStore();
    expect(loaded.version).toBe(2);
    expect(loaded.facts).toHaveLength(0);
  });

  it('saveStore is a no-op when persistence is disabled', async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
    try {
      await M.saveStore(M.mergeFact(M.emptyStore(), { text: 'should not persist' }, NOW).store);
      await expect(stat(M.MEMORY_JSON)).rejects.toThrow();
    } finally {
      vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
    }
  });
});

describe('FS: appendMemory (memory.ts) ↔ store', () => {
  beforeEach(async () => {
    await rm(M.MEMORY_DIR, { recursive: true, force: true });
  });

  it('appendMemory persists through the store and redacts secrets on disk', async () => {
    const { appendMemory } = await import('./memory.js');
    await appendMemory('the token is sk-abcdefghijklmnopqrstuvwxyz123456 keep it');
    const raw = await readFile(M.MEMORY_JSON, 'utf8');
    expect(raw).not.toMatch(/sk-abcdefghijklmnop/);
    expect(M.activeFacts(await M.loadStore())).toHaveLength(1);
  });

  it('appendMemory twice with the same fact stays one logical fact', async () => {
    const { appendMemory } = await import('./memory.js');
    await appendMemory('Pick likes tea');
    await appendMemory('Pick likes tea');
    expect(M.activeFacts(await M.loadStore())).toHaveLength(1);
  });
});
