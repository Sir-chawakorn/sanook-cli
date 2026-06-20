import { describe, it, expect } from 'vitest';
import { dashboardInstall } from './api-helpers.js';
import { shellStatus } from './terminal.js';

describe('dashboardInstall', () => {
  it('returns the package name and npm as the ready/recommended method', () => {
    const { pkg, methods } = dashboardInstall();
    expect(pkg).toBe('sanook-cli');
    const npm = methods.find((m) => m.id === 'npm');
    expect(npm?.ready).toBe(true);
    expect(npm?.recommended).toBe(true);
    expect(npm?.commands.some((c) => c.cmd.includes('npm install -g sanook-cli'))).toBe(true);
  });

  it('lists curl / homebrew / winget as not-yet-ready with infra notes', () => {
    const { methods } = dashboardInstall();
    for (const id of ['curl', 'homebrew', 'winget']) {
      const m = methods.find((x) => x.id === id);
      expect(m, id).toBeTruthy();
      expect(m?.ready).toBe(false);
      expect(m?.note).toBeTruthy();
    }
  });
});

describe('shellStatus', () => {
  it('reports availability based on optional deps (node-pty/ws)', async () => {
    const status = await shellStatus();
    expect(typeof status.available).toBe('boolean');
    // node-pty is an optional dep not installed in CI → expect a helpful reason when unavailable
    if (!status.available) expect(status.reason).toMatch(/node-pty|ws/);
  });
});
