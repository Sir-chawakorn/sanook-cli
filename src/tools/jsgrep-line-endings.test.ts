import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsGrep } from './search.js';

describe('jsGrep line ending handling', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports correct line numbers for bare carriage-return files', async () => {
    vi.stubEnv('SANOOK_ALLOW_OUTSIDE_WORKSPACE', '1');
    const dir = await mkdtemp(join(tmpdir(), 'jsgrep-cr-'));
    try {
      await writeFile(join(dir, 'classic-mac.ts'), 'line one\rneedleHere on two\rline three\r');

      const out = await jsGrep('needleHere', dir, 'classic-mac.ts');

      expect(out).toContain('classic-mac.ts:2:needleHere on two');
      expect(out).not.toContain('\r');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
