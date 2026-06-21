import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('finalizeReplSession', () => {
  let root = '';

  function prepareHome(config: Record<string, unknown> = {}): string {
    root = mkdtempSync(join(tmpdir(), 'sanook-session-brain-'));
    vi.stubEnv('HOME', root);
    mkdirSync(join(root, '.sanook'), { recursive: true });
    writeFileSync(join(root, '.sanook', 'config.json'), JSON.stringify(config), 'utf8');
    return root;
  }

  function prepareBrainVault(config: Record<string, unknown> = {}): string {
    prepareHome();
    const brain = join(root, 'vault');
    mkdirSync(join(brain, 'Sessions'), { recursive: true });
    mkdirSync(join(brain, 'Templates'), { recursive: true });
    writeFileSync(join(root, '.sanook', 'config.json'), JSON.stringify({ brainPath: brain, ...config }), 'utf8');
    writeFileSync(join(brain, 'Sessions', '_Index.md'), 'up:: [[Home]]\n', 'utf8');
    writeFileSync(
      join(brain, 'Templates', 'session.md'),
      readFileSync(new URL('../second-brain/Templates/session.md', import.meta.url), 'utf8'),
      'utf8',
    );
    return brain;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (root) rmSync(root, { force: true, recursive: true });
    root = '';
  });

  it('writes a Sessions/ note when brainPath is configured', async () => {
    prepareBrainVault();
    const { finalizeReplSession } = await import('./session-brain.js');

    const result = await finalizeReplSession({
      sessionId: '2026-06-21T00-00-00-abc123',
      sessionCreated: '2026-06-21T00:00:00.000Z',
      model: 'anthropic:sonnet',
      cwd: root,
      messages: [
        { role: 'user', content: 'fix sanook install docs' },
        { role: 'assistant', content: 'We decided to add sanookai alias.' },
      ],
      history: [
        { role: 'user', text: 'fix sanook install docs' },
        { role: 'assistant', text: 'We decided to add sanookai alias.' },
      ],
    });

    expect(result.sessionSaved).toBe(true);
    expect(result.brainNotePath).toBeTruthy();
    const note = readFileSync(result.brainNotePath!, 'utf8');
    expect(note).toContain('## Summary');
    expect(note).toContain('sanookai');
  });

  it('distills local REPL memory even when no brainPath is configured', async () => {
    prepareHome();
    const { finalizeReplSession } = await import('./session-brain.js');

    const result = await finalizeReplSession({
      sessionId: '2026-06-21T00-00-00-ghi789',
      sessionCreated: '2026-06-21T00:00:00.000Z',
      model: 'anthropic:sonnet',
      cwd: root,
      messages: [
        { role: 'user', content: 'check local memory without vault' },
        { role: 'assistant', content: 'We decided to keep local memory independent of brainPath.' },
      ],
      history: [
        { role: 'user', text: 'check local memory without vault' },
        { role: 'assistant', text: 'We decided to keep local memory independent of brainPath.' },
      ],
    });

    expect(result).toEqual({ sessionSaved: true });
    const store = JSON.parse(readFileSync(join(root, '.sanook', 'memory', 'memory.json'), 'utf8')) as {
      facts?: { text?: string }[];
    };
    expect(store.facts?.some((fact) => fact.text === 'We decided to keep local memory independent of brainPath.')).toBe(
      true,
    );
  });

  it('lets SANOOK_AUTO_DISTILL force REPL memory distill when autoMaintain config is off', async () => {
    prepareBrainVault({ autoMaintain: false });
    vi.stubEnv('SANOOK_AUTO_DISTILL', '1');
    const { finalizeReplSession } = await import('./session-brain.js');

    await finalizeReplSession({
      sessionId: '2026-06-21T00-00-00-def456',
      sessionCreated: '2026-06-21T00:00:00.000Z',
      model: 'anthropic:sonnet',
      cwd: root,
      messages: [
        { role: 'user', content: 'check REPL distill behavior' },
        { role: 'assistant', content: 'We decided to keep REPL auto distill parity.' },
      ],
      history: [
        { role: 'user', text: 'check REPL distill behavior' },
        { role: 'assistant', text: 'We decided to keep REPL auto distill parity.' },
      ],
    });

    const store = JSON.parse(readFileSync(join(root, '.sanook', 'memory', 'memory.json'), 'utf8')) as {
      facts?: { text?: string }[];
    };
    expect(store.facts?.some((fact) => fact.text === 'We decided to keep REPL auto distill parity.')).toBe(true);
  });
});
