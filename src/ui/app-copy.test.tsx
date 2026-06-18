import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';

type MockRunAgentOptions = { history?: unknown[]; prompt: string };

const h = vi.hoisted(() => ({
  copied: [] as string[],
  run: async (opts: MockRunAgentOptions) => ({
    cost: { summary: () => 'tokens: 10' },
    messages: [...(opts.history ?? []), { content: opts.prompt, role: 'user' }, { content: 'assistant answer', role: 'assistant' }],
    text: 'assistant answer',
  }),
}));

vi.mock('../loop.js', () => ({
  runAgent: (opts: MockRunAgentOptions) => h.run(opts),
}));

vi.mock('../checkpoint.js', () => ({
  restoreWorkTree: async () => ({ ok: true }),
  snapshotWorkTree: async () => null,
}));

vi.mock('../clipboard.js', () => ({
  copyTextToClipboard: async (text: string) => {
    h.copied.push(text);
    return { detail: 'mock', method: 'system' };
  },
}));

import { App } from './app.js';

const tick = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(cond: () => boolean, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (cond()) return;
    await tick();
  }
}

describe('App copy command', () => {
  beforeAll(() => {
    process.env.SANOOK_DISABLE_PERSISTENCE = '1';
  });

  beforeEach(() => {
    h.copied = [];
  });

  afterAll(() => {
    delete process.env.SANOOK_DISABLE_PERSISTENCE;
  });

  it('/copy copies the latest assistant turn', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" permissionMode="auto" />);

    stdin.write('answer me');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('assistant answer'));

    stdin.write('/copy');
    await tick();
    stdin.write('\r');
    await waitFor(() => h.copied.length === 1);
    await waitFor(() => (lastFrame() ?? '').includes('copy: copied latest assistant'));

    expect(h.copied).toEqual(['assistant answer']);
    expect(lastFrame()).toContain('copy: copied latest assistant');
    unmount();
  });
});
