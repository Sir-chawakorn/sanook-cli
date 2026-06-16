import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedFeishuConfig } from './config.js';
import {
  chunkFeishuText,
  feishuApiUrl,
  feishuTenantAccessToken,
  normalizeFeishuBaseUrl,
  normalizeFeishuDomain,
  sendFeishuMessage,
} from './feishu.js';

function config(overrides: Partial<ResolvedFeishuConfig> = {}): ResolvedFeishuConfig {
  return {
    domain: 'feishu',
    baseUrl: 'https://open.feishu.cn',
    appId: 'cli_app',
    appSecret: 'app-secret',
    homeChannel: 'oc_home',
    allowedChats: ['oc_home'],
    allowAllChats: false,
    allowedUsers: [],
    allowAllUsers: false,
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Feishu/Lark gateway adapter', () => {
  it('normalizes domains, base URLs, and API URLs', () => {
    expect(normalizeFeishuDomain(undefined)).toBe('feishu');
    expect(normalizeFeishuDomain('lark')).toBe('lark');
    expect(normalizeFeishuDomain('global')).toBe('lark');
    expect(normalizeFeishuDomain('other')).toBeUndefined();
    expect(normalizeFeishuBaseUrl(undefined, 'lark')).toBe('https://open.larksuite.com');
    expect(normalizeFeishuBaseUrl('http://open.feishu.cn')).toBeUndefined();
    expect(feishuApiUrl(config({ domain: 'lark', baseUrl: 'https://open.larksuite.com/' }), '/open-apis/im/v1/messages', {
      receive_id_type: 'chat_id',
    })).toBe('https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id');
  });

  it('fetches a tenant access token with app credentials', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(feishuTenantAccessToken(config())).resolves.toBe('tenant-token');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal');
    expect(JSON.parse(String(init.body))).toEqual({ app_id: 'cli_app', app_secret: 'app-secret' });
  });

  it('sends text messages to chat_id targets', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { message_id: 'om_message_1' } })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendFeishuMessage(config(), 'oc_home', 'hello feishu')).resolves.toEqual({
      chatId: 'oc_home',
      messageIds: ['om_message_1'],
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id');
    expect(init.headers).toMatchObject({ authorization: 'Bearer tenant-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      receive_id: 'oc_home',
      msg_type: 'text',
      content: JSON.stringify({ text: 'hello feishu' }),
    });
  });

  it('chunks long text conservatively for Feishu/Lark text payloads', async () => {
    expect(chunkFeishuText('')).toEqual(['(ไม่มีผลลัพธ์)']);
    expect(chunkFeishuText('a'.repeat(4_001)).map((chunk) => chunk.length)).toEqual([4_000, 1]);
  });

  it('redacts failed API responses', async () => {
    const rawSecret = 'sk-test1234567890abcdef';
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ code: 99991663, msg: `bad ${rawSecret} value` })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(feishuTenantAccessToken(config())).rejects.toThrow('Feishu/Lark tenant access token code 99991663');
    await expect(feishuTenantAccessToken(config())).rejects.not.toThrow(rawSecret);
    await expect(feishuTenantAccessToken(config())).rejects.not.toThrow('app-secret');
  });
});
