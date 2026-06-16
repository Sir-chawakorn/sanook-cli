import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerCanSkipSetup } from './first-run.js';
import type { CodexStatus } from './providers/codex.js';

const codex = (status: CodexStatus) => async (): Promise<CodexStatus> => status;

describe('providerCanSkipSetup', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets local providers skip setup because they do not need API keys', async () => {
    expect(await providerCanSkipSetup('ollama')).toBe(true);
  });

  it('requires policy-valid API keys for cloud providers', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', `sk-ant-oat01-${'A'.repeat(24)}`);
    expect(await providerCanSkipSetup('anthropic')).toBe(false);

    vi.stubEnv('ANTHROPIC_API_KEY', `sk-ant-api03-${'A'.repeat(24)}`);
    expect(await providerCanSkipSetup('anthropic')).toBe(true);
  });

  it('does not skip setup for Codex until the official CLI is installed and logged in', async () => {
    expect(await providerCanSkipSetup('codex', codex({ installed: false, loggedIn: false }))).toBe(false);
    expect(await providerCanSkipSetup('codex', codex({ installed: true, loggedIn: false }))).toBe(false);
    expect(await providerCanSkipSetup('codex', codex({ installed: true, loggedIn: true }))).toBe(true);
  });
});
