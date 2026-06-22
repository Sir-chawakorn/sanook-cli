import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, readdir, stat, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appHomePath } from './brand.js';
import { autoMaintainEnabled, isConsolidationDue, maybeStartupMaintain, autoDistillToMemory } from './auto-maintain.js';

const DAY = 24 * 60 * 60 * 1000;

async function stateTempFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.startsWith('auto-maintain.json.') && name.endsWith('.tmp'));
}

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
    it('keeps the state file private when checking a recent existing state', async () => {
      const now = Date.now();
      const statePath = appHomePath('auto-maintain.json');
      await chmod(stateDir, 0o755);
      await writeFile(statePath, JSON.stringify({ lastConsolidate: now - DAY }), { mode: 0o644 });
      await chmod(statePath, 0o644);
      expect(await isConsolidationDue(now)).toBe(false);
      expect((await stat(stateDir)).mode & 0o777).toBe(0o700);
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
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
    it('honors the disable flag before claiming state or importing consolidation', async () => {
      vi.stubEnv('SANOOK_DISABLE_AUTO_MAINTAIN', '1');
      const runBrainConsolidate = vi.fn().mockResolvedValue({
        ok: true,
        steps: [{ applied: ['dedup'] }],
      });
      const brainConsolidateFactory = vi.fn(() => ({ runBrainConsolidate }));
      vi.doMock('./brain-consolidate.js', brainConsolidateFactory);
      try {
        await expect(maybeStartupMaintain(Date.now())).resolves.toBe(null);
        expect(brainConsolidateFactory).not.toHaveBeenCalled();
        expect(runBrainConsolidate).not.toHaveBeenCalled();
        await expect(readFile(appHomePath('auto-maintain.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        vi.doUnmock('./brain-consolidate.js');
      }
    });

    it('honors disabled persistence before claiming state or importing consolidation', async () => {
      vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
      const runBrainConsolidate = vi.fn().mockResolvedValue({
        ok: true,
        steps: [{ applied: ['dedup'] }],
      });
      const brainConsolidateFactory = vi.fn(() => ({ runBrainConsolidate }));
      vi.doMock('./brain-consolidate.js', brainConsolidateFactory);
      try {
        await expect(maybeStartupMaintain(Date.now())).resolves.toBe(null);
        expect(brainConsolidateFactory).not.toHaveBeenCalled();
        expect(runBrainConsolidate).not.toHaveBeenCalled();
        await expect(readFile(appHomePath('auto-maintain.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        vi.doUnmock('./brain-consolidate.js');
      }
    });

    it('honors config autoMaintain=false before claiming state or importing consolidation', async () => {
      await writeFile(appHomePath('config.json'), JSON.stringify({ autoMaintain: false }));
      const runBrainConsolidate = vi.fn().mockResolvedValue({
        ok: true,
        steps: [{ applied: ['dedup'] }],
      });
      const brainConsolidateFactory = vi.fn(() => ({ runBrainConsolidate }));
      vi.doMock('./brain-consolidate.js', brainConsolidateFactory);
      try {
        await expect(maybeStartupMaintain(Date.now())).resolves.toBe(null);
        expect(brainConsolidateFactory).not.toHaveBeenCalled();
        expect(runBrainConsolidate).not.toHaveBeenCalled();
        await expect(readFile(appHomePath('auto-maintain.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        vi.doUnmock('./brain-consolidate.js');
      }
    });

    it('skips startup consolidation without claiming state when another process holds the startup lock', async () => {
      await writeFile(appHomePath('auto-maintain.lock'), String(process.pid));
      const runBrainConsolidate = vi.fn().mockResolvedValue({
        ok: true,
        steps: [{ applied: ['dedup'] }],
      });
      const brainConsolidateFactory = vi.fn(() => ({ runBrainConsolidate }));
      vi.doMock('./brain-consolidate.js', brainConsolidateFactory);
      try {
        await expect(maybeStartupMaintain(Date.now())).resolves.toBe(null);
        expect(brainConsolidateFactory).not.toHaveBeenCalled();
        expect(runBrainConsolidate).not.toHaveBeenCalled();
        await expect(readFile(appHomePath('auto-maintain.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(appHomePath('auto-maintain.lock'), 'utf8')).resolves.toBe(String(process.pid));
      } finally {
        await rm(appHomePath('auto-maintain.lock'), { force: true });
        vi.doUnmock('./brain-consolidate.js');
      }
    });

    it('evicts a stale startup lock before claiming a startup consolidate run', async () => {
      const now = Date.now();
      const lockPath = appHomePath('auto-maintain.lock');
      await writeFile(lockPath, 'not-a-pid');
      const old = new Date(now - 5_000);
      await utimes(lockPath, old, old);
      const runBrainConsolidate = vi.fn().mockResolvedValue({
        ok: true,
        steps: [{ applied: ['dedup'] }],
      });
      vi.doMock('./brain-consolidate.js', () => ({ runBrainConsolidate }));
      try {
        await expect(maybeStartupMaintain(now)).resolves.toBe('auto-maintain: จัดระเบียบ memory + vault (1 รายการ)');
        expect(runBrainConsolidate).toHaveBeenCalledTimes(1);
        const state = JSON.parse(await readFile(appHomePath('auto-maintain.json'), 'utf8')) as {
          lastConsolidate?: unknown;
        };
        expect(state.lastConsolidate).toBe(now);
        await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await rm(lockPath, { force: true });
        vi.doUnmock('./brain-consolidate.js');
      }
    });

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
        expect((await stat(stateDir)).mode & 0o777).toBe(0o700);
        expect((await stat(appHomePath('auto-maintain.json'))).mode & 0o777).toBe(0o600);
        expect(await stateTempFiles(stateDir)).toEqual([]);
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

    it('keeps startup maintenance best-effort when consolidation throws after claim', async () => {
      const now = Date.now();
      const runBrainConsolidate = vi.fn().mockRejectedValue(new Error('consolidate failed'));
      vi.doMock('./brain-consolidate.js', () => ({ runBrainConsolidate }));
      try {
        await expect(maybeStartupMaintain(now)).resolves.toBe(null);
        expect(runBrainConsolidate).toHaveBeenCalledTimes(1);
        const state = JSON.parse(await readFile(appHomePath('auto-maintain.json'), 'utf8')) as {
          lastConsolidate?: unknown;
        };
        expect(state.lastConsolidate).toBe(now);
        await expect(readFile(appHomePath('auto-maintain.lock'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

        await expect(maybeStartupMaintain(now + DAY)).resolves.toBe(null);
        expect(runBrainConsolidate).toHaveBeenCalledTimes(1);
      } finally {
        vi.doUnmock('./brain-consolidate.js');
      }
    });

    it('keeps the state file private when claiming an existing broad-permission file', async () => {
      const now = Date.now();
      const statePath = appHomePath('auto-maintain.json');
      await chmod(stateDir, 0o755);
      await writeFile(statePath, JSON.stringify({ lastConsolidate: now + 30 * DAY }), { mode: 0o644 });
      await chmod(statePath, 0o644);
      const runBrainConsolidate = vi.fn().mockResolvedValue({
        ok: true,
        steps: [],
      });
      vi.doMock('./brain-consolidate.js', () => ({ runBrainConsolidate }));
      try {
        await expect(maybeStartupMaintain(now)).resolves.toBe(null);
        expect((await stat(stateDir)).mode & 0o777).toBe(0o700);
        expect((await stat(statePath)).mode & 0o777).toBe(0o600);
      } finally {
        vi.doUnmock('./brain-consolidate.js');
      }
    });

    it('skips consolidation and cleans up temp state when the atomic claim cannot be written', async () => {
      const now = Date.now();
      await mkdir(appHomePath('auto-maintain.json'));
      const runBrainConsolidate = vi.fn().mockResolvedValue({
        ok: true,
        steps: [],
      });
      const brainConsolidateFactory = vi.fn(() => ({ runBrainConsolidate }));
      vi.doMock('./brain-consolidate.js', brainConsolidateFactory);
      try {
        await expect(maybeStartupMaintain(now)).resolves.toBe(null);
        expect(brainConsolidateFactory).not.toHaveBeenCalled();
        expect(runBrainConsolidate).not.toHaveBeenCalled();
        expect(await stateTempFiles(stateDir)).toEqual([]);
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
      const memoryFactory = vi.fn(() => ({ appendMemory: vi.fn() }));
      const distillerFactory = vi.fn(() => ({ distilledCandidatesFromMessages: vi.fn() }));
      vi.doMock('./memory.js', memoryFactory);
      vi.doMock('./session-distill.js', distillerFactory);
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'user',
              content: 'We decided to keep local-first memory.',
            },
          ]),
        ).resolves.toBe(0);
        expect(distillerFactory).not.toHaveBeenCalled();
        expect(memoryFactory).not.toHaveBeenCalled();
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
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
        expect(appendMemory).toHaveBeenCalledWith('We decided to keep local-first memory.', 'decision');
      } finally {
        vi.doUnmock('./memory.js');
      }
    });
    it('honors config autoMaintain=false before importing distiller or memory writer', async () => {
      await writeFile(appHomePath('config.json'), JSON.stringify({ autoMaintain: false }));
      const memoryFactory = vi.fn(() => ({ appendMemory: vi.fn() }));
      const distillerFactory = vi.fn(() => ({ distilledCandidatesFromMessages: vi.fn() }));
      vi.doMock('./memory.js', memoryFactory);
      vi.doMock('./session-distill.js', distillerFactory);
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'user',
              content: 'We decided auto-maintain opt-out must skip memory writes.',
            },
          ]),
        ).resolves.toBe(0);
        expect(distillerFactory).not.toHaveBeenCalled();
        expect(memoryFactory).not.toHaveBeenCalled();
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
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
        expect(appendMemory).toHaveBeenCalledWith('We decided to tolerate malformed distill messages.', 'decision');
      } finally {
        vi.doUnmock('./memory.js');
      }
    });
    it('passes only user and assistant messages with content to the distiller', async () => {
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      const distilledCandidatesFromMessages = vi.fn().mockReturnValue([
        { text: 'We decided to persist only conversation facts.', kind: 'decision' },
      ]);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      vi.doMock('./session-distill.js', () => ({ distilledCandidatesFromMessages }));
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
        expect(distilledCandidatesFromMessages).toHaveBeenCalledWith([
          { role: 'assistant', content: 'We decided to persist only conversation facts.' },
          { role: 'user', content: contentParts },
        ]);
        expect(appendMemory).toHaveBeenCalledWith('We decided to persist only conversation facts.', 'decision');
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
      }
    });
    it('skips distiller and memory imports when no messages are distillable', async () => {
      const memoryFactory = vi.fn(() => ({ appendMemory: vi.fn() }));
      const distillerFactory = vi.fn(() => ({ distilledCandidatesFromMessages: vi.fn() }));
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
    it('maps distilled candidate kinds to memory note types', async () => {
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      const distilledCandidatesFromMessages = vi.fn().mockReturnValue([
        { text: 'We decided to use SQLite for local cache.', kind: 'decision' },
        { text: 'Pick prefers concise Thai replies.', kind: 'preference' },
        { text: 'Secrets must never be written into the repo.', kind: 'constraint' },
        { text: 'The bug was stale auto-maintain state.', kind: 'gotcha' },
      ]);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      vi.doMock('./session-distill.js', () => ({ distilledCandidatesFromMessages }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'assistant',
              content:
                'We decided to use SQLite for local cache. Pick prefers concise Thai replies. Secrets must never be written into the repo. The bug was stale auto-maintain state.',
            },
          ]),
        ).resolves.toBe(4);
        expect(appendMemory).toHaveBeenNthCalledWith(1, 'We decided to use SQLite for local cache.', 'decision');
        expect(appendMemory).toHaveBeenNthCalledWith(2, 'Pick prefers concise Thai replies.', 'preference');
        expect(appendMemory).toHaveBeenNthCalledWith(3, 'Secrets must never be written into the repo.', 'convention');
        expect(appendMemory).toHaveBeenNthCalledWith(4, 'The bug was stale auto-maintain state.', 'fact');
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
      }
    });
    it('skips malformed distilled candidates without aborting valid candidates', async () => {
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      const distilledCandidatesFromMessages = vi.fn().mockReturnValue([
        null,
        { text: '', kind: 'decision' },
        { text: 'Never write API keys to memory.', kind: 'constraint' },
        { text: 'This candidate has an unknown kind.', kind: 'unknown' },
      ]);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      vi.doMock('./session-distill.js', () => ({ distilledCandidatesFromMessages }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'assistant',
              content: 'Never write API keys to memory.',
            },
          ]),
        ).resolves.toBe(1);
        expect(appendMemory).toHaveBeenCalledTimes(1);
        expect(appendMemory).toHaveBeenCalledWith('Never write API keys to memory.', 'convention');
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
      }
    });
    it('deduplicates distilled facts within one session before appending memory', async () => {
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      const distilledCandidatesFromMessages = vi.fn().mockReturnValue([
        { text: 'We decided to keep duplicate distill facts out of memory.', kind: 'decision' },
        { text: 'We decided to keep duplicate distill facts out of memory.', kind: 'decision' },
        { text: 'We decided to keep duplicate distill facts out of memory.', kind: 'preference' },
        { text: 'The convention is to dedupe auto-memory writes per session.', kind: 'constraint' },
        { text: 'The convention is to dedupe auto-memory writes per session.', kind: 'constraint' },
      ]);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      vi.doMock('./session-distill.js', () => ({ distilledCandidatesFromMessages }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'assistant',
              content:
                'We decided to keep duplicate distill facts out of memory. The convention is to dedupe auto-memory writes per session.',
            },
          ]),
        ).resolves.toBe(3);
        expect(appendMemory).toHaveBeenCalledTimes(3);
        expect(appendMemory).toHaveBeenNthCalledWith(
          1,
          'We decided to keep duplicate distill facts out of memory.',
          'decision',
        );
        expect(appendMemory).toHaveBeenNthCalledWith(
          2,
          'We decided to keep duplicate distill facts out of memory.',
          'preference',
        );
        expect(appendMemory).toHaveBeenNthCalledWith(
          3,
          'The convention is to dedupe auto-memory writes per session.',
          'convention',
        );
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
      }
    });
    it('deduplicates auto-distill facts with equivalent casing, whitespace, and Unicode forms', async () => {
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      const distilledCandidatesFromMessages = vi.fn().mockReturnValue([
        { text: 'Piqué prefers concise Thai replies.', kind: 'preference' },
        { text: 'PIQUE\u0301  PREFERS\nCONCISE THAI REPLIES.', kind: 'preference' },
        { text: 'Pique\u0301  prefers\nconcise Thai replies.', kind: 'decision' },
      ]);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      vi.doMock('./session-distill.js', () => ({ distilledCandidatesFromMessages }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'assistant',
              content: 'Piqué prefers concise Thai replies.',
            },
          ]),
        ).resolves.toBe(2);
        expect(appendMemory).toHaveBeenCalledTimes(2);
        expect(appendMemory).toHaveBeenNthCalledWith(1, 'Piqué prefers concise Thai replies.', 'preference');
        expect(appendMemory).toHaveBeenNthCalledWith(2, 'Pique\u0301  prefers\nconcise Thai replies.', 'decision');
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
      }
    });
    it('does not count duplicate distilled facts toward the per-session write cap', async () => {
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      const distilledCandidatesFromMessages = vi.fn().mockReturnValue([
        ...Array.from({ length: 12 }, () => ({
          text: 'We decided to keep repeated distill facts out of memory.',
          kind: 'decision',
        })),
        ...Array.from({ length: 8 }, (_, i) => ({
          text: `We decided to keep later unique fact ${i} in memory.`,
          kind: 'decision',
        })),
      ]);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      vi.doMock('./session-distill.js', () => ({ distilledCandidatesFromMessages }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'assistant',
              content:
                'We decided to keep repeated distill facts out of memory. We decided to keep later unique facts in memory.',
            },
          ]),
        ).resolves.toBe(8);
        expect(appendMemory).toHaveBeenCalledTimes(8);
        expect(appendMemory).toHaveBeenNthCalledWith(
          1,
          'We decided to keep repeated distill facts out of memory.',
          'decision',
        );
        expect(appendMemory).toHaveBeenLastCalledWith('We decided to keep later unique fact 6 in memory.', 'decision');
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
      }
    });
    it('skips memory import when the distiller returns malformed output', async () => {
      const memoryFactory = vi.fn(() => ({ appendMemory: vi.fn() }));
      const distilledCandidatesFromMessages = vi.fn().mockReturnValue(undefined);
      vi.doMock('./memory.js', memoryFactory);
      vi.doMock('./session-distill.js', () => ({ distilledCandidatesFromMessages }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'assistant',
              content: 'We decided to keep auto-distill best-effort.',
            },
          ]),
        ).resolves.toBe(0);
        expect(memoryFactory).not.toHaveBeenCalled();
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
      }
    });
    it('persists legacy string distill results as facts', async () => {
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      const distilledCandidatesFromMessages = vi.fn().mockReturnValue([
        'Legacy distillers returned fact text directly.',
      ]);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      vi.doMock('./session-distill.js', () => ({ distilledCandidatesFromMessages }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'assistant',
              content: 'Legacy distillers returned fact text directly.',
            },
          ]),
        ).resolves.toBe(1);
        expect(appendMemory).toHaveBeenCalledWith('Legacy distillers returned fact text directly.', 'fact');
      } finally {
        vi.doUnmock('./memory.js');
        vi.doUnmock('./session-distill.js');
      }
    });
    it('does not count malformed distilled candidates toward the per-session write cap', async () => {
      const appendMemory = vi.fn().mockResolvedValue(undefined);
      const distilledCandidatesFromMessages = vi.fn().mockReturnValue([
        ...Array.from({ length: 8 }, () => ({ text: '', kind: 'decision' })),
        ...Array.from({ length: 9 }, (_, i) => ({
          text: `We decided to keep durable valid fact ${i} in memory.`,
          kind: 'decision',
        })),
      ]);
      vi.doMock('./memory.js', () => ({ appendMemory }));
      vi.doMock('./session-distill.js', () => ({ distilledCandidatesFromMessages }));
      try {
        await expect(
          autoDistillToMemory([
            {
              role: 'assistant',
              content: 'We decided to keep durable valid facts in memory.',
            },
          ]),
        ).resolves.toBe(8);
        expect(appendMemory).toHaveBeenCalledTimes(8);
        expect(appendMemory).toHaveBeenLastCalledWith('We decided to keep durable valid fact 7 in memory.', 'decision');
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
        expect(appendMemory).toHaveBeenLastCalledWith('We decided to keep durable fact 7 in memory.', 'decision');
      } finally {
        vi.doUnmock('./memory.js');
      }
    });
  });
});
