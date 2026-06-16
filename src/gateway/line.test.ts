import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  handleLineWebhook,
  isAllowedLineSource,
  replyLineMessage,
  sendLineMessage,
  verifyLineSignature,
} from './line.js';

const h = vi.hoisted(() => ({
  runGatewayAgent: vi.fn(),
}));

vi.mock('./session.js', () => ({
  runGatewayAgent: h.runGatewayAgent,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  h.runGatewayAgent.mockReset();
});

describe('LINE send adapter', () => {
  it('pushes a text message with bearer auth', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendLineMessage('line-token', 'U1234567890abcdef', 'hello')).resolves.toEqual({
      to: 'U1234567890abcdef',
      messageCount: 1,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(init.headers).toMatchObject({ authorization: 'Bearer line-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      to: 'U1234567890abcdef',
      messages: [{ type: 'text', text: 'hello' }],
    });
  });

  it('chunks long LINE text messages within push limits', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendLineMessage('line-token', 'U123', 'x'.repeat(12_001))).resolves.toEqual({
      to: 'U123',
      messageCount: 3,
    });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init.body)) as { messages: { text: string }[] };
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0].text).toHaveLength(5000);
    expect(body.messages[1].text).toHaveLength(5000);
    expect(body.messages[2].text).toHaveLength(2001);
  });

  it('surfaces LINE API failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );
    await expect(sendLineMessage('bad-token', 'U123', 'hello')).rejects.toThrow('LINE push message 401');
  });

  it('replies with a reply token through the reply endpoint', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(replyLineMessage('line-token', 'reply-token', 'hello')).resolves.toEqual({
      to: 'reply-token',
      messageCount: 1,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(JSON.parse(String(init.body))).toEqual({
      replyToken: 'reply-token',
      messages: [{ type: 'text', text: 'hello' }],
    });
  });
});

describe('LINE webhook adapter', () => {
  const config = {
    channelAccessToken: 'line-token',
    channelSecret: 'line-secret',
    homeChannel: 'U1234567890abcdef',
    allowedUsers: ['U1234567890abcdef'],
    allowedGroups: ['C1234567890abcdef'],
    allowedRooms: [],
    allowAllUsers: false,
    enabled: true,
    source: 'config' as const,
  };

  function signature(raw: string): string {
    return createHmac('sha256', config.channelSecret).update(raw).digest('base64');
  }

  function eventBody(source = { type: 'user', userId: 'U1234567890abcdef' }): string {
    return JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-token',
          source,
          message: { type: 'text', text: 'hello from line' },
        },
      ],
    });
  }

  it('verifies LINE webhook signatures with HMAC-SHA256', () => {
    const raw = eventBody();
    expect(verifyLineSignature(config.channelSecret, raw, signature(raw))).toBe(true);
    expect(verifyLineSignature(config.channelSecret, raw, 'bad-signature')).toBe(false);
  });

  it('checks LINE source allowlists by source type', () => {
    expect(isAllowedLineSource(config, { type: 'user', userId: 'U1234567890abcdef' })).toBe(true);
    expect(isAllowedLineSource(config, { type: 'group', groupId: 'C1234567890abcdef' })).toBe(true);
    expect(isAllowedLineSource(config, { type: 'user', userId: 'Uother' })).toBe(false);
  });

  it('runs the gateway agent and replies to authorized LINE text messages', async () => {
    const raw = eventBody();
    h.runGatewayAgent.mockResolvedValue({ text: 'agent reply', suppressDelivery: false, messages: [] });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      handleLineWebhook({
        rawBody: raw,
        signature: signature(raw),
        config,
        model: 'test:model',
      }),
    ).resolves.toEqual({ status: 200, body: { ok: true, accepted: 1, ignored: 0 } });

    expect(h.runGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'line',
        target: 'U1234567890abcdef',
        model: 'test:model',
        prompt: expect.stringContaining('hello from line'),
      }),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(JSON.parse(String(init.body))).toMatchObject({
      replyToken: 'reply-token',
      messages: [{ type: 'text', text: 'agent reply' }],
    });
  });

  it('rejects invalid webhook signatures before running the agent', async () => {
    await expect(
      handleLineWebhook({
        rawBody: eventBody(),
        signature: 'bad',
        config,
        model: 'test:model',
      }),
    ).resolves.toEqual({ status: 401, body: { error: 'invalid_signature' } });
    expect(h.runGatewayAgent).not.toHaveBeenCalled();
  });

  it('ignores unauthorized sources and replies with a generic denial', async () => {
    const raw = eventBody({ type: 'user', userId: 'Uother' });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      handleLineWebhook({
        rawBody: raw,
        signature: signature(raw),
        config,
        model: 'test:model',
      }),
    ).resolves.toEqual({ status: 200, body: { ok: true, accepted: 0, ignored: 1 } });
    expect(h.runGatewayAgent).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
