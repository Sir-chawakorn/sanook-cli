import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';

type MockRunAgentOptions = { prompt: string };

const h = vi.hoisted(() => ({
  prompt: '',
  run: async (opts: MockRunAgentOptions) => {
    h.prompt = opts.prompt;
    return {
      cost: { summary: () => 'tokens: 10' },
      messages: [{ content: opts.prompt, role: 'user' }, { content: 'ok', role: 'assistant' }],
      text: 'ok',
    };
  },
}));

vi.mock('../loop.js', () => ({
  runAgent: (opts: MockRunAgentOptions) => h.run(opts),
}));

vi.mock('../checkpoint.js', () => ({
  restoreWorkTree: async () => ({ ok: true }),
  snapshotWorkTree: async () => null,
}));

import { App } from './app.js';

const tick = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(cond: () => boolean, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (cond()) return;
    await tick();
  }
}

describe('App paste collapse', () => {
  beforeAll(() => {
    process.env.SANOOK_DISABLE_PERSISTENCE = '1';
  });

  beforeEach(() => {
    h.prompt = '';
  });

  afterAll(() => {
    delete process.env.SANOOK_DISABLE_PERSISTENCE;
  });

  it('shows a collapsed paste token but submits the full pasted text', async () => {
    const pasted = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n');
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" permissionMode="auto" />);

    stdin.write('summarize ');
    await tick();
    stdin.write(`\x1b[200~${pasted}\x1b[201~`);
    await waitFor(() => (lastFrame() ?? '').includes('[[ paste 5 lines'));
    expect(lastFrame()).toContain('[[ paste 5 lines');

    stdin.write('\r');
    await waitFor(() => h.prompt.length > 0);

    expect(h.prompt).toBe(`summarize ${pasted}`);
    unmount();
  });
});
