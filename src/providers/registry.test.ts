import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveEmbedder } from './registry.js';

const EMBED_ENV = [
  'OPENAI_API_KEY',
  'MISTRAL_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
] as const;

function clearEmbedEnv(): void {
  for (const key of EMBED_ENV) vi.stubEnv(key, '');
}

describe('resolveEmbedder', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('auto-detect returns null when no embedding provider key is present', () => {
    clearEmbedEnv();
    expect(resolveEmbedder()).toBeNull();
  });

  it('uses provider defaults when the explicit spec omits a model id', () => {
    clearEmbedEnv();
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key');

    expect(resolveEmbedder('openai:')?.tag).toBe('openai:text-embedding-3-small');
  });

  it('rejects OAuth/subscription-style embedding credentials by degrading to null', () => {
    clearEmbedEnv();
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'ya29.oauth-token');

    expect(resolveEmbedder('google')).toBeNull();
  });
});
