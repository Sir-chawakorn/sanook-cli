import { describe, expect, it } from 'vitest';
import { scoreContextPack, selectContextPack, type ContextPackEntry } from './context-pack.js';

function pack(
  slug: 'second-brain-maintenance' | 'coding-release' | 'research-to-framework',
  signalTerms: string[],
): ContextPackEntry {
  return {
    slug,
    relPath: `Shared/Context-Packs/${slug}.md`,
    title: slug,
    description: slug,
    signalTerms,
  };
}

describe('selectContextPack', () => {
  const packs = [
    pack('second-brain-maintenance', ['vault', 'routing', 'memory', 'runbook', 'structure']),
    pack('coding-release', ['code', 'test', 'build', 'release', 'cli', 'implement']),
    pack('research-to-framework', ['research', 'experiment', 'framework', 'benchmark', 'hypothesis']),
  ];

  it('picks coding-release for CLI/test tasks', () => {
    const selected = selectContextPack('fix failing unit test in sanook cli release build', packs);
    expect(selected?.pack.slug).toBe('coding-release');
    expect(selected!.score).toBeGreaterThan(0.35);
  });

  it('picks second-brain-maintenance for vault routing tasks', () => {
    const selected = selectContextPack('update vault routing rules and memory inbox policy', packs);
    expect(selected?.pack.slug).toBe('second-brain-maintenance');
  });

  it('returns null for unrelated short prompts', () => {
    expect(selectContextPack('hello there', packs)).toBeNull();
  });
});

describe('scoreContextPack', () => {
  it('scores overlap deterministically', () => {
    const p = pack('coding-release', ['code', 'test', 'build', 'release', 'cli']);
    const { score, matchedTerms } = scoreContextPack('implement cli test release', p);
    expect(score).toBeGreaterThan(0);
    expect(matchedTerms).toContain('cli');
  });
});
