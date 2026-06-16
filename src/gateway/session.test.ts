import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../loop.js';

vi.mock('../loop.js', () => ({
  runAgent: vi.fn(async (opts: { history?: unknown[]; prompt: string }) => ({
    text: opts.prompt === 'quiet' ? '[SILENT]' : `reply:${opts.prompt}`,
    messages: [...(opts.history ?? []), { role: 'user', content: opts.prompt }, { role: 'assistant', content: 'ok' }],
  })),
}));

describe('gateway chat sessions', () => {
  let home: string;
  let realHome: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    realHome = process.env.HOME;
    home = await mkdtemp(join(tmpdir(), 'sanook-gateway-session-'));
    process.env.HOME = home;
  });

  afterEach(async () => {
    vi.resetModules();
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    await rm(home, { recursive: true, force: true });
  });

  it('persists per-platform target history and reloads it on the next turn', async () => {
    const { loadGatewaySession, runGatewayAgent } = await import('./session.js');
    await runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: 'first' });
    await runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: 'second' });

    expect(runAgent).toHaveBeenLastCalledWith(expect.objectContaining({ history: expect.arrayContaining([{ role: 'user', content: 'first' }]) }));
    const session = await loadGatewaySession('telegram', '111');
    expect(session?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('detects Hermes-style silence tokens', async () => {
    const { runGatewayAgent, shouldSuppressDelivery } = await import('./session.js');
    expect(shouldSuppressDelivery('[SILENT]')).toBe(true);
    expect(shouldSuppressDelivery('NO_REPLY')).toBe(true);
    expect(shouldSuppressDelivery('Use [SILENT] here')).toBe(false);
    await expect(runGatewayAgent({ platform: 'email', target: 'owner@example.com', model: 'sonnet', prompt: 'quiet' })).resolves.toMatchObject({
      suppressDelivery: true,
    });
  });
});
