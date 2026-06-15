import { describe, expect, it } from 'vitest';
import { emptyStore, mergeFact, migrateFromFlat, tokens } from './memory-store.js';

describe('memory-store merge semantics', () => {
  it('ADD แล้ว exact duplicate เป็น NOOP แต่ touch access metadata', () => {
    const t0 = Date.parse('2026-06-15T00:00:00Z');
    const t1 = t0 + 1000;
    const added = mergeFact(emptyStore(), { text: 'Use pnpm for this project', noteType: 'convention' }, t0);

    expect(added.op).toBe('ADD');
    expect(added.store.facts).toHaveLength(1);

    const dup = mergeFact(added.store, { text: 'Use pnpm for this project', noteType: 'convention' }, t1);
    expect(dup.op).toBe('NOOP');
    expect(dup.store.facts).toHaveLength(1);
    expect(dup.store.facts[0].accessCount).toBe(1);
    expect(dup.store.facts[0].lastAccessed).toBe(t1);
  });

  it('rejects punctuation-only facts before they can collide on an empty normalized id', () => {
    const res = mergeFact(emptyStore(), { text: '!!! ... ???' }, Date.parse('2026-06-15T00:00:00Z'));

    expect(res.op).toBe('NOOP');
    expect(res.fact).toBeNull();
    expect(res.store.facts).toHaveLength(0);
  });

  it('tokenizes Thai text without spaces so negation can be detected', () => {
    const ts = tokens('ไม่ชอบกาแฟ');

    expect(ts.has('ไม่')).toBe(true);
    expect(ts.has('ชอบ')).toBe(true);
    expect(ts.has('กาแฟ')).toBe(true);
  });

  it('protected fact blocks contradictory incoming preference', () => {
    const t0 = Date.parse('2026-06-15T00:00:00Z');
    const protectedStore = mergeFact(
      emptyStore(),
      { text: 'Always use concise Thai responses', noteType: 'preference', tier: 'protected', trust: 'owner' },
      t0,
    ).store;

    const res = mergeFact(
      protectedStore,
      { text: 'Do not use concise Thai responses', noteType: 'preference', trust: 'agent' },
      t0 + 1000,
    );

    expect(res.op).toBe('PROTECTED_HALT');
    expect(res.store.facts).toHaveLength(1);
    expect(res.flag).toContain('protected fact');
  });

  it('migrateFromFlat redacts and deduplicates legacy MEMORY.md facts', () => {
    const t0 = Date.parse('2026-06-15T00:00:00Z');
    const store = migrateFromFlat(
      [
        '# Sanook Auto-Memory',
        '- User prefers dark mode',
        '- User prefers dark mode',
        '- secret sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
      ].join('\n'),
      t0,
    );

    expect(store.meta.migratedFrom).toBe('v1-flat');
    expect(store.facts).toHaveLength(2);
    expect(store.facts.map((f) => f.text).join('\n')).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(store.facts.every((f) => f.created === t0)).toBe(true);
  });
});
