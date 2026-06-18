import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanEmbeddingModelSpec, embeddingModelSpec } from './embedding-config.js';

describe('cleanEmbeddingModelSpec', () => {
  it('trims model specs and treats blank values as unset', () => {
    expect(cleanEmbeddingModelSpec('  openai:text-embedding-3-small  ')).toBe('openai:text-embedding-3-small');
    expect(cleanEmbeddingModelSpec('   ')).toBeUndefined();
    expect(cleanEmbeddingModelSpec(undefined)).toBeUndefined();
  });
});

describe('embeddingModelSpec', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-embedding-config-'));
    vi.stubEnv('HOME', home);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  async function writeConfig(embeddingModel: string): Promise<void> {
    const dir = join(home, '.sanook');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'config.json'), `${JSON.stringify({ embeddingModel })}\n`);
  }

  it('uses override, env, then config after trimming each layer', async () => {
    await writeConfig('  google:text-embedding-004  ');

    vi.stubEnv('SANOOK_EMBEDDING_MODEL', '  mistral:mistral-embed  ');
    expect(await embeddingModelSpec('  openai:text-embedding-3-small  ')).toBe('openai:text-embedding-3-small');

    expect(await embeddingModelSpec('   ')).toBe('mistral:mistral-embed');

    vi.stubEnv('SANOOK_EMBEDDING_MODEL', '   ');
    expect(await embeddingModelSpec()).toBe('google:text-embedding-004');
  });

  it('returns undefined when all layers are missing or blank', async () => {
    await writeConfig('   ');
    vi.stubEnv('SANOOK_EMBEDDING_MODEL', '   ');

    expect(await embeddingModelSpec('   ')).toBeUndefined();
  });
});
