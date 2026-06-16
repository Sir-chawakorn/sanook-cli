import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedTeamsConfig } from './config.js';
import {
  normalizeTeamsWebhookUrl,
  sendTeamsMessage,
  teamsGraphAuthHeaders,
  teamsGraphHtml,
  teamsGraphMessageUrl,
  truncateTeamsText,
} from './teams.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function config(overrides: Partial<ResolvedTeamsConfig> = {}): ResolvedTeamsConfig {
  return {
    deliveryMode: 'incoming_webhook',
    incomingWebhookUrl: 'https://example.webhook.office.com/webhookb2/id',
    graphAccessToken: undefined,
    teamId: undefined,
    channelId: undefined,
    chatId: undefined,
    homeChannel: 'webhook',
    homeChannelName: 'Teams',
    clientId: undefined,
    clientSecret: undefined,
    tenantId: undefined,
    allowedUsers: [],
    allowAllUsers: false,
    port: 3978,
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

describe('Microsoft Teams gateway adapter', () => {
  it('normalizes webhook URLs, formats Graph HTML, and builds auth headers', () => {
    expect(normalizeTeamsWebhookUrl(' https://example.webhook.office.com/webhookb2/id ')).toBe(
      'https://example.webhook.office.com/webhookb2/id',
    );
    expect(normalizeTeamsWebhookUrl('http://example.com/webhook')).toBeUndefined();
    expect(truncateTeamsText('')).toBe('(ไม่มีผลลัพธ์)');
    expect(teamsGraphHtml('hello <teams>\nnext')).toBe('hello &lt;teams&gt;<br>next');
    expect(teamsGraphAuthHeaders(' token ')).toEqual({ authorization: 'Bearer token' });
  });

  it('sends incoming webhook payloads with plain text', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('1'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendTeamsMessage(config(), 'hello teams')).resolves.toEqual({
      mode: 'incoming_webhook',
      target: 'webhook',
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.webhook.office.com/webhookb2/id');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ text: 'hello teams' });
  });

  it('sends Graph chat messages with HTML body content', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: 'teams-message-1' })));
    vi.stubGlobal('fetch', fetchMock);
    const graphConfig = config({
      deliveryMode: 'graph',
      incomingWebhookUrl: undefined,
      graphAccessToken: 'graph-token',
      chatId: '19:chatid@thread.v2',
      homeChannel: '19:chatid@thread.v2',
    });

    await expect(sendTeamsMessage(graphConfig, 'hello **teams**')).resolves.toEqual({
      mode: 'graph',
      target: '19:chatid@thread.v2',
      messageId: 'teams-message-1',
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.microsoft.com/v1.0/chats/19%3Achatid%40thread.v2/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer graph-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      body: { contentType: 'html', content: 'hello **teams**' },
    });
  });

  it('builds Graph team/channel URLs from explicit Teams targets', () => {
    expect(teamsGraphMessageUrl(config({ deliveryMode: 'graph', graphAccessToken: 'graph-token' }), 'team/team-1/channel/channel-1')).toEqual({
      url: 'https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages',
      target: 'team/team-1/channel/channel-1',
    });
  });
});
