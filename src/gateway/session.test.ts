import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  it('keeps gateway session filenames inside the session directory', async () => {
    const { gatewaySessionId, loadGatewaySession, saveGatewaySession } = await import('./session.js');
    const platform = '../escape/path';
    const id = gatewaySessionId(platform, 'target');

    expect(id).toMatch(/^escape-path-[a-f0-9]{24}$/);
    await expect(
      saveGatewaySession({
        id: '../escape',
        platform,
        target: 'target',
        created: '2026-06-18T00:00:00.000Z',
        updated: '2026-06-18T00:00:00.000Z',
        model: 'sonnet',
        messages: [],
      }),
    ).rejects.toThrow(/gateway session id/);

    await saveGatewaySession({
      id,
      platform,
      target: 'target',
      created: '2026-06-18T00:00:00.000Z',
      updated: '2026-06-18T00:00:00.000Z',
      model: 'sonnet',
      messages: [{ role: 'user', content: 'safe' }],
    });
    expect((await loadGatewaySession(platform, 'target'))?.id).toBe(id);
  });

  it('skips malformed gateway session files when loading and listing sessions', async () => {
    const { gatewaySessionId, listGatewaySessions, loadGatewaySession, saveGatewaySession } = await import('./session.js');
    const validId = gatewaySessionId('telegram', '111');
    const malformedId = gatewaySessionId('telegram', 'bad');
    const sessionDir = join(home, '.sanook', 'gateway', 'sessions');

    await saveGatewaySession({
      id: validId,
      platform: 'telegram',
      target: '111',
      created: '2026-06-18T00:00:00.000Z',
      updated: '2026-06-18T00:00:01.000Z',
      model: 'sonnet',
      messages: [{ role: 'user', content: 'safe' }],
    });
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, `${malformedId}.json`),
      JSON.stringify({
        id: malformedId,
        platform: 'telegram',
        target: 'bad',
        created: '2026-06-18T00:00:00.000Z',
        updated: 42,
        model: 'sonnet',
        messages: ['not a model message'],
      }),
    );
    await writeFile(join(sessionDir, 'invalid-json.json'), '{bad');

    expect(await loadGatewaySession('telegram', 'bad')).toBeNull();
    expect((await listGatewaySessions()).map((session) => session.id)).toEqual([validId]);
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

  it('handles Hermes-style messaging slash commands without calling the model', async () => {
    const { loadGatewaySession, runGatewayAgent } = await import('./session.js');
    await runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: 'first', userText: 'first' });
    vi.clearAllMocks();

    const status = await runGatewayAgent({
      platform: 'telegram',
      target: '111',
      model: 'sonnet',
      prompt: 'Telegram 111:\n/status',
      userText: '/status',
    });
    expect(status.suppressDelivery).toBe(false);
    expect(status.text).toContain('Platform: telegram');
    expect(status.text).toContain('Target: 111');
    expect(status.text).toContain('Messages: 2');
    expect(runAgent).not.toHaveBeenCalled();

    await expect(
      runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: 'Telegram 111:\n/reset', userText: '/reset' }),
    ).resolves.toMatchObject({ text: 'เริ่มบทสนทนาใหม่แล้ว', messages: [] });
    expect(await loadGatewaySession('telegram', '111')).toBeNull();

    await expect(
      runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: '/help', userText: '/help' }),
    ).resolves.toMatchObject({ text: expect.stringContaining('/sethome') });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('handles /sethome by updating gateway config without calling the model', async () => {
    const { readGatewayConfig } = await import('./config.js');
    const { runGatewayAgent } = await import('./session.js');

    await expect(
      runGatewayAgent({ platform: 'discord', target: 'chan-123', model: 'sonnet', prompt: '/sethome', userText: '/sethome' }),
    ).resolves.toMatchObject({ text: expect.stringContaining('Discord home channel') });

    const cfg = await readGatewayConfig();
    expect(cfg.discord?.defaultChannelId).toBe('chan-123');
    expect(cfg.discord?.allowedChannelIds).toEqual(['chan-123']);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('handles Hermes-style messaging model, personality, usage, compress, undo, and retry commands', async () => {
    const { loadConfig } = await import('../config.js');
    const { loadGatewaySession, runGatewayAgent } = await import('./session.js');

    await runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: 'first', userText: 'first' });
    await runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: 'second', userText: 'second' });
    vi.clearAllMocks();

    await expect(
      runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: '/model openai:gpt', userText: '/model openai:gpt' }),
    ).resolves.toMatchObject({ text: expect.stringContaining('openai:gpt-5.5') });
    expect((await loadGatewaySession('telegram', '111'))?.model).toBe('openai:gpt-5.5');
    await expect(
      runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: '/model nope:model', userText: '/model nope:model' }),
    ).resolves.toMatchObject({ text: expect.stringContaining('ไม่รองรับ') });
    await expect(
      runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: '/model openai:', userText: '/model openai:' }),
    ).resolves.toMatchObject({ text: expect.stringContaining('ไม่รองรับ') });
    expect((await loadGatewaySession('telegram', '111'))?.model).toBe('openai:gpt-5.5');

    await runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: 'third', userText: 'third' });
    expect(runAgent).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'openai:gpt-5.5', prompt: 'third' }));
    vi.clearAllMocks();

    await expect(
      runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: '/personality concise', userText: '/personality concise' }),
    ).resolves.toMatchObject({ text: expect.stringContaining('concise') });
    expect((await loadConfig()).personality).toBe('concise');

    await expect(
      runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: '/usage', userText: '/usage' }),
    ).resolves.toMatchObject({ text: expect.stringContaining('messages: 6') });
    await expect(
      runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: '/insights -d 14', userText: '/insights -d 14' }),
    ).resolves.toMatchObject({ text: expect.stringContaining('insights (14d)') });
    await expect(
      runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: '/compress', userText: '/compress' }),
    ).resolves.toMatchObject({ text: expect.stringContaining('compact') });

    await expect(
      runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: '/undo', userText: '/undo' }),
    ).resolves.toMatchObject({ text: expect.stringContaining('undo') });
    expect((await loadGatewaySession('telegram', '111'))?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

    await expect(
      runGatewayAgent({ platform: 'telegram', target: '111', model: 'sonnet', prompt: '/retry', userText: '/retry' }),
    ).resolves.toMatchObject({ text: 'reply:second' });
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'openai:gpt-5.5', prompt: 'second' }));
  });
});
