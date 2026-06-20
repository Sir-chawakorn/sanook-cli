import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { finalizeReplSession } from './session-brain.js';

describe('finalizeReplSession', () => {
  let root: string;

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { force: true, recursive: true });
  });

  it('writes a Sessions/ note when brainPath is configured', async () => {
    root = mkdtempSync(join(tmpdir(), 'sanook-session-brain-'));
    vi.stubEnv('HOME', root);
    const brain = join(root, 'vault');
    mkdirSync(join(root, '.sanook'), { recursive: true });
    mkdirSync(join(brain, 'Sessions'), { recursive: true });
    mkdirSync(join(brain, 'Templates'), { recursive: true });
    writeFileSync(join(root, '.sanook', 'config.json'), JSON.stringify({ brainPath: brain }), 'utf8');
    writeFileSync(join(brain, 'Sessions', '_Index.md'), 'up:: [[Home]]\n', 'utf8');
    writeFileSync(
      join(brain, 'Templates', 'session.md'),
      readFileSync(new URL('../second-brain/Templates/session.md', import.meta.url), 'utf8'),
      'utf8',
    );

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
});
