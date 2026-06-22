import { describe, expect, it } from 'vitest';
import { parseUsageArgs } from './usage-cli.js';

describe('usage cli args', () => {
  it('defaults to daily with date window', () => {
    const parsed = parseUsageArgs([]);
    expect(parsed?.mode).toBe('daily');
    expect(parsed?.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed?.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts weekly/monthly/session modes and json flag', () => {
    expect(parseUsageArgs(['session', '--json'])?.mode).toBe('session');
    expect(parseUsageArgs(['weekly', '--days', '7'])?.days).toBe(7);
    expect(parseUsageArgs(['weekly', '--days=8'])?.days).toBe(8);
    expect(parseUsageArgs(['monthly', '--since', '2026-06-01', '--until', '2026-06-30'])?.since).toBe('2026-06-01');
  });

  it('rejects extra positional report modes or values', () => {
    expect(parseUsageArgs(['daily', 'weekly'])).toBeNull();
    expect(parseUsageArgs(['weekly', 'extra', '--days', '7'])).toBeNull();
  });

  it('rejects duplicate scalar range options', () => {
    expect(parseUsageArgs(['--since', '2026-06-01', '--since=2026-06-02'])).toBeNull();
    expect(parseUsageArgs(['--until', '2026-06-30', '--until=2026-07-01'])).toBeNull();
    expect(parseUsageArgs(['--days', '7', '--days=14'])).toBeNull();
  });

  it('rejects impossible calendar dates', () => {
    expect(parseUsageArgs(['--since', '2026-02-29'])).toBeNull();
    expect(parseUsageArgs(['--since=2024-02-29'])?.since).toBe('2024-02-29');
    expect(parseUsageArgs(['--until', '2026-13-01'])).toBeNull();
    expect(parseUsageArgs(['--until=2026-04-31'])).toBeNull();
  });

  it('rejects explicit ranges where since is after until', () => {
    expect(parseUsageArgs(['--since', '2026-06-30', '--until', '2026-06-01'])).toBeNull();
    expect(parseUsageArgs(['--since=2026-06-01', '--until=2026-06-01'])?.since).toBe('2026-06-01');
  });

  it('anchors the default day window to an explicit until date', () => {
    expect(parseUsageArgs(['--until', '2026-06-15'])?.since).toBe('2026-05-17');
    expect(parseUsageArgs(['--until=2024-03-01', '--days=2'])?.since).toBe('2024-02-29');
  });

  it('rejects non-decimal or missing day counts without consuming following flags', () => {
    expect(parseUsageArgs(['--days', '--json'])).toBeNull();
    expect(parseUsageArgs(['--days='])).toBeNull();
    expect(parseUsageArgs(['--days', '0'])).toBeNull();
    expect(parseUsageArgs(['--days', '-1'])).toBeNull();
    expect(parseUsageArgs(['--days=1e2'])).toBeNull();
    expect(parseUsageArgs(['--days=0x10'])).toBeNull();
    expect(parseUsageArgs(['--days=1.5'])).toBeNull();
    expect(parseUsageArgs(['--days=9007199254740992'])).toBeNull();
  });
});
