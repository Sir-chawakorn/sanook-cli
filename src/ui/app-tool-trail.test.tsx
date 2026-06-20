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

    // friendly activity title shows the file being read, with the running marker '›'
    expect(lastFrame()).toContain('อ่านไฟล์');
    expect(lastFrame()).toContain('src/app.tsx');
    expect(lastFrame()).toContain('›');

    h.opts!.onEvent?.({ detail: 'detail-visible', tool: 'read_file', type: 'tool-result' });
    await waitFor(() => (lastFrame() ?? '').includes('detail-visible'));

    expect(lastFrame()).toContain('อ่านไฟล์');
    expect(lastFrame()).toContain('detail-visible'); // result outcome line
    expect(lastFrame()).toContain('✓'); // done marker

    unmount();
  });

  it('persists completed tool trails inside the assistant transcript without duplicating the live panel', async () => {
    h.run = async (opts) => {
      opts.onEvent?.({ detail: { path: 'src/app.tsx' }, tool: 'read_file', type: 'tool-call' });
      opts.onEvent?.({ detail: 'detail-visible', tool: 'read_file', type: 'tool-result' });
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
    expect(frame).toContain('อ่านไฟล์');
    expect(frame).toContain('✓'); // done marker
    expect(frame).toContain('detail-visible');
    expect(frame.match(/Sanook tool trail/g)).toHaveLength(1);

    unmount();
  });

  it('/trail compact and /trail expanded rerender saved transcript tool trails', async () => {
    h.run = async (opts) => {
      opts.onEvent?.({ detail: { path: 'src/app.tsx' }, tool: 'read_file', type: 'tool-call' });
      opts.onEvent?.({ detail: 'detail-visible', tool: 'read_file', type: 'tool-result' });
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
    await waitFor(() => (lastFrame() ?? '').includes('view: expanded'));
    expect(lastFrame()).toContain('detail-visible');

    stdin.write('/trail compact');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('view: compact'));
    expect(lastFrame()).toContain('tools: +read_file');
    expect(lastFrame()).not.toContain('detail-visible');

    stdin.write('/trail expanded');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('view: expanded'));
    expect(lastFrame()).toContain('detail-visible');

    unmount();
  });

  it('keeps only the latest tool turn expanded in scrollback; older tool turns downgrade to compact', async () => {
    h.run = async (opts) => {
      const tag = opts.prompt.includes('second') ? 'second' : 'first';
      opts.onEvent?.({ detail: { path: `src/${tag}.tsx` }, tool: 'read_file', type: 'tool-call' });
      opts.onEvent?.({ detail: `detail-${tag}`, tool: 'read_file', type: 'tool-result' });
      opts.onEvent?.({ text: `answer ${tag}`, type: 'text' });
      return {
        cost: { summary: () => 'tokens: 10' },
        messages: [...(opts.history ?? []), { content: opts.prompt, role: 'user' }, { content: `answer ${tag}`, role: 'assistant' }],
        text: `answer ${tag}`,
      };
    };
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" permissionMode="auto" />);

    stdin.write('first task');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('answer first'));

    stdin.write('second task');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('answer second'));

    const frame = lastFrame() ?? '';
    // latest tool turn keeps the expanded diff/detail…
    expect(frame).toContain('detail-second');
    expect(frame).toContain('src/second.tsx');
    // …while the older tool turn downgrades to the compact one-liner (no per-item detail)
    expect(frame).toContain('tools: +read_file');
    expect(frame).not.toContain('detail-first');
    expect(frame).not.toContain('src/first.tsx');

    unmount();
  });

  it('renders reasoning deltas in a thinking panel and /details thinking hidden hides saved thinking', async () => {
    h.run = async (opts) => {
      opts.onEvent?.({ text: 'Plan next tool\nRead package metadata', type: 'reasoning' });
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
    await waitFor(() => (lastFrame() ?? '').includes('Sanook thinking'));
    expect(lastFrame()).toContain('Plan next tool');

    stdin.write('/details thinking hidden');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('details thinking → hidden'));

    expect(lastFrame()).not.toContain('Sanook thinking');
    unmount();
  });

  it('/details tools hidden hides saved tool trails', async () => {
    h.run = async (opts) => {
      opts.onEvent?.({ detail: { path: 'src/app.tsx' }, tool: 'read_file', type: 'tool-call' });
      opts.onEvent?.({ detail: 'detail-visible', tool: 'read_file', type: 'tool-result' });
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
    await waitFor(() => (lastFrame() ?? '').includes('Sanook tool trail'));

    stdin.write('/details tools hidden');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('tool trail → hidden'));

    expect(lastFrame()).not.toContain('Sanook tool trail');
    unmount();
  });

  it('renders streaming and saved assistant markdown instead of raw markdown fences', async () => {
    h.run = async (opts) => {
      const markdown = '# Done\n\n- used `read_file`\n\n```ts\nconst ok = true;\n```';
      opts.onEvent?.({ text: markdown, type: 'text' });
      return {
        cost: { summary: () => 'tokens: 10' },
        messages: [...(opts.history ?? []), { content: opts.prompt, role: 'user' }, { content: markdown, role: 'assistant' }],
        text: markdown,
      };
    };
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" permissionMode="auto" />);

    stdin.write('render markdown');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('const ok = true;'));

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Done');
    expect(frame).toContain('- used read_file');
    expect(frame).not.toContain('```');
    unmount();
  });
});
