import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverToTarget } from './deliver.js';

const CLEAN_ENV = {} as NodeJS.ProcessEnv;

type WeComSocketListener = (event: { data?: string }) => void;

class MockWeComWebSocket {
  static instances: MockWeComWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Set<WeComSocketListener>>();

  constructor(readonly url: string) {
    MockWeComWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  addEventListener(type: string, listener: WeComSocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set<WeComSocketListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WeComSocketListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
    const payload = JSON.parse(data) as { cmd?: string; headers?: { req_id?: string } };
    queueMicrotask(() => {
      this.emit('message', {
        data: JSON.stringify({ cmd: payload.cmd, headers: { req_id: payload.headers?.req_id }, body: { errcode: 0 } }),
      });
    });
  }

  close(): void {
    this.readyState = 3;
  }

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  MockWeComWebSocket.instances = [];
});

describe('gateway delivery helper', () => {
  it('delivers to the default Telegram allowed chat', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('telegram', 'hello', {
        config: { telegram: { botToken: '123:abc', allowedChatIds: [111] } },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({ platform: 'telegram', target: 'telegram:111', chatId: 111, messageId: 42 });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: 111, text: 'hello' });
  });

  it('delivers to a Slack thread and returns the resolved target', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, channel: 'C01ABC', ts: '1718584242.000100' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('slack:C01ABC:1718584000.000001', 'deploy finished', {
        config: { slack: { botToken: 'xoxb-token', allowedChannelIds: ['C01ABC'] } },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'slack',
      target: 'slack:C01ABC:1718584000.000001',
      channelId: 'C01ABC',
      messageTs: '1718584242.000100',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      channel: 'C01ABC',
      text: 'deploy finished',
      thread_ts: '1718584000.000001',
    });
  });

  it('rejects targets outside configured allowlists before sending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('discord:222', 'hello', {
        config: { discord: { botToken: 'discord-token', allowedChannelIds: ['111'] } },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('ไม่อยู่ใน allowlist');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delivers to the configured LINE home channel', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('line', 'hello line', {
        config: {
          line: {
            channelAccessToken: 'line-token',
            homeChannel: 'U1234567890abcdef',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'line',
      target: 'line:U1234567890abcdef',
      to: 'U1234567890abcdef',
      messageCount: 1,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: 'U1234567890abcdef',
      messages: [{ type: 'text', text: 'hello line' }],
    });
  });

  it('delivers to the configured SMS home number', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 201,
      json: async () => ({ sid: 'SM123' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('sms', 'hello sms', {
        config: {
          sms: {
            accountSid: 'AC123',
            authToken: 'twilio-token',
            phoneNumber: '+15550000000',
            homeChannel: '+15551234567',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'sms',
      target: 'sms:+15551234567',
      to: '+15551234567',
      messageCount: 1,
      messageIds: ['SM123'],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    const body = init.body as URLSearchParams;
    expect(body.get('From')).toBe('+15550000000');
    expect(body.get('To')).toBe('+15551234567');
    expect(body.get('Body')).toBe('hello sms');
  });

  it('delivers to the configured ntfy home topic', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'ntfy-message-1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('ntfy', 'hello ntfy', {
        config: {
          ntfy: {
            serverUrl: 'https://ntfy.example.com',
            topic: 'sanook-topic',
            homeChannel: 'sanook-topic',
            allowedUsers: ['sanook-topic'],
            token: 'tk_secret',
            markdown: true,
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'ntfy',
      target: 'ntfy:sanook-topic',
      topic: 'sanook-topic',
      messageId: 'ntfy-message-1',
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ntfy.example.com/sanook-topic');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer tk_secret',
      markdown: 'yes',
    });
    expect(init.body).toBe('hello ntfy');
  });

  it('delivers to the configured Signal home channel', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { timestamp: 1718584242000 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('signal', 'hello signal', {
        config: {
          signal: {
            httpUrl: 'http://127.0.0.1:8080',
            account: '+15550000000',
            homeChannel: '+15551234567',
            allowedUsers: ['+15551234567'],
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'signal',
      target: 'signal:+15551234567',
      to: '+15551234567',
      messageCount: 1,
      messageIds: ['1718584242000'],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8080/api/v1/rpc');
    expect(JSON.parse(String(init.body))).toMatchObject({
      method: 'send',
      params: {
        account: '+15550000000',
        recipient: ['+15551234567'],
        message: 'hello signal',
      },
    });
  });

  it('delivers Signal group targets when the group is allowlisted', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { timestamp: 2 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('signal:group:group-1', 'hello group', {
        config: {
          signal: {
            httpUrl: 'http://127.0.0.1:8080',
            account: '+15550000000',
            groupAllowedUsers: ['group:group-1'],
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'signal',
      target: 'signal:group:group-1',
      to: 'group:group-1',
      messageIds: ['2'],
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      params: {
        account: '+15550000000',
        groupId: 'group-1',
        message: 'hello group',
      },
    });
  });

  it('delivers to the configured WhatsApp Cloud home channel', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.out.1' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('whatsapp', 'hello whatsapp', {
        config: {
          whatsapp: {
            phoneNumberId: '123456789012345',
            accessToken: 'EAA-wa-token',
            homeChannel: '15551234567',
            allowedUsers: ['15551234567'],
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'whatsapp',
      target: 'whatsapp:15551234567',
      to: '15551234567',
      messageCount: 1,
      messageIds: ['wamid.out.1'],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v20.0/123456789012345/messages');
    expect(init.headers).toMatchObject({ authorization: 'Bearer EAA-wa-token' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      messaging_product: 'whatsapp',
      to: '15551234567',
      text: { body: 'hello whatsapp' },
    });
  });

  it('delivers to the configured Matrix home room', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ event_id: '$matrix.out.1' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('matrix', 'hello matrix', {
        config: {
          matrix: {
            homeserver: 'https://matrix.example.org',
            accessToken: 'matrix-token',
            homeRoom: '!home:matrix.example.org',
            allowedUsers: ['@alice:matrix.org'],
            allowedRooms: ['!home:matrix.example.org'],
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'matrix',
      target: 'matrix:!home:matrix.example.org',
      to: '!home:matrix.example.org',
      messageCount: 1,
      messageIds: ['$matrix.out.1'],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/matrix\.example\.org\/_matrix\/client\/v3\/rooms\/!home%3Amatrix\.example\.org\/send\/m\.room\.message\//);
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer matrix-token');
    expect(JSON.parse(String(init.body))).toEqual({ msgtype: 'm.text', body: 'hello matrix' });
  });

  it('requires a Matrix home room or allowed room unless all rooms are explicitly allowed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('matrix:!outside:matrix.example.org', 'hello matrix', {
        config: {
          matrix: {
            homeserver: 'https://matrix.example.org',
            accessToken: 'matrix-token',
          },
        },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('fail-closed');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delivers to a configured Mattermost channel and optional root post thread', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ id: 'post-out-1', channel_id: 'chan-home' })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('mattermost:chan-home:root-post-1', 'hello mattermost', {
        config: {
          mattermost: {
            serverUrl: 'https://mm.example.com',
            token: 'mattermost-token',
            homeChannel: 'chan-home',
            allowedUsers: ['user-1'],
            allowedChannels: ['chan-home'],
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'mattermost',
      target: 'mattermost:chan-home:root-post-1',
      channelId: 'chan-home',
      messageCount: 1,
      messageIds: ['post-out-1'],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mm.example.com/api/v4/posts');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer mattermost-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      channel_id: 'chan-home',
      message: 'hello mattermost',
      root_id: 'root-post-1',
    });
  });

  it('delivers to Home Assistant as a persistent notification', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('homeassistant:doorbell', 'hello home', {
        config: {
          homeassistant: {
            url: 'http://ha.local:8123',
            token: 'hass-token',
            homeChannel: 'sanook_agent',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'homeassistant',
      target: 'homeassistant:doorbell',
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ha.local:8123/api/services/persistent_notification/create');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer hass-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      title: 'Sanook',
      message: 'hello home',
      notification_id: 'doorbell',
    });
  });

  it('delivers to Microsoft Teams incoming webhooks', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('1'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('teams', 'hello teams', {
        config: {
          teams: {
            deliveryMode: 'incoming_webhook',
            incomingWebhookUrl: 'https://example.webhook.office.com/webhookb2/id',
            homeChannel: 'webhook',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'teams',
      target: 'teams',
      to: 'webhook',
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.webhook.office.com/webhookb2/id');
    expect(JSON.parse(String(init.body))).toEqual({ text: 'hello teams' });
  });

  it('delivers to configured Feishu/Lark home chats', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { message_id: 'om_message_1' } })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('feishu', 'hello feishu', {
        config: {
          feishu: {
            domain: 'feishu',
            appId: 'cli_app',
            appSecret: 'feishu-secret',
            homeChannel: 'oc_home',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'feishu',
      target: 'feishu:oc_home',
      to: 'oc_home',
      messageIds: ['om_message_1'],
      messageCount: 1,
    });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal');
    expect(JSON.parse(String(tokenInit.body))).toEqual({ app_id: 'cli_app', app_secret: 'feishu-secret' });
    const [messageUrl, messageInit] = fetchMock.mock.calls[1];
    expect(messageUrl).toBe('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id');
    expect(messageInit.headers).toMatchObject({ authorization: 'Bearer tenant-token' });
    expect(JSON.parse(String(messageInit.body))).toEqual({
      receive_id: 'oc_home',
      msg_type: 'text',
      content: JSON.stringify({ text: 'hello feishu' }),
    });
  });

  it('rejects Feishu/Lark chat targets outside the configured allowlist before sending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('lark:oc_other', 'hello lark', {
        config: {
          feishu: {
            domain: 'lark',
            appId: 'cli_app',
            appSecret: 'feishu-secret',
            homeChannel: 'oc_home',
            allowedChats: ['oc_home'],
          },
        },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('ไม่อยู่ใน allowlist');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delivers to configured DingTalk OpenAPI home chats', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'ding-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ processQueryKey: 'query-1' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('dingtalk', 'hello dingtalk', {
        config: {
          dingtalk: {
            clientId: 'ding-client',
            clientSecret: 'ding-secret',
            robotCode: 'ding-robot',
            homeChannel: 'cid-home',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'dingtalk',
      target: 'dingtalk:cid-home',
      to: 'cid-home',
      messageIds: ['query-1'],
      messageCount: 1,
    });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe('https://api.dingtalk.com/v1.0/oauth2/accessToken');
    expect(JSON.parse(String(tokenInit.body))).toEqual({ appKey: 'ding-client', appSecret: 'ding-secret' });
    const [messageUrl, messageInit] = fetchMock.mock.calls[1];
    expect(messageUrl).toBe('https://api.dingtalk.com/v1.0/robot/groupMessages/send');
    expect(messageInit.headers).toMatchObject({ 'x-acs-dingtalk-access-token': 'ding-token' });
    expect(JSON.parse(String(messageInit.body))).toMatchObject({
      robotCode: 'ding-robot',
      openConversationId: 'cid-home',
      msgKey: 'sampleMarkdown',
    });
  });

  it('delivers to configured DingTalk custom robot webhooks', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('dingtalk', 'hello webhook', {
        config: {
          dingtalk: {
            webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=abc',
            webhookSecret: 'ding-webhook-secret',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'dingtalk',
      target: 'dingtalk',
      to: 'webhook',
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://oapi.dingtalk.com/robot/send?access_token=abc');
    expect(String(url)).toContain('timestamp=');
    expect(String(url)).toContain('sign=');
    expect(JSON.parse(String(init.body))).toEqual({
      msgtype: 'markdown',
      markdown: { title: 'Sanook', text: 'hello webhook' },
    });
  });

  it('rejects DingTalk targets outside configured allowlists before sending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('dingtalk:cid-other', 'hello dingtalk', {
        config: {
          dingtalk: {
            clientId: 'ding-client',
            clientSecret: 'ding-secret',
            robotCode: 'ding-robot',
            homeChannel: 'cid-home',
            allowedChats: ['cid-home'],
          },
        },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('ไม่อยู่ใน allowlist');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delivers to configured Google Chat incoming webhooks', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ name: 'spaces/AAAA/messages/msg-1' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('gchat', 'hello google chat', {
        config: {
          googleChat: {
            incomingWebhookUrl: 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t',
            homeChannel: 'webhook',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'googlechat',
      target: 'googlechat',
      to: 'webhook',
      messageIds: ['spaces/AAAA/messages/msg-1'],
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t');
    expect(JSON.parse(String(init.body))).toEqual({ text: 'hello google chat' });
  });

  it('rejects Google Chat spaces outside configured allowlists before sending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('googlechat:spaces/OTHER', 'hello google chat', {
        config: {
          googleChat: {
            serviceAccountJson: '/tmp/google-chat-sa.json',
            homeChannel: 'spaces/HOME',
            allowedSpaces: ['spaces/HOME'],
          },
        },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('ไม่อยู่ใน allowlist');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delivers to configured BlueBubbles iMessage targets', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/api/v1/chat/query')) {
        return new Response(
          JSON.stringify({
            status: 200,
            data: [{ guid: 'iMessage;-;user@example.com', chatIdentifier: 'user@example.com' }],
          }),
        );
      }
      expect(String(url)).toBe('http://localhost:1234/api/v1/message/text?password=bb-secret');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        chatGuid: 'iMessage;-;user@example.com',
        message: 'hello bluebubbles',
      });
      return new Response(JSON.stringify({ status: 200, data: { guid: 'msg-bb-1' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('imessage', 'hello bluebubbles', {
        config: {
          bluebubbles: {
            serverUrl: 'http://localhost:1234',
            password: 'bb-secret',
            homeChannel: 'user@example.com',
            allowedUsers: ['user@example.com'],
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'bluebubbles',
      target: 'bluebubbles:user@example.com',
      to: 'user@example.com',
      messageIds: ['msg-bb-1'],
      messageCount: 1,
    });
  });

  it('normalizes BlueBubbles chat prefixes before checking delivery allowlists', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('http://localhost:1234/api/v1/message/text?password=bb-secret');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        chatGuid: 'iMessage;-;user@example.com',
        message: 'hello prefixed bluebubbles',
      });
      return new Response(JSON.stringify({ status: 200, data: { guid: 'msg-bb-prefixed' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('bluebubbles:chat/iMessage;-;user@example.com', 'hello prefixed bluebubbles', {
        config: {
          bluebubbles: {
            serverUrl: 'http://localhost:1234',
            password: 'bb-secret',
            allowedUsers: ['iMessage;-;user@example.com'],
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'bluebubbles',
      target: 'bluebubbles:iMessage;-;user@example.com',
      to: 'iMessage;-;user@example.com',
      messageIds: ['msg-bb-prefixed'],
      messageCount: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects BlueBubbles targets outside configured allowlists before sending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('bluebubbles:other@example.com', 'hello bluebubbles', {
        config: {
          bluebubbles: {
            serverUrl: 'http://localhost:1234',
            password: 'bb-secret',
            homeChannel: 'user@example.com',
            allowedUsers: ['user@example.com'],
          },
        },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('ไม่อยู่ใน allowlist');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delivers to configured WeCom AI Bot targets', async () => {
    vi.stubGlobal('WebSocket', MockWeComWebSocket);

    await expect(
      deliverToTarget('wecom:user/user-1', 'hello wecom', {
        config: {
          wecom: {
            botId: 'bot-1',
            secret: 'wecom-secret',
            homeChannel: 'user-1',
            allowedUsers: ['user-1'],
            dmPolicy: 'allowlist',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'wecom',
      target: 'wecom:user/user-1',
      to: 'user/user-1',
      messageCount: 1,
    });

    const socket = MockWeComWebSocket.instances[0];
    expect(socket.url).toBe('wss://openws.work.weixin.qq.com');
    expect(JSON.parse(socket.sent[0])).toMatchObject({ cmd: 'aibot_subscribe', body: { bot_id: 'bot-1' } });
    expect(JSON.parse(socket.sent[1])).toMatchObject({
      cmd: 'aibot_send_msg',
      body: { chatid: 'user-1', msgtype: 'markdown', markdown: { content: 'hello wecom' } },
    });
  });

  it('rejects WeCom targets outside configured allowlists before opening WebSocket', async () => {
    vi.stubGlobal('WebSocket', MockWeComWebSocket);

    await expect(
      deliverToTarget('wecom:user/other-user', 'hello wecom', {
        config: {
          wecom: {
            botId: 'bot-1',
            secret: 'wecom-secret',
            homeChannel: 'user-1',
            allowedUsers: ['user-1'],
            dmPolicy: 'allowlist',
          },
        },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('ไม่อยู่ใน allowlist');

    expect(MockWeComWebSocket.instances).toHaveLength(0);
  });

  it('delivers to configured Weixin iLink targets', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ret: 0 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('weixin:user/user-1', 'hello weixin', {
        config: {
          weixin: {
            accountId: 'wx-account-1',
            token: 'wx-token',
            homeChannel: 'user/user-1',
            allowedUsers: ['user-1'],
            dmPolicy: 'allowlist',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'weixin',
      target: 'weixin:user/user-1',
      to: 'user-1',
      messageCount: 1,
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://ilinkai.weixin.qq.com/ilink/bot/sendmessage');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      msg: {
        to_user_id: 'user-1',
        item_list: [{ type: 1, text_item: { text: 'hello weixin' } }],
      },
    });
  });

  it('rejects Weixin targets outside configured allowlists before sending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('weixin:user/other-user', 'hello weixin', {
        config: {
          weixin: {
            accountId: 'wx-account-1',
            token: 'wx-token',
            homeChannel: 'user/user-1',
            allowedUsers: ['user-1'],
            dmPolicy: 'allowlist',
          },
        },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('ไม่อยู่ใน allowlist');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires Yuanbao credentials before attempting delivery', async () => {
    await expect(
      deliverToTarget('yuanbao:direct/user-1', 'hello yuanbao', {
        config: {},
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('gateway setup yuanbao');
  });

  it('marks Yuanbao direct delivery pending until WebSocket/protobuf parity is implemented', async () => {
    await expect(
      deliverToTarget('yuanbao:direct/user-1', 'hello yuanbao', {
        config: {
          yuanbao: {
            appId: 'yb-app-1',
            appSecret: 'yb-secret',
            homeChannel: 'direct:user-1',
            allowedUsers: ['user-1'],
            dmPolicy: 'allowlist',
          },
        },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('WebSocket + protobuf dispatch parity');
  });

  it('delivers to configured QQBot official API targets', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'qq-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'qq-msg-1' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('qqbot:user/openid-1', 'hello qqbot', {
        config: {
          qqbot: {
            appId: 'app-1',
            clientSecret: 'qq-secret',
            homeChannel: 'user/openid-1',
            allowedUsers: ['openid-1'],
            dmPolicy: 'allowlist',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'qqbot',
      target: 'qqbot:user/openid-1',
      to: 'user/openid-1',
      messageIds: ['qq-msg-1'],
      messageCount: 1,
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://bots.qq.com/app/getAppAccessToken');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.sgroup.qq.com/v2/users/openid-1/messages');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      content: 'hello qqbot',
      msg_type: 0,
    });
  });

  it('rejects QQBot targets outside configured allowlists before fetching a token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('qqbot:user/other-openid', 'hello qqbot', {
        config: {
          qqbot: {
            appId: 'app-1',
            clientSecret: 'qq-secret',
            homeChannel: 'user/openid-1',
            allowedUsers: ['openid-1'],
            dmPolicy: 'allowlist',
          },
        },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('ไม่อยู่ใน allowlist');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not let a QQBot C2C home channel authorize same-valued guild delivery', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('qqbot:guild/channel-1', 'hello qqbot', {
        config: {
          qqbot: {
            appId: 'app-1',
            clientSecret: 'qq-secret',
            homeChannel: 'user/channel-1',
          },
        },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('allowed channels');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delivers to Microsoft Teams Graph chat targets', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: 'teams-message-1' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverToTarget('teams:19:chatid@thread.v2', 'hello graph', {
        config: {
          teams: {
            deliveryMode: 'graph',
            graphAccessToken: 'graph-token',
            chatId: '19:home@thread.v2',
          },
        },
        env: CLEAN_ENV,
      }),
    ).resolves.toMatchObject({
      platform: 'teams',
      target: 'teams:19:chatid@thread.v2',
      to: '19:chatid@thread.v2',
      messageId: 'teams-message-1',
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.microsoft.com/v1.0/chats/19%3Achatid%40thread.v2/messages');
    expect(init.headers).toMatchObject({ authorization: 'Bearer graph-token' });
  });

  it('requires an email recipient or configured home address', async () => {
    await expect(
      deliverToTarget('email', 'hello', {
        config: { email: { address: 'bot@example.com', password: 'email-password', smtpHost: 'smtp.example.com' } },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('recipient');
  });
});
