import { afterEach, describe, expect, it, vi } from 'vitest';
import { envFlag } from './brand.js';

describe('envFlag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts common truthy values case-insensitively', () => {
    vi.stubEnv('SANOOK_TEST_FLAG', 'YES');

    expect(envFlag('SANOOK_TEST_FLAG')).toBe(true);
  });

  it('trims surrounding whitespace before parsing truthy values', () => {
    vi.stubEnv('SANOOK_TEST_FLAG', ' true ');

    expect(envFlag('SANOOK_TEST_FLAG')).toBe(true);
  });

  it('treats missing, blank, and non-truthy values as false', () => {
    expect(envFlag('SANOOK_TEST_FLAG')).toBe(false);

    vi.stubEnv('SANOOK_TEST_FLAG', '   ');
    expect(envFlag('SANOOK_TEST_FLAG')).toBe(false);

    vi.stubEnv('SANOOK_TEST_FLAG', '0');
    expect(envFlag('SANOOK_TEST_FLAG')).toBe(false);
  });
});
