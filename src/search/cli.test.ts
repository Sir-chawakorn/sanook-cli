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

  it('accepts inline values for search options', () => {
    expect(parseSearchArgs(['race', 'condition', '--mode=hybrid', '--limit=5', '--sources=vault,memory'])).toEqual({
      ok: true,
      value: { query: 'race condition', mode: 'hybrid', limit: 5, sources: ['vault', 'memory'] },
    });
  });

  it('rejects empty inline search option values', () => {
    expect(parseSearchArgs(['deploy', '--mode=']).ok).toBe(false);
    expect(parseSearchArgs(['deploy', '--limit=']).ok).toBe(false);
    expect(parseSearchArgs(['deploy', '--source=']).ok).toBe(false);
    expect(parseSearchArgs(['deploy', '--sources=']).ok).toBe(false);
  });

  it('rejects missing split option values without consuming the next flag', () => {
    const mode = parseSearchArgs(['deploy', '--mode', '--limit', '5']);
    const limit = parseSearchArgs(['deploy', '--limit', '--source', 'vault']);
    const source = parseSearchArgs(['deploy', '--source', '--mode', 'fts']);

    expect(mode.ok).toBe(false);
    if (!mode.ok) expect(mode.message).toContain('--mode ต้องระบุค่า');
    expect(limit.ok).toBe(false);
    if (!limit.ok) expect(limit.message).toContain('--limit ต้องระบุค่า');
    expect(source.ok).toBe(false);
    if (!source.ok) expect(source.message).toContain('--source ต้องระบุค่า');
  });

  it('treats arguments after -- as literal query text', () => {
    expect(parseSearchArgs(['--', '--mode', 'hybrid'])).toEqual({
      ok: true,
      value: { query: '--mode hybrid', mode: 'auto', limit: 8, sources: undefined },
    });
    expect(parseSearchArgs(['--mode', 'fts', '--limit', '3', '--', '--source', 'vault'])).toEqual({
      ok: true,
      value: { query: '--source vault', mode: 'fts', limit: 3, sources: undefined },
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
    expect(parseSearchArgs(['deploy', '--limit', '0x10']).ok).toBe(false);
    expect(parseSearchArgs(['deploy', '--limit', '1e2']).ok).toBe(false);
    expect(parseSearchArgs(['deploy', '--limit', '9007199254740992']).ok).toBe(false);
  });

  it('rejects duplicate scalar options instead of silently overwriting them', () => {
    const mode = parseSearchArgs(['deploy', '--mode', 'fts', '--mode=hybrid']);
    const limit = parseSearchArgs(['deploy', '--limit', '3', '--limit=9']);

    expect(mode.ok).toBe(false);
    if (!mode.ok) expect(mode.message).toContain('--mode');
    expect(limit.ok).toBe(false);
    if (!limit.ok) expect(limit.message).toContain('--limit');
  });

  it('rejects invalid sources and empty queries', () => {
    expect(parseSearchArgs(['deploy', '--source', 'vault,nope']).ok).toBe(false);
    expect(parseSearchArgs(['--mode', 'fts']).ok).toBe(false);
  });
});
