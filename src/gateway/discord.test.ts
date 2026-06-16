import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendDiscordMessage, startDiscord } from './discord.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discord send adapter', () => {
  it('posts a message with bot auth and returns ids', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'msg-1', channel_id: 'chan-1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendDiscordMessage('token', 'chan-1', 'hello')).resolves.toEqual({
      channelId: 'chan-1',
      messageId: 'msg-1',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://discord.com/api/v10/channels/chan-1/messages');
    expect(init.headers).toMatchObject({ authorization: 'Bot token' });
    expect(JSON.parse(String(init.body))).toEqual({ content: 'hello' });
  });

  it('surfaces platform failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })),
    );
    await expect(sendDiscordMessage('token', 'chan-1', 'hello')).rejects.toThrow('Discord create message 403');
  });

  it('does not start without an allowed/default channel', () => {
    const logs: string[] = [];
    const stop = startDiscord({
      token: 'token',
      model: 'test',
      allowedChannelIds: [],
      onLog: (m) => logs.push(m),
      webSocketFactory: () => {
        throw new Error('should not open');
      },
    });
    stop();
    expect(logs.join('\n')).toContain('Discord ไม่เริ่ม');
  });

  it('opens a gateway websocket when configured', () => {
    const sent: string[] = [];
    const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
    const ws = {
      send: (data: string) => sent.push(data),
      close: vi.fn(),
      addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => {
        listeners[type] ??= [];
        listeners[type].push(listener);
      },
    };
    const stop = startDiscord({
      token: 'token',
      model: 'test',
      defaultChannelId: 'chan-1',
      webSocketFactory: () => ws,
    });

    listeners.message?.[0]?.({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } }) });
    expect(JSON.parse(sent[0])).toMatchObject({ op: 2, d: { token: 'token' } });
    stop();
    expect(ws.close).toHaveBeenCalledOnce();
  });
});
