import { describe, expect, it } from 'vitest';
import { parseSearchArgs } from './cli.js';

describe('parseSearchArgs', () => {
  it('parses query, mode, limit, and comma-separated sources', () => {
    expect(parseSearchArgs(['race', 'condition', '--mode', 'hybrid', '--limit', '5', '--source', 'vault,memory'])).toEqual({
      ok: true,
      value: { query: 'race condition', mode: 'hybrid', limit: 5, sources: ['vault', 'memory'] },
    });
  });

  it('deduplicates source filters', () => {
    expect(parseSearchArgs(['deploy', '--source', 'vault,vault,session'])).toEqual({
      ok: true,
      value: { query: 'deploy', mode: 'auto', limit: 8, sources: ['vault', 'session'] },
    });
  });

  it('rejects invalid mode instead of silently falling back to fts', () => {
    const res = parseSearchArgs(['deploy', '--mode', 'nope']);
    if (res.ok) throw new Error('expected invalid mode to fail');
    expect(res.message).toContain('--mode');
  });

  it('rejects non-positive limits', () => {
    expect(parseSearchArgs(['deploy', '--limit', '-5']).ok).toBe(false);
    expect(parseSearchArgs(['deploy', '--limit', '0']).ok).toBe(false);
  });

  it('rejects malformed limits instead of truncating them', () => {
    expect(parseSearchArgs(['deploy', '--limit', '5abc']).ok).toBe(false);
    expect(parseSearchArgs(['deploy', '--limit', '1.5']).ok).toBe(false);
  });

  it('rejects invalid sources and empty queries', () => {
    expect(parseSearchArgs(['deploy', '--source', 'vault,nope']).ok).toBe(false);
    expect(parseSearchArgs(['--mode', 'fts']).ok).toBe(false);
  });
});
