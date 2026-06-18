import { describe, expect, it } from 'vitest';
import { evalModelFromEnv } from './run.js';

describe('evalModelFromEnv', () => {
  it('trims SANOOK_MODEL for eval runs', () => {
    expect(evalModelFromEnv({ SANOOK_MODEL: '  haiku  ' })).toBe('haiku');
  });

  it('falls back when SANOOK_MODEL is blank or missing', () => {
    expect(evalModelFromEnv({ SANOOK_MODEL: '   ' })).toBe('sonnet');
    expect(evalModelFromEnv({})).toBe('sonnet');
  });
});
