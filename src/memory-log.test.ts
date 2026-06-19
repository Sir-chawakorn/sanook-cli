import { describe, expect, it } from 'vitest';
import { FactSchema, type MemoryStore } from './memory-store.js';
import { memoryLog, memoryStats, renderMemoryLog } from './memory-log.js';

const T = 1_700_000_000_000;
const fact = (over: { id: string; text: string } & Partial<Record<string, unknown>>) =>
  FactSchema.parse({ validFrom: T, created: T, updated: T, lastAccessed: T, ...over });

// a real evolution chain: "Vercel" decision superseded by "Netlify" decision
const store: MemoryStore = {
  version: 2,
  meta: { lastConsolidated: 0, activeAtLastConsolidate: 0, migratedFrom: null },
  facts: [
    fact({ id: 'm_old', text: 'We deploy the app with Vercel', noteType: 'decision', status: 'superseded', validFrom: T, invalidatedAt: T + 1000, supersededBy: 'm_new' }),
    fact({ id: 'm_new', text: 'We deploy the app with Netlify not Vercel', noteType: 'decision', status: 'active', validFrom: T + 1000, supersedes: ['m_old'] }),
    fact({ id: 'm_pref', text: 'Use tabs for indentation', noteType: 'preference', status: 'active' }),
    fact({ id: 'm_arch', text: 'Old caching note nobody reads', status: 'archived', invalidatedAt: T + 500 }),
  ],
};

describe('memoryLog', () => {
  it('surfaces matching facts across ALL statuses with evolution edges resolved', () => {
    const entries = memoryLog(store, 'deploy');
    const ids = entries.map((e) => e.fact.id);
    expect(ids).toContain('m_old'); // superseded fact is still queryable
    expect(ids).toContain('m_new');
    const active = entries.find((e) => e.fact.id === 'm_new')!;
    expect(active.supersedes.map((f) => f.id)).toEqual(['m_old']); // resolved
    const old = entries.find((e) => e.fact.id === 'm_old')!;
    expect(old.supersededBy?.id).toBe('m_new'); // resolved
  });

  it('with no query, highlights what CHANGED (superseded/archived), newest first', () => {
    const entries = memoryLog(store, '');
    const ids = entries.map((e) => e.fact.id);
    expect(ids).toEqual(['m_old', 'm_arch']); // only non-active, ordered by invalidatedAt desc
    expect(ids).not.toContain('m_pref'); // active-only facts excluded from the "changes" view
  });

  it('renders the evolution chain', () => {
    const out = renderMemoryLog(memoryLog(store, 'deploy'), 'deploy');
    expect(out).toContain('superseded by: We deploy the app with Netlify');
    expect(out).toContain('supersedes: We deploy the app with Vercel');
  });

  it('memoryStats partitions by status and tier', () => {
    const s = memoryStats(store);
    expect(s).toMatchObject({ total: 4, active: 2, superseded: 1, archived: 1 });
    expect(s.byTier.durable).toBeGreaterThan(0);
  });
});
