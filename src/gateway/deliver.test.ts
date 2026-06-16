import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverToTarget } from './deliver.js';

const CLEAN_ENV = {} as NodeJS.ProcessEnv;

afterEach(() => {
  vi.unstubAllGlobals();
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

  it('requires an email recipient or configured home address', async () => {
    await expect(
      deliverToTarget('email', 'hello', {
        config: { email: { address: 'bot@example.com', password: 'email-password', smtpHost: 'smtp.example.com' } },
        env: CLEAN_ENV,
      }),
    ).rejects.toThrow('recipient');
  });
});
