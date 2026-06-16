import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedDingTalkConfig } from './config.js';
import {
  chunkDingTalkText,
  dingTalkAccessToken,
  dingtalkApiUrl,
  dingtalkSignedWebhookUrl,
  normalizeDingTalkApiBaseUrl,
  normalizeDingTalkWebhookUrl,
  parseDingTalkTarget,
  sendDingTalkMessage,
} from './dingtalk.js';

function config(overrides: Partial<ResolvedDingTalkConfig> = {}): ResolvedDingTalkConfig {
  return {
    clientId: 'ding-app-key',
    clientSecret: 'ding-secret',
    robotCode: 'ding-robot',
    apiBaseUrl: 'https://api.dingtalk.com',
    homeChannel: 'cid-home',
    homeChannelName: 'Owner DingTalk',
    allowedUsers: ['manager'],
    allowedChats: ['cid-home'],
    freeResponseChats: [],
    allowAllUsers: false,
    allowAllChats: false,
    requireMention: true,
    groupSessionsPerUser: true,
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DingTalk gateway adapter', () => {
  it('normalizes URLs and signs custom robot webhooks', () => {
    expect(normalizeDingTalkApiBaseUrl(undefined)).toBe('https://api.dingtalk.com');
    expect(normalizeDingTalkApiBaseUrl('http://api.dingtalk.com')).toBeUndefined();
    expect(normalizeDingTalkWebhookUrl('https://oapi.dingtalk.com/robot/send?access_token=abc')).toBe(
      'https://oapi.dingtalk.com/robot/send?access_token=abc',
    );
    expect(normalizeDingTalkWebhookUrl('http://oapi.dingtalk.com/robot/send')).toBeUndefined();
    expect(dingtalkApiUrl(config(), '/v1.0/oauth2/accessToken')).toBe('https://api.dingtalk.com/v1.0/oauth2/accessToken');

    const signed = new URL(dingtalkSignedWebhookUrl('https://oapi.dingtalk.com/robot/send?access_token=abc', 'top-secret', 1718584242000));
    expect(signed.searchParams.get('timestamp')).toBe('1718584242000');
    expect(signed.searchParams.get('sign')).toBeTruthy();
  });

  it('parses conversation, user, and webhook targets', () => {
    expect(parseDingTalkTarget(config(), undefined)).toEqual({ type: 'conversation', value: 'cid-home' });
    expect(parseDingTalkTarget(config(), 'user/manager')).toEqual({ type: 'user', value: 'manager' });
    expect(parseDingTalkTarget(config(), 'conversation/cid-ops')).toEqual({ type: 'conversation', value: 'cid-ops' });
    expect(parseDingTalkTarget(config({ webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=abc' }), 'webhook')).toEqual({
      type: 'webhook',
      value: 'https://oapi.dingtalk.com/robot/send?access_token=abc',
    });
    expect(parseDingTalkTarget(config({ homeChannel: undefined, webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=abc' }))).toEqual({
      type: 'webhook',
      value: 'https://oapi.dingtalk.com/robot/send?access_token=abc',
    });
  });

  it('fetches OpenAPI access tokens with Hermes-style credentials', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ accessToken: 'ding-token', expireIn: 7200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(dingTalkAccessToken(config())).resolves.toBe('ding-token');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.dingtalk.com/v1.0/oauth2/accessToken');
    expect(JSON.parse(String(init.body))).toEqual({ appKey: 'ding-app-key', appSecret: 'ding-secret' });
  });

  it('sends OpenAPI markdown messages to group conversations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'ding-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ processQueryKey: 'query-1' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendDingTalkMessage(config(), 'hello ding')).resolves.toEqual({
      mode: 'openapi',
      target: 'cid-home',
      messageIds: ['query-1'],
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.dingtalk.com/v1.0/robot/groupMessages/send');
    expect(init.headers).toMatchObject({ 'x-acs-dingtalk-access-token': 'ding-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      robotCode: 'ding-robot',
      openConversationId: 'cid-home',
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({ title: 'Owner DingTalk', text: 'hello ding' }),
    });
  });

  it('sends OpenAPI markdown messages to users', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'ding-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ processQueryKey: 'query-user-1' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendDingTalkMessage(config(), 'hello user', 'user/manager')).resolves.toMatchObject({
      mode: 'openapi',
      target: 'user/manager',
      messageIds: ['query-user-1'],
    });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend');
    expect(JSON.parse(String(init.body))).toMatchObject({ robotCode: 'ding-robot', userIds: ['manager'] });
  });

  it('sends custom robot webhook markdown messages', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendDingTalkMessage(
        config({ webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=abc', webhookSecret: 'top-secret', homeChannel: 'webhook' }),
        'hello webhook',
      ),
    ).resolves.toMatchObject({ mode: 'webhook', target: 'webhook', messageCount: 1 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://oapi.dingtalk.com/robot/send?access_token=abc');
    expect(String(url)).toContain('timestamp=');
    expect(String(url)).toContain('sign=');
    expect(JSON.parse(String(init.body))).toEqual({
      msgtype: 'markdown',
      markdown: { title: 'Owner DingTalk', text: 'hello webhook' },
    });
  });

  it('chunks long markdown text and redacts failed responses', async () => {
    expect(chunkDingTalkText('')).toEqual(['(ไม่มีผลลัพธ์)']);
    expect(chunkDingTalkText('a'.repeat(4_001)).map((chunk) => chunk.length)).toEqual([4_000, 1]);

    const rawSecret = 'ding-secret';
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ code: 'InvalidSecret', message: `bad ${rawSecret}` })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(dingTalkAccessToken(config({ clientSecret: rawSecret }))).rejects.toThrow('DingTalk access token code InvalidSecret');
    await expect(dingTalkAccessToken(config({ clientSecret: rawSecret }))).rejects.not.toThrow(rawSecret);
  });
});
