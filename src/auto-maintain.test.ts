import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appHomePath } from './brand.js';
import { autoMaintainEnabled, isConsolidationDue, autoDistillToMemory } from './auto-maintain.js';

const DAY = 24 * 60 * 60 * 1000;

describe('auto-maintain', () => {
  let home: string;
  let stateDir: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'am-home-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
    vi.stubEnv('SANOOK_DISABLE_AUTO_MAINTAIN', '');
    stateDir = appHomePath(); // homedir()/.sanook with HOME stubbed → temp
    await mkdir(stateDir, { recursive: true });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  describe('autoMaintainEnabled', () => {
    it('on by default (persistence on, no disable flag, no config)', async () => {
      expect(await autoMaintainEnabled()).toBe(true);
    });
    it('off via SANOOK_DISABLE_AUTO_MAINTAIN', async () => {
      vi.stubEnv('SANOOK_DISABLE_AUTO_MAINTAIN', '1');
      expect(await autoMaintainEnabled()).toBe(false);
    });
    it('off when persistence is disabled', async () => {
      vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
      expect(await autoMaintainEnabled()).toBe(false);
    });
    it('off via config autoMaintain=false', async () => {
      await writeFile(appHomePath('config.json'), JSON.stringify({ autoMaintain: false }));
      expect(await autoMaintainEnabled()).toBe(false);
    });
    it('on via config autoMaintain=true', async () => {
      await writeFile(appHomePath('config.json'), JSON.stringify({ autoMaintain: true }));
      expect(await autoMaintainEnabled()).toBe(true);
    });
  });

  describe('isConsolidationDue', () => {
    it('due when there is no prior run (fresh state)', async () => {
      expect(await isConsolidationDue(Date.now())).toBe(true);
    });
    it('not due right after a recent consolidate; due again after a week', async () => {
      const now = Date.now();
      await writeFile(appHomePath('auto-maintain.json'), JSON.stringify({ lastConsolidate: now - DAY }));
      expect(await isConsolidationDue(now)).toBe(false);
      await writeFile(appHomePath('auto-maintain.json'), JSON.stringify({ lastConsolidate: now - 8 * DAY }));
      expect(await isConsolidationDue(now)).toBe(true);
    });
    it('not due when disabled, even if stale', async () => {
      vi.stubEnv('SANOOK_DISABLE_AUTO_MAINTAIN', '1');
      expect(await isConsolidationDue(Date.now())).toBe(false);
    });
  });

  describe('autoDistillToMemory', () => {
    it('returns 0 when disabled', async () => {
      vi.stubEnv('SANOOK_DISABLE_AUTO_MAINTAIN', '1');
      expect(await autoDistillToMemory([{ role: 'user', content: 'x' }])).toBe(0);
    });
    it('returns 0 for empty / non-array input', async () => {
      expect(await autoDistillToMemory([])).toBe(0);
      expect(await autoDistillToMemory(undefined as never)).toBe(0);
    });
  });
});
