import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appHomePath } from './brand.js';
import { autoMaintainEnabled, isConsolidationDue, maybeStartupMaintain, autoDistillToMemory } from './auto-maintain.js';

const DAY = 24 * 60 * 60 * 1000;

describe('auto-maintain', () => {
  let home: string;
  let stateDir: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'am-home-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
    vi.stubEnv('SANOOK_DISABLE_AUTO_MAINTAIN', '');
    vi.stubEnv('SANOOK_AUTO_DISTILL', '');
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
    it('treats malformed, corrupt, or future state timestamps as due', async () => {
      const now = Date.now();
      await writeFile(appHomePath('auto-maintain.json'), '{not-json');
      expect(await isConsolidationDue(now)).toBe(true);
      await writeFile(appHomePath('auto-maintain.json'), JSON.stringify({ lastConsolidate: 'yesterday' }));
      expect(await isConsolidationDue(now)).toBe(true);
      await writeFile(appHomePath('auto-maintain.json'), '{"lastConsolidate":1e999}');
      expect(await isConsolidationDue(now)).toBe(true);
      await writeFile(appHomePath('auto-maintain.json'), JSON.stringify({ lastConsolidate: -DAY }));
      expect(await isConsolidationDue(now)).toBe(true);
      await writeFile(appHomePath('auto-maintain.json'), JSON.stringify({ lastConsolidate: now + 30 * DAY }));
      expect(await isConsolidationDue(now)).toBe(true);
    });
    it('not due when disabled, even if stale', async () => {
      vi.stubEnv('SANOOK_DISABLE_AUTO_MAINTAIN', '1');
      expect(await isConsolidationDue(Date.now())).toBe(false);
    });
  });

  describe('maybeStartupMaintain', () => {
    it('creates the state directory before claiming a startup consolidate run', async () => {
      const now = Date.now();
      await rm(stateDir, { recursive: true, force: true });
      const runBrainConsolidate = vi.fn().mockResolvedValue({
        ok: true,
        steps: [],
      });
      vi.doMock('./brain-consolidate.js', () => ({ runBrainConsolidate }));
      try {
        await expect(maybeStartupMaintain(now)).resolves.toBe(null);
        const state = JSON.parse(await readFile(appHomePath('auto-maintain.json'), 'utf8')) as { lastConsolidate?: unknown };
        expect(state.lastConsolidate).toBe(now);
      } finally {
        vi.doUnmock('./brain-consolidate.js');
      }
    });

    it('repairs invalid state when claiming a startup consolidate run', async () => {
      const now = Date.now();
      await writeFile(appHomePath('auto-maintain.json'), JSON.stringify({ lastConsolidate: now + 30 * DAY }));
      const runBrainConsolidate = vi.fn().mockResolvedValue({
        ok: true,
        steps: [{ applied: ['dedup'] }],
      });
      vi.doMock('./brain-consolidate.js', () => ({ runBrainConsolidate }));
      try {
        await expect(maybeStartupMaintain(now)).resolves.toBe('auto-maintain: จัดระเบียบ memory + vault (1 รายการ)');
        expect(runBrainConsolidate).toHaveBeenCalledWith(
          expect.objectContaining({
            apply: true,
            archive: true,
            memory: true,
            runRetrieval: false,
          }),
        );
        const state = JSON.parse(await readFile(appHomePath('auto-maintain.json'), 'utf8')) as { lastConsolidate?: unknown };
        expect(state.lastConsolidate).toBe(now);
      } finally {
        vi.doUnmock('./brain-consolidate.js');
      }
    });
  });

  describe('autoDistillToMemory', () => {
    it('returns 0 when disabled', async () => {
      vi.stubEnv('SANOOK_DISABLE_AUTO_MAINTAIN', '1');
      expect(await autoDistillToMemory([{ role: 'user', content: 'x' }])).toBe(0);
    });
    it('SANOOK_DISABLE_AUTO_MAINTAIN wins over SANOOK_AUTO_DISTILL', async () => {
      vi.stubEnv('SANOOK_DISABLE_AUTO_MAINTAIN', '1');
      vi.stubEnv('SANOOK_AUTO_DISTILL', '1');
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'user',
              content: 'We decided to keep the auto-maintain disable flag as a kill switch.',
            },
          ]),
        ).resolves.toBe(0);
        expect(appendMemory).not.toHaveBeenCalled();
      } finally {
        vi.doUnmock('./memory.js');
      }
    });
    it('SANOOK_AUTO_DISTILL does not override disabled persistence', async () => {
      vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
      vi.stubEnv('SANOOK_AUTO_DISTILL', '1');
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'user',
              content: 'We decided to keep local-first memory.',
            },
          ]),
        ).resolves.toBe(0);
        expect(appendMemory).not.toHaveBeenCalled();
      } finally {
        vi.doUnmock('./memory.js');
      }
    });
    it('SANOOK_AUTO_DISTILL forces distill even when autoMaintain config is off', async () => {
      await writeFile(appHomePath('config.json'), JSON.stringify({ autoMaintain: false }));
      vi.stubEnv('SANOOK_AUTO_DISTILL', '1');
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'user',
              content: 'We decided to keep local-first memory.',
            },
          ]),
        ).resolves.toBe(1);
        expect(appendMemory).toHaveBeenCalledWith('We decided to keep local-first memory.');
      } finally {
        vi.doUnmock('./memory.js');
      }
    });
    it('returns 0 for empty / non-array input', async () => {
      expect(await autoDistillToMemory([])).toBe(0);
      expect(await autoDistillToMemory(undefined)).toBe(0);
      expect(await autoDistillToMemory({ role: 'user', content: 'We decided to ignore non-array transcripts.' })).toBe(0);
    });
    it('ignores malformed message entries without dropping valid facts', async () => {
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      try {
        await expect(
          autoDistillToMemory([
            null,
            {
              role: 'assistant',
              content: 'We decided to tolerate malformed distill messages.',
            },
          ]),
        ).resolves.toBe(1);
        expect(appendMemory).toHaveBeenCalledWith('We decided to tolerate malformed distill messages.');
      } finally {
        vi.doUnmock('./memory.js');
      }
    });
    it('passes only user and assistant messages with content to the distiller', async () => {
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      const distilledFactsFromMessages = vi.fn().mockReturnValue(['We decided to persist only conversation facts.']);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      vi.doMock('./session-distill.js', () => ({ distilledFactsFromMessages }));
      const contentParts = [{ type: 'text', text: 'The convention is to keep local memory scoped to conversations.' }];
      try {
        await expect(
          autoDistillToMemory([
            null,
            'not a message',
            { role: 'system', content: 'We decided system prompts are not conversation memory.' },
            { role: 'developer', content: 'The convention is to keep tool rules out of user memory.' },
            {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolName: 'read_file',
                  output: { type: 'text', value: 'We decided tool outputs are not conversation facts.' },
                },
              ],
            },
            { role: 'user' },
            { role: 'assistant', content: '' },
            { role: 'user', content: [{ type: 'tool-call', toolName: 'read_file' }] },
            { content: 'missing role' },
            { role: 7, content: 'bad role' },
            { role: 'assistant', content: 'We decided to persist only conversation facts.' },
            { role: 'user', content: contentParts },
          ]),
        ).resolves.toBe(1);
        expect(distilledFactsFromMessages).toHaveBeenCalledWith([
          { role: 'assistant', content: 'We decided to persist only conversation facts.' },
          { role: 'user', content: contentParts },
        ]);
        expect(appendMemory).toHaveBeenCalledWith('We decided to persist only conversation facts.');
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
      }
    });
    it('skips distiller and memory imports when no messages are distillable', async () => {
      const memoryFactory = vi.fn(() => ({ appendMemory: vi.fn() }));
      const distillerFactory = vi.fn(() => ({ distilledFactsFromMessages: vi.fn() }));
      vi.doMock('./memory.js', memoryFactory);
      vi.doMock('./session-distill.js', distillerFactory);
      try {
        await expect(
          autoDistillToMemory([
            null,
            { role: 'system', content: 'We decided system prompts are not conversation memory.' },
            { role: 'developer', content: 'The convention is to keep tool rules out of user memory.' },
            {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolName: 'read_file',
                  output: { type: 'text', value: 'We decided tool outputs are not conversation facts.' },
                },
              ],
            },
            { role: 'assistant' },
            { role: 'assistant', content: '   ' },
            { role: 'user', content: [{ type: 'tool-call', toolName: 'read_file' }] },
            { content: 'missing role' },
          ]),
        ).resolves.toBe(0);
        expect(distillerFactory).not.toHaveBeenCalled();
        expect(memoryFactory).not.toHaveBeenCalled();
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
      }
    });
    it('counts only facts that append successfully', async () => {
      const appendMemory = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk full'));
      vi.doMock('./memory.js', () => ({ appendMemory }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'user',
              content: 'We decided to use SQLite for local cache. Never commit generated secrets.',
            },
          ]),
        ).resolves.toBe(1);
        expect(appendMemory).toHaveBeenCalledTimes(2);
      } finally {
        vi.doUnmock('./memory.js');
      }
    });
    it('caps auto-distilled facts written from one session', async () => {
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'user',
              content: Array.from({ length: 10 }, (_, i) => `We decided to keep durable fact ${i} in memory.`).join(' '),
            },
          ]),
        ).resolves.toBe(8);
        expect(appendMemory).toHaveBeenCalledTimes(8);
        expect(appendMemory).toHaveBeenLastCalledWith('We decided to keep durable fact 7 in memory.');
      } finally {
        vi.doUnmock('./memory.js');
      }
    });
  });
});
