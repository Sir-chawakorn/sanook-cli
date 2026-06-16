import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('auth config store', () => {
  let home: string;
  let realHome: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    realHome = process.env.HOME;
    home = await mkdtemp(join(tmpdir(), 'sanook-auth-'));
    process.env.HOME = home;
  });

  afterEach(async () => {
    vi.resetModules();
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await rm(home, { recursive: true, force: true });
  });

  it('saves, reads, removes, and clears stored keys', async () => {
    const { authConfigPath, clearStoredAuth, readStoredAuthRaw, removeStoredKey, saveKey } = await import('./config.js');

    expect(authConfigPath()).toBe(join(home, '.sanook', 'auth.json'));
    await saveKey('OPENAI_API_KEY', 'sk-test123456');
    expect(await readStoredAuthRaw()).toEqual({ OPENAI_API_KEY: 'sk-test123456' });
    expect(process.env.OPENAI_API_KEY).toBe('sk-test123456');

    expect(await removeStoredKey('OPENAI_API_KEY')).toBe(true);
    expect(await readStoredAuthRaw()).toEqual({});
    expect(process.env.OPENAI_API_KEY).toBeUndefined();

    await saveKey('OPENAI_API_KEY', 'sk-test123456');
    await saveKey('ANTHROPIC_API_KEY', 'sk-ant-api03-test');
    await clearStoredAuth();
    expect(await readStoredAuthRaw()).toEqual({});
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('loads stored keys into env without overriding user-provided env', async () => {
    await mkdir(join(home, '.sanook'), { recursive: true });
    await writeFile(join(home, '.sanook', 'auth.json'), '{"OPENAI_API_KEY":"stored-key"}\n');
    process.env.OPENAI_API_KEY = 'env-key';

    const { loadKeysIntoEnv } = await import('./config.js');
    await loadKeysIntoEnv();
    expect(process.env.OPENAI_API_KEY).toBe('env-key');
  });
});
