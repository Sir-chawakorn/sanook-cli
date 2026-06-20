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
    expect(parseUsageArgs(['monthly', '--since', '2026-06-01', '--until', '2026-06-30'])?.since).toBe('2026-06-01');
  });
});
