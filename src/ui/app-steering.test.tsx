import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';

// hoisted holder so the vi.mock factory can record the runAgent opts the App passes
const h = vi.hoisted(() => ({ opts: null as null | { signal?: AbortSignal; onEvent?: (e: unknown) => void } }));

// runAgent never resolves → the App stays in the `busy` turn so we can drive steering
vi.mock('../loop.js', () => ({
  runAgent: (opts: { signal?: AbortSignal }) => {
    h.opts = opts;
    return new Promise(() => {});
  },
}));
// avoid real git side-effects (snapshotWorkTree would `git stash create` in this repo)
vi.mock('../checkpoint.js', () => ({
  snapshotWorkTree: async () => null,
  restoreWorkTree: async () => ({ ok: true }),
}));

import { App } from './app.js';

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, tries = 25): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await tick();
  }
}

beforeAll(() => {
  process.env.SANOOK_DISABLE_PERSISTENCE = '1';
});
beforeEach(() => {
  h.opts = null;
});
afterAll(() => {
  delete process.env.SANOOK_DISABLE_PERSISTENCE;
  h.opts = null;
});

describe('real-time steering', () => {
  it('passes an AbortSignal to the turn, queues input typed while busy, and Esc aborts + clears the queue', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" permissionMode="auto" />);

    // start a turn
    stdin.write('first prompt');
    await tick();
    stdin.write('\r'); // Enter → submit → runAgent (busy)
    await waitFor(() => h.opts !== null);

    expect(h.opts).toBeTruthy();
    expect(h.opts!.signal).toBeInstanceOf(AbortSignal);
    expect(h.opts!.signal!.aborted).toBe(false);

    // type a follow-up WHILE busy → it should queue, not run ('⏳' marks the queue line)
    stdin.write('queued follow up');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('queued follow up'));
    expect(lastFrame()).toContain('⏳'); // queue indicator
    expect(lastFrame()).toContain('queued follow up');

    // Esc → abort the running turn (signal flips) AND clear the queue
    stdin.write('\x1B');
    await waitFor(() => h.opts!.signal!.aborted === true);
    expect(h.opts!.signal!.aborted).toBe(true);

    // queue clears after the abort (poll the rendered frame to avoid a render-timing race)
    let cleared = false;
    await waitFor(() => (cleared = !(lastFrame() ?? '').includes('⏳')));
    expect(cleared).toBe(true);
    expect(lastFrame()).not.toContain('queued follow up');

    unmount();
  });

  it('/stop typed while busy aborts the running turn instead of queueing', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" permissionMode="auto" />);

    stdin.write('first prompt');
    await tick();
    stdin.write('\r');
    await waitFor(() => h.opts !== null);

    expect(h.opts!.signal!.aborted).toBe(false);

    stdin.write('/stop');
    await tick();
    stdin.write('\r');
    await waitFor(() => h.opts!.signal!.aborted === true);

    expect(h.opts!.signal!.aborted).toBe(true);
    expect(lastFrame()).not.toContain('⏳');

    unmount();
  });
});
