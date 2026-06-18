import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';

type MockRunAgentOptions = {
  history?: unknown[];
  onEvent?: (e: unknown) => void;
  prompt: string;
  signal?: AbortSignal;
};

const h = vi.hoisted(() => ({
  opts: null as null | MockRunAgentOptions,
  run: null as null | ((opts: MockRunAgentOptions) => Promise<unknown>),
}));

vi.mock('../loop.js', () => ({
  runAgent: (opts: MockRunAgentOptions) => {
    h.opts = opts;
    if (h.run) return h.run(opts);
    return new Promise(() => {});
  },
}));

vi.mock('../checkpoint.js', () => ({
  restoreWorkTree: async () => ({ ok: true }),
  snapshotWorkTree: async () => null,
}));

import { App } from './app.js';

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, tries = 25): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (cond()) return;
    await tick();
  }
}

describe('App tool trail', () => {
  beforeAll(() => {
    process.env.SANOOK_DISABLE_PERSISTENCE = '1';
  });

  beforeEach(() => {
    h.opts = null;
    h.run = null;
  });

  afterAll(() => {
    delete process.env.SANOOK_DISABLE_PERSISTENCE;
    h.opts = null;
  });

  it('renders tool-call and tool-result events as a compact live trail', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" permissionMode="auto" />);

    stdin.write('inspect the repo');
    await tick();
    stdin.write('\r');
    await waitFor(() => h.opts !== null);

    h.opts!.onEvent?.({ detail: { path: 'src/app.tsx' }, tool: 'read_file', type: 'tool-call' });
    await waitFor(() => (lastFrame() ?? '').includes('Sanook tool trail (1)'));

    expect(lastFrame()).toContain('read_file');
    expect(lastFrame()).toContain('running');

    h.opts!.onEvent?.({ detail: 'ok', tool: 'read_file', type: 'tool-result' });
    await waitFor(() => (lastFrame() ?? '').includes('done'));

    expect(lastFrame()).toContain('read_file');
    expect(lastFrame()).toContain('ok');

    unmount();
  });

  it('persists completed tool trails inside the assistant transcript without duplicating the live panel', async () => {
    h.run = async (opts) => {
      opts.onEvent?.({ detail: { path: 'src/app.tsx' }, tool: 'read_file', type: 'tool-call' });
      opts.onEvent?.({ detail: 'ok', tool: 'read_file', type: 'tool-result' });
      opts.onEvent?.({ text: 'finished answer', type: 'text' });
      return {
        cost: { summary: () => 'tokens: 10' },
        messages: [...(opts.history ?? []), { content: opts.prompt, role: 'user' }, { content: 'finished answer', role: 'assistant' }],
        text: 'finished answer',
      };
    };
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" permissionMode="auto" />);

    stdin.write('inspect the repo');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('finished answer'));
    await waitFor(() => (lastFrame() ?? '').includes('Sanook tool trail (1)'));

    const frame = lastFrame() ?? '';
    expect(frame).toContain('read_file');
    expect(frame).toContain('done');
    expect(frame).toContain('ok');
    expect(frame.match(/Sanook tool trail/g)).toHaveLength(1);

    unmount();
  });
});
