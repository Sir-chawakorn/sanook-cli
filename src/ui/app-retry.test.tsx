import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render } from 'ink-testing-library';

const h = vi.hoisted(() => ({ calls: [] as Array<{ prompt: string; history?: unknown[]; onEvent?: (e: unknown) => void }> }));

vi.mock('../loop.js', () => ({
  runAgent: async (opts: { prompt: string; history?: unknown[]; onEvent?: (e: unknown) => void }) => {
    h.calls.push(opts);
    const n = h.calls.length;
    opts.onEvent?.({ type: 'text', text: `answer ${n}` });
    return {
      cost: { summary: () => `tokens: ${n}` },
      messages: [...(opts.history ?? []), { role: 'user', content: opts.prompt }, { role: 'assistant', content: `answer ${n}` }],
      text: `answer ${n}`,
    };
  },
}));

vi.mock('../checkpoint.js', () => ({
  snapshotWorkTree: async () => null,
  restoreWorkTree: async () => ({ ok: true }),
}));

import { App } from './app.js';

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, tries = 25): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (cond()) return;
    await tick();
  }
}

describe('App /retry', () => {
  beforeEach(() => {
    h.calls = [];
    process.env.SANOOK_DISABLE_PERSISTENCE = '1';
  });

  afterAll(() => {
    delete process.env.SANOOK_DISABLE_PERSISTENCE;
  });

  it('reruns the latest agent prompt after restoring pre-turn history', async () => {
    const { stdin, unmount } = render(<App initialModel="sonnet" permissionMode="auto" />);

    stdin.write('first prompt');
    await tick();
    stdin.write('\r');
    await waitFor(() => h.calls.length === 1);

    stdin.write('/retry');
    await tick();
    stdin.write('\r');
    await waitFor(() => h.calls.length === 2);

    expect(h.calls[1].prompt).toBe('first prompt');
    expect(h.calls[1].history ?? []).toHaveLength(0);

    unmount();
  });
});
