import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedMattermostConfig } from './config.js';
import {
  handleMattermostEvent,
  isAllowedMattermostEvent,
  mattermostApiUrl,
  mattermostAuthHeaders,
  mattermostShouldRespond,
  mattermostUserText,
  mattermostWebSocketUrl,
  normalizeMattermostUrl,
  parseMattermostPostedEvent,
  sendMattermostMessage,
  splitMattermostText,
  startMattermost,
} from './mattermost.js';

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

function config(overrides: Partial<ResolvedMattermostConfig> = {}): ResolvedMattermostConfig {
  return {
    serverUrl: 'https://mm.example.com',
    token: 'mattermost-token',
    homeChannel: 'chan-home',
    homeChannelName: 'Home',
    allowedUsers: ['user-1'],
    allowedChannels: ['chan-home'],
    freeResponseChannels: [],
    allowAllUsers: false,
    requireMention: true,
    groupSessionsPerUser: true,
    replyMode: 'thread',
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

function postedEvent(overrides: Record<string, unknown> = {}): string {
  const post = {
    id: 'post-1',
    user_id: 'user-1',
    channel_id: 'chan-home',
    message: '@sanook deploy status',
    create_at: 1718584242000,
    ...((overrides.post as Record<string, unknown> | undefined) ?? {}),
  };
  return JSON.stringify({
    event: 'posted',
    data: {
      channel_type: 'O',
      mentions: JSON.stringify(['bot-1']),
      post: JSON.stringify(post),
      ...((overrides.data as Record<string, unknown> | undefined) ?? {}),
    },
    broadcast: { channel_id: post.channel_id },
  });
}

describe('Mattermost gateway adapter', () => {
  it('normalizes URLs, builds API/websocket URLs, auth headers, and chunks text', () => {
    expect(normalizeMattermostUrl(' https://mm.example.com/ ')).toBe('https://mm.example.com');
    expect(normalizeMattermostUrl('mm.example.com')).toBeUndefined();
    expect(mattermostApiUrl(config(), '/posts')).toBe('https://mm.example.com/api/v4/posts');
    expect(mattermostWebSocketUrl('https://mm.example.com/team')).toBe('wss://mm.example.com/team/api/v4/websocket');
    expect(mattermostAuthHeaders(' token ')).toEqual({ authorization: 'Bearer token' });
    const chunks = splitMattermostText(`intro\n${'word '.repeat(1200)}`, 500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true);
  });

  it('creates posts through Mattermost REST API v4', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ id: 'post-out-1', channel_id: 'chan-home' })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendMattermostMessage(config(), 'chan-home', 'hello', 'root-post-1')).resolves.toEqual({
      channelId: 'chan-home',
      postIds: ['post-out-1'],
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mm.example.com/api/v4/posts');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer mattermost-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      channel_id: 'chan-home',
      message: 'hello',
      root_id: 'root-post-1',
    });
  });

  it('parses posted websocket events, ignores bot posts, and applies mention policy', () => {
    const event = parseMattermostPostedEvent(postedEvent(), { userId: 'bot-1', username: 'sanook' });
    expect(event).toMatchObject({
      channelId: 'chan-home',
      userId: 'user-1',
      text: '@sanook deploy status',
      postId: 'post-1',
      isDirect: false,
      mentionsBot: true,
    });
    expect(parseMattermostPostedEvent(postedEvent({ post: { user_id: 'bot-1' } }), { userId: 'bot-1', username: 'sanook' })).toBeNull();
    expect(isAllowedMattermostEvent(config(), event!)).toBe(true);
    expect(isAllowedMattermostEvent(config({ allowedChannels: ['other-chan'] }), event!)).toBe(false);
    expect(mattermostShouldRespond(config(), event!)).toBe(true);
    expect(mattermostShouldRespond(config(), { ...event!, mentionsBot: false })).toBe(false);
    expect(mattermostShouldRespond(config({ requireMention: false }), { ...event!, mentionsBot: false })).toBe(true);
    expect(mattermostUserText(event!, 'sanook')).toBe('deploy status');
  });

  it('runs the gateway agent for allowed events and replies in a Mattermost thread', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'agent reply', suppressDelivery: false, messages: [] });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: 'reply-1' })));
    vi.stubGlobal('fetch', fetchMock);
    const event = parseMattermostPostedEvent(postedEvent(), { userId: 'bot-1', username: 'sanook' })!;

    await expect(
      handleMattermostEvent({
        config: config(),
        event,
        botUsername: 'sanook',
        model: 'test:model',
        runningTargets: new Set<string>(),
      }),
    ).resolves.toEqual({ handled: true });

    expect(h.runGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'mattermost',
        target: 'chan-home:post-1:user-1',
        prompt: expect.stringContaining('Mattermost channel chan-home from user-1:'),
        userText: 'deploy status',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mm.example.com/api/v4/posts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ channel_id: 'chan-home', message: 'agent reply', root_id: 'post-1' }),
      }),
    );
  });

  it('rejects unauthorized Mattermost senders before running the agent', async () => {
    const event = parseMattermostPostedEvent(postedEvent(), { userId: 'bot-1', username: 'sanook' })!;
    await expect(
      handleMattermostEvent({
        config: config({ allowedUsers: ['other-user'] }),
        event,
        model: 'test:model',
        runningTargets: new Set<string>(),
      }),
    ).resolves.toEqual({ handled: false, reason: 'not_allowed' });
    expect(h.runGatewayAgent).not.toHaveBeenCalled();
  });

  it('authenticates the Mattermost websocket after users/me', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ id: 'bot-1', username: 'sanook' })),
    );
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

    const stop = await startMattermost({
      config: config(),
      model: 'test:model',
      webSocketFactory: (url) => {
        expect(url).toBe('wss://mm.example.com/api/v4/websocket');
        return ws;
      },
    });

    listeners.open?.[0]?.({});
    expect(JSON.parse(sent[0])).toEqual({
      seq: 1,
      action: 'authentication_challenge',
      data: { token: 'mattermost-token' },
    });
    stop();
    expect(ws.close).toHaveBeenCalledOnce();
  });
});
