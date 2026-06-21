import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envFlag, pathIsDir } from './brand.js';

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

describe('pathIsDir', () => {
  it('returns true only for existing directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sanook-pathisdir-'));
    try {
      const nested = join(dir, 'nested');
      const file = join(dir, 'file.txt');
      await mkdir(nested);
      await writeFile(file, 'not a directory', 'utf8');

      await expect(pathIsDir(nested)).resolves.toBe(true);
      await expect(pathIsDir(file)).resolves.toBe(false);
      await expect(pathIsDir(join(dir, 'missing'))).resolves.toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
