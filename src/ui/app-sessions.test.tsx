import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';

const h = vi.hoisted(() => ({
  sessions: [
    {
      id: 'session-new',
      created: '2026-06-18T10:00:00.000Z',
      updated: '2026-06-18T10:30:00.000Z',
      model: 'openai:gpt-5.5',
      cwd: process.cwd(),
      messages: [{ role: 'user' as const, content: 'resume this session' }],
    },
  ],
}));

vi.mock('../session.js', () => ({
  listSessions: async () => h.sessions,
  newSessionId: () => 'fresh-session',
  saveSession: async () => undefined,
}));

import { App } from './app.js';

const tick = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(cond: () => boolean, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await tick();
  }
}

describe('App session switcher overlay', () => {
  it('/sessions opens saved sessions and Enter resumes the highlighted session', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/sessions');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('Sanook sessions'));

    expect(lastFrame()).toContain('session-new');
    expect(lastFrame()).toContain('Enter resume');

    stdin.write('\r');
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('↻ เปิด session session-new (1 messages)');
    expect(frame).toContain('openai:gpt-5.5 · ask-mode');
    expect(frame).not.toContain('Sanook sessions');
    unmount();
  });

  it('clears the visible transcript from the previous session when resuming another one', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/status');
    await tick();
    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('session: REPL');

    stdin.write('/sessions');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('Sanook sessions'));

    stdin.write('\r');
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('↻ เปิด session session-new (1 messages)');
    expect(frame).not.toContain('session: REPL');
    expect(frame).not.toContain('› /status');
    unmount();
  });
});
