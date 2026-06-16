import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  runAgent: vi.fn(),
}));

vi.mock('../loop.js', () => ({
  runAgent: h.runAgent,
}));

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (condition()) return;
    await tick();
  }
  throw new Error('condition was not met before timeout');
}

describe('gateway scheduler', () => {
  let home: string;

  beforeEach(async () => {
    vi.resetModules();
    home = await mkdtemp(join(tmpdir(), 'sanook-scheduler-'));
    vi.stubEnv('HOME', home);
    h.runAgent.mockReset();
    h.runAgent.mockResolvedValue({ text: 'agent output' });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(home, { recursive: true, force: true });
  });

  it('delivers successful task output after persisting the run result', async () => {
    const ledger = await import('./ledger.js');
    const { startScheduler } = await import('./scheduler.js');
    const task = await ledger.enqueueTask({
      kind: 'once',
      spec: 'summarize the queue',
      deliver: 'slack:C01ABC',
      runAt: Date.now() - 1,
    });
    const deliver = vi.fn(async () => {});

    const stop = startScheduler({ defaultModel: 'test:model', tickMs: 60_000, deliver });
    try {
      await waitFor(() => deliver.mock.calls.length === 1);
    } finally {
      stop();
    }

    expect(h.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test:model',
        prompt: 'summarize the queue',
      }),
    );
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: task.id, deliver: 'slack:C01ABC' }), 'agent output');
    const stored = await ledger.getTask(task.id);
    expect(stored).toMatchObject({
      status: 'done',
      lastResult: 'agent output',
    });
    expect(stored?.lastError).toBeUndefined();
  });
});
