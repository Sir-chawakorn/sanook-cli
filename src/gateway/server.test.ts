import { describe, expect, it } from 'vitest';
import { optionalString, parseOptionalSchedule } from './server.js';

describe('gateway server input normalization', () => {
  it('trims optional strings and drops blanks', () => {
    expect(optionalString('  openai:gpt-5.5  ')).toBe('openai:gpt-5.5');
    expect(optionalString('   ')).toBeUndefined();
    expect(optionalString(undefined)).toBeUndefined();
    expect(optionalString(123)).toBeUndefined();
  });

  it('treats blank schedule strings as absent but rejects invalid nonblank schedules', () => {
    const now = Date.UTC(2026, 5, 14, 12, 0, 0);

    expect(parseOptionalSchedule('   ', now)).toEqual({ schedule: null });
    expect(parseOptionalSchedule(undefined, now)).toEqual({ schedule: null });
    expect(parseOptionalSchedule('not a schedule', now)).toEqual({
      schedule: null,
      invalid: 'not a schedule',
    });
    expect(parseOptionalSchedule(' every 5m ', now).schedule?.normalized).toBe('every 5m');
  });
});
