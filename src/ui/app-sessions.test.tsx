import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';

const h = vi.hoisted(() => {
  const sampleSession = () => ({
    id: 'session-new',
    created: '2026-06-18T10:00:00.000Z',
    updated: '2026-06-18T10:30:00.000Z',
    model: 'openai:gpt-5.5',
    cwd: process.cwd(),
    messages: [{ role: 'user' as const, content: 'resume this session' }],
  });
  return { sampleSession, sessions: [sampleSession()] };
});

vi.mock('../session.js', () => ({
  listSessions: async () => h.sessions,
  newSessionId: () => 'fresh-session',
  removeSession: async (id: string) => {
    const before = h.sessions.length;
    h.sessions = h.sessions.filter((session) => session.id !== id);
    return h.sessions.length !== before;
  },
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
  beforeEach(() => {
    h.sessions = [h.sampleSession()];
  });

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

  it('inspects a session and deletes it only after a second d press', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/sessions');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('Sanook sessions'));

    stdin.write('i');
    await tick();

    expect(lastFrame()).toContain('id: session-new');
    expect(lastFrame()).toContain('first: resume this session');

    stdin.write('d');
    await tick();

    expect(h.sessions).toHaveLength(1);
    expect(lastFrame()).toContain('press d again');

    stdin.write('d');
    await tick();

    expect(h.sessions).toHaveLength(0);
    expect(lastFrame()).toContain('deleted session-new');
    expect(lastFrame()).toContain('Esc/q close');
    unmount();
  });
});
