import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendSlackMessage, startSlack } from './slack.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('slack send adapter', () => {
  it('posts a message with bearer auth and optional thread ts', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, channel: 'C01ABC', ts: '1718584242.000100' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendSlackMessage('xoxb-token', 'C01ABC', 'hello', '1718584000.000001')).resolves.toEqual({
      channelId: 'C01ABC',
      messageTs: '1718584242.000100',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(init.headers).toMatchObject({ authorization: 'Bearer xoxb-token' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      channel: 'C01ABC',
      text: 'hello',
      thread_ts: '1718584000.000001',
    });
  });

  it('surfaces Slack API errors even with HTTP 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'channel_not_found' }) })),
    );
    await expect(sendSlackMessage('xoxb-token', 'C01ABC', 'hello')).rejects.toThrow(
      'Slack chat.postMessage error: channel_not_found',
    );
  });

  it('does not start without an allowed/default channel', async () => {
    const logs: string[] = [];
    const stop = await startSlack({
      botToken: 'xoxb-token',
      appToken: 'xapp-token',
      model: 'test',
      allowedChannelIds: [],
      onLog: (m) => logs.push(m),
      webSocketFactory: () => {
        throw new Error('should not open');
      },
    });
    stop();
    expect(logs.join('\n')).toContain('Slack ไม่เริ่ม');
  });

  it('opens Slack Socket Mode websocket through apps.connections.open', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://slack.com/api/apps.connections.open') {
        return { ok: true, status: 200, json: async () => ({ ok: true, url: 'wss://slack-socket.test' }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
    const sent: string[] = [];
    const ws = {
      send: (data: string) => sent.push(data),
      close: vi.fn(),
      addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => {
        listeners[type] ??= [];
        listeners[type].push(listener);
      },
    };
    const stop = await startSlack({
      botToken: 'xoxb-token',
      appToken: 'xapp-token',
      model: 'test',
      defaultChannelId: 'C01ABC',
      webSocketFactory: (url) => {
        expect(url).toBe('wss://slack-socket.test');
        return ws;
      },
    });
    listeners.message?.[0]?.({ data: JSON.stringify({ envelope_id: 'env-1', type: 'hello' }) });
    expect(sent).toEqual([JSON.stringify({ envelope_id: 'env-1' })]);
    stop();
    expect(ws.close).toHaveBeenCalledOnce();
  });
});
