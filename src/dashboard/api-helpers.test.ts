import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appHomePath } from '../brand.js';
import { dashboardInstall, dashboardListFiles, dashboardReadFile } from './api-helpers.js';
import { shellStatus } from './terminal.js';
import { installPkgVersion, installScriptUrl } from '../install-info.js';

describe('dashboardInstall', () => {
  it('returns the package name and npm as the ready/recommended method', () => {
    const { pkg, methods } = dashboardInstall();
    expect(pkg).toBe('sanook-cli');
    const npm = methods.find((m) => m.id === 'npm');
    expect(npm?.ready).toBe(true);
    expect(npm?.recommended).toBe(true);
    expect(npm?.commands.some((c) => c.cmd.includes('npm install -g sanook-cli'))).toBe(true);
  });

  it('lists curl and homebrew as ready with GitHub raw / tap commands', () => {
    const { methods } = dashboardInstall();
    const curl = methods.find((m) => m.id === 'curl');
    expect(curl?.ready).toBe(true);
    expect(curl?.commands.some((c) => c.cmd.includes('raw.githubusercontent.com'))).toBe(true);
    const brew = methods.find((m) => m.id === 'homebrew');
    expect(brew?.ready).toBe(true);
    expect(brew?.commands.some((c) => c.cmd.includes('brew tap'))).toBe(true);
  });

  it('lists winget as not-yet-ready', () => {
    const winget = dashboardInstall().methods.find((m) => m.id === 'winget');
    expect(winget?.ready).toBe(false);
  });

  it('keeps the winget release note aligned with package.json', () => {
    const winget = dashboardInstall().methods.find((m) => m.id === 'winget');

    expect(winget?.note).toContain(`v${installPkgVersion()}`);
    expect(winget?.note).not.toContain('v0.5.7');
  });
});

describe('installScriptUrl', () => {
  it('points install scripts at GitHub raw by default', () => {
    expect(installScriptUrl('install.sh')).toContain('raw.githubusercontent.com/Sir-chawakorn/sanook-cli');
    expect(installScriptUrl('install.ps1', true)).toContain('sanook.ai/install.ps1');
  });
});

describe('dashboard file API', () => {
  let home: string;
  let brain: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-dashboard-home-'));
    brain = join(home, 'Second Brain');
    vi.stubEnv('HOME', home);
    await mkdir(appHomePath(), { recursive: true });
    await writeFile(appHomePath('note.md'), '# allowed\n', 'utf8');
    await writeFile(appHomePath('config.json'), JSON.stringify({ brainPath: brain }, null, 2), 'utf8');
    await mkdir(appHomePath('etc'), { recursive: true });
    await mkdir(brain, { recursive: true });
    await writeFile(join(brain, 'vault-note.md'), '# vault\n', 'utf8');
    await mkdir(join(home, '.sanook-secrets'), { recursive: true });
    await writeFile(join(home, '.sanook-secrets', 'secret.md'), '# secret\n', 'utf8');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('reads files inside the app home root', async () => {
    await expect(dashboardListFiles()).resolves.toMatchObject({
      entries: expect.arrayContaining([{ name: 'note.md', dir: false }]),
    });
    await expect(dashboardReadFile(appHomePath('note.md'))).resolves.toMatchObject({
      content: '# allowed\n',
    });
  });

  it('lists and reads files inside the configured brain root by absolute path', async () => {
    await expect(dashboardListFiles(brain)).resolves.toMatchObject({
      entries: expect.arrayContaining([{ name: 'vault-note.md', dir: false }]),
    });
    await expect(dashboardReadFile(join(brain, 'vault-note.md'))).resolves.toMatchObject({
      content: '# vault\n',
    });
  });

  it('rejects sibling paths that only share the app-home name prefix', async () => {
    const siblingFile = join(home, '.sanook-secrets', 'secret.md');

    await expect(dashboardListFiles('../.sanook-secrets')).rejects.toThrow('path not allowed');
    await expect(dashboardReadFile(siblingFile)).rejects.toThrow('path not allowed');
  });

  it('rejects absolute list paths outside the allowed roots', async () => {
    await expect(dashboardListFiles('/etc')).rejects.toThrow('path not allowed');
  });
});

describe('shellStatus', () => {
  it('reports availability based on optional deps (node-pty/ws)', async () => {
    const status = await shellStatus();
    expect(typeof status.available).toBe('boolean');
    if (!status.available) expect(status.reason).toMatch(/node-pty|ws/);
  });
});
