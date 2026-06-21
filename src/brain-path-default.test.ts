import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import { defaultBrainPath } from './brand.js';
import { getBrainPath } from './memory.js';
import { loadConfig } from './config.js';

// brainPath resolution must ALWAYS land on the Second Brain vault when the user hasn't configured one:
//  - config.brainPath set        → that path wins
//  - unset + default dir exists   → ~/Documents/Second Brain (auto-link, no manual config, cross-platform)
//  - unset + default dir missing  → undefined (brain simply not set up yet)
// HOME is stubbed to a throwaway dir so we never touch the real vault.
let tmpHome: string;

async function writeConfig(obj: Record<string, unknown>): Promise<void> {
  await mkdir(join(tmpHome, '.sanook'), { recursive: true });
  await writeFile(join(tmpHome, '.sanook', 'config.json'), JSON.stringify(obj), 'utf8');
}
async function makeDefaultVault(): Promise<string> {
  const p = join(tmpHome, 'Documents', 'Second Brain');
  await mkdir(p, { recursive: true });
  return p;
}
async function makeDefaultVaultFile(): Promise<string> {
  const p = join(tmpHome, 'Documents', 'Second Brain');
  await mkdir(join(tmpHome, 'Documents'), { recursive: true });
  await writeFile(p, 'not a directory', 'utf8');
  return p;
}

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), 'sanook-brainpath-'));
  vi.stubEnv('HOME', tmpHome);
  vi.stubEnv('USERPROFILE', tmpHome); // Windows homedir() source
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpHome, { recursive: true, force: true }).catch(() => {});
});

describe('defaultBrainPath', () => {
  it('is homedir()/Documents/Second Brain (cross-platform via homedir)', () => {
    expect(defaultBrainPath()).toBe(join(homedir(), 'Documents', 'Second Brain'));
    expect(defaultBrainPath()).toBe(join(tmpHome, 'Documents', 'Second Brain'));
  });
});

describe('getBrainPath fallback', () => {
  it('returns the configured brainPath when set (wins over default)', async () => {
    const custom = join(tmpHome, 'custom-vault');
    await mkdir(custom, { recursive: true });
    await makeDefaultVault(); // exists too, but config must win
    await writeConfig({ brainPath: custom });
    expect(await getBrainPath()).toBe(custom);
  });

  it('falls back to the default Second Brain vault when unset and the folder exists', async () => {
    const def = await makeDefaultVault();
    await writeConfig({ model: 'sonnet' }); // config exists but no brainPath
    expect(await getBrainPath()).toBe(def);
  });

  it('falls back even when there is no config file at all', async () => {
    const def = await makeDefaultVault();
    expect(await getBrainPath()).toBe(def);
  });

  it('returns undefined when unset and the default folder does not exist', async () => {
    await writeConfig({ model: 'sonnet' });
    expect(await getBrainPath()).toBeUndefined();
  });

  it('returns undefined when the default path exists but is not a directory', async () => {
    await makeDefaultVaultFile();
    await writeConfig({ model: 'sonnet' });
    expect(await getBrainPath()).toBeUndefined();
  });

  it('treats a blank/whitespace brainPath as unset and falls back', async () => {
    const def = await makeDefaultVault();
    await writeConfig({ brainPath: '   ' });
    expect(await getBrainPath()).toBe(def);
  });
});

describe('loadConfig brainPath fallback', () => {
  it('keeps the configured brainPath when the default vault also exists', async () => {
    const custom = join(tmpHome, 'custom-vault');
    await mkdir(custom, { recursive: true });
    await makeDefaultVault();
    await writeConfig({ brainPath: custom });
    const cfg = await loadConfig({}, tmpHome);
    expect(cfg.brainPath).toBe(custom);
  });

  it('populates config.brainPath from the default vault when unset and present', async () => {
    const def = await makeDefaultVault();
    await writeConfig({ model: 'sonnet' });
    const cfg = await loadConfig({}, tmpHome);
    expect(cfg.brainPath).toBe(def);
  });

  it('leaves brainPath undefined when the default vault does not exist', async () => {
    await writeConfig({ model: 'sonnet' });
    const cfg = await loadConfig({}, tmpHome);
    expect(cfg.brainPath).toBeUndefined();
  });

  it('leaves brainPath undefined when the default path is a file', async () => {
    await makeDefaultVaultFile();
    await writeConfig({ model: 'sonnet' });
    const cfg = await loadConfig({}, tmpHome);
    expect(cfg.brainPath).toBeUndefined();
  });

  it('does not persist the virtual fallback to disk', async () => {
    await makeDefaultVault();
    await writeConfig({ model: 'sonnet' });
    await loadConfig({}, tmpHome);
    const raw = JSON.parse(
      await (await import('node:fs/promises')).readFile(join(tmpHome, '.sanook', 'config.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(raw.brainPath).toBeUndefined();
  });
});
