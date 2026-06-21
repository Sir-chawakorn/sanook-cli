import { describe, it, expect } from 'vitest';
import { dashboardInstall } from './api-helpers.js';
import { shellStatus } from './terminal.js';
import { installScriptUrl } from '../install-info.js';

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
});

describe('installScriptUrl', () => {
  it('points install scripts at GitHub raw by default', () => {
    expect(installScriptUrl('install.sh')).toContain('raw.githubusercontent.com/Sir-chawakorn/sanook-cli');
    expect(installScriptUrl('install.ps1', true)).toContain('sanook.ai/install.ps1');
  });
});

describe('shellStatus', () => {
  it('reports availability based on optional deps (node-pty/ws)', async () => {
    const status = await shellStatus();
    expect(typeof status.available).toBe('boolean');
    if (!status.available) expect(status.reason).toMatch(/node-pty|ws/);
  });
});
