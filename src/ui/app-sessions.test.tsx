import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';

const h = vi.hoisted(() => {
  type MockSession = {
    id: string;
    created: string;
    updated: string;
    model: string;
    cwd: string;
    title?: string;
    messages: { role: 'user'; content: string }[];
  };
  const sampleSession = (): MockSession => ({
    id: 'session-new',
    created: '2026-06-18T10:00:00.000Z',
    updated: '2026-06-18T10:30:00.000Z',
    model: 'openai:gpt-5.5',
    cwd: process.cwd(),
    messages: [{ role: 'user' as const, content: 'resume this session' }],
  });
  return { sampleSession, sessions: [sampleSession()] as MockSession[] };
});

vi.mock('../session.js', () => ({
  listSessions: async () => h.sessions,
  newSessionId: () => 'fresh-session',
  removeSession: async (id: string) => {
    const before = h.sessions.length;
    h.sessions = h.sessions.filter((session) => session.id !== id);
    return h.sessions.length !== before;
  },
  renameSession: async (id: string, title: string) => {
    const session = h.sessions.find((item) => item.id === id);
    if (!session) return null;
    const updated = { ...session, title, updated: new Date().toISOString() };
    h.sessions = h.sessions.map((item) => (item.id === id ? updated : item));
    return updated;
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

  it('renames the selected session from the overlay', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/sessions');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('Sanook sessions'));

    stdin.write('r');
    await tick();

    expect(lastFrame()).toContain('rename:');
    expect(lastFrame()).toContain('title: resume this session');

    stdin.write(' v2');
    await tick();
    stdin.write('\r');
    await tick();

    expect(h.sessions[0]?.title).toBe('resume this session v2');
    expect(lastFrame()).toContain('renamed → resume this session v2');
    unmount();
  });

  it('lists cross-project sessions and resumes one from another cwd', async () => {
    h.sessions = [
      h.sampleSession(),
      {
        ...h.sampleSession(),
        id: 'session-other',
        cwd: '/tmp/other-project',
        messages: [{ role: 'user' as const, content: 'other project work' }],
      },
    ];

    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/sessions');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('Sanook sessions'));

    expect(lastFrame()).toContain('all projects');
    expect(lastFrame()).toContain('≠');

    stdin.write('\x1B[B');
    await tick();
    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('↻ เปิด session session-other');
    expect(lastFrame()).toContain('--continue-any');
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
