import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedMatrixConfig } from './config.js';
import {
  extractMatrixTextEvents,
  handleMatrixEvent,
  handleMatrixSync,
  loginMatrix,
  matrixAuthHeaders,
  matrixClientUrl,
  matrixShouldRespond,
  normalizeMatrixHomeserver,
  normalizeMatrixRoomId,
  normalizeMatrixUserId,
  sendMatrixMessage,
  splitMatrixText,
} from './matrix.js';

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

function config(overrides: Partial<ResolvedMatrixConfig> = {}): ResolvedMatrixConfig {
  return {
    homeserver: 'https://matrix.example.org',
    accessToken: 'mx-access-token',
    userId: '@sanook:matrix.example.org',
    password: undefined,
    homeRoom: '!home:matrix.example.org',
    homeRoomName: 'Home',
    allowedUsers: ['@alice:matrix.org'],
    allowedRooms: ['!room:matrix.example.org'],
    freeResponseRooms: [],
    allowAllUsers: false,
    requireMention: true,
    groupSessionsPerUser: true,
    autoJoin: true,
    pollTimeoutMs: 30000,
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

function syncPayload() {
  return {
    next_batch: 's2',
    account_data: {
      events: [
        {
          type: 'm.direct',
          content: { '@alice:matrix.org': ['!dm:matrix.example.org'] },
        },
      ],
    },
    rooms: {
      invite: {
        '!invite:matrix.example.org': {},
      },
      join: {
        '!dm:matrix.example.org': {
          summary: { 'm.joined_member_count': 2 },
          timeline: {
            events: [
              {
                type: 'm.room.message',
                event_id: '$dm1',
                sender: '@alice:matrix.org',
                origin_server_ts: 9000,
                content: { msgtype: 'm.text', body: 'hello from matrix dm' },
              },
            ],
          },
        },
        '!room:matrix.example.org': {
          summary: { 'm.joined_member_count': 4 },
          timeline: {
            events: [
              {
                type: 'm.room.message',
                event_id: '$room1',
                sender: '@alice:matrix.org',
                origin_server_ts: 9000,
                content: { msgtype: 'm.text', body: '@sanook please check this' },
              },
              {
                type: 'm.room.message',
                event_id: '$self',
                sender: '@sanook:matrix.example.org',
                origin_server_ts: 9000,
                content: { msgtype: 'm.text', body: 'self message' },
              },
              {
                type: 'm.room.message',
                event_id: '$old',
                sender: '@alice:matrix.org',
                origin_server_ts: 1000,
                content: { msgtype: 'm.text', body: '@sanook old message' },
              },
            ],
          },
        },
      },
    },
  };
}

describe('Matrix gateway adapter', () => {
  it('normalizes Matrix IDs, builds URLs, auth headers, and chunks text', () => {
    expect(normalizeMatrixHomeserver(' https://matrix.example.org/ ')).toBe('https://matrix.example.org');
    expect(normalizeMatrixHomeserver('matrix.example.org')).toBeUndefined();
    expect(normalizeMatrixUserId('@alice:matrix.org')).toBe('@alice:matrix.org');
    expect(normalizeMatrixUserId('alice')).toBeUndefined();
    expect(normalizeMatrixRoomId('!room:matrix.org')).toBe('!room:matrix.org');
    expect(normalizeMatrixRoomId('#alias:matrix.org')).toBe('#alias:matrix.org');
    expect(normalizeMatrixRoomId('!room:matrix.org:8448')).toBe('!room:matrix.org:8448');
    expect(normalizeMatrixRoomId('#alias:matrix.org:8448')).toBe('#alias:matrix.org:8448');
    expect(matrixClientUrl(config(), '/sync', { timeout: 30000, since: 's1' })).toBe(
      'https://matrix.example.org/_matrix/client/v3/sync?timeout=30000&since=s1',
    );
    expect(matrixAuthHeaders(' token ')).toEqual({ authorization: 'Bearer token' });
    const chunks = splitMatrixText(`intro\n${'word '.repeat(1200)}`, 500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true);
  });

  it('logs in with Matrix password credentials when no access token is configured', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ access_token: 'login-token', user_id: '@bot:matrix.org', device_id: 'DEV' })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      loginMatrix(config({ accessToken: undefined, userId: '@bot:matrix.org', password: 'pw' })),
    ).resolves.toEqual({ accessToken: 'login-token', userId: '@bot:matrix.org', deviceId: 'DEV' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://matrix.example.org/_matrix/client/v3/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: '@bot:matrix.org' },
      password: 'pw',
    });
  });

  it('sends room text messages through the Matrix Client-Server API', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ event_id: '$event1' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendMatrixMessage(config(), '!room:matrix.example.org', 'hello matrix')).resolves.toEqual({
      roomId: '!room:matrix.example.org',
      eventIds: ['$event1'],
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/matrix\.example\.org\/_matrix\/client\/v3\/rooms\/!room%3Amatrix\.example\.org\/send\/m\.room\.message\//);
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer mx-access-token');
    expect(JSON.parse(String(init.body))).toEqual({ msgtype: 'm.text', body: 'hello matrix' });
  });

  it('extracts Matrix text events, detects DMs, ignores self/old events, and applies mention policy', () => {
    const events = extractMatrixTextEvents(syncPayload(), config(), 10000);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      roomId: '!dm:matrix.example.org',
      sender: '@alice:matrix.org',
      text: 'hello from matrix dm',
      isDirect: true,
      mentionsBot: false,
    });
    expect(events[1]).toMatchObject({
      roomId: '!room:matrix.example.org',
      sender: '@alice:matrix.org',
      text: '@sanook please check this',
      isDirect: false,
      mentionsBot: true,
    });
    expect(matrixShouldRespond(config(), events[0])).toBe(true);
    expect(matrixShouldRespond(config(), { ...events[1], mentionsBot: false })).toBe(false);
    expect(matrixShouldRespond(config({ requireMention: false }), { ...events[1], mentionsBot: false })).toBe(true);
  });

  it('runs the gateway agent for allowed Matrix events and replies to the room', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'agent reply', suppressDelivery: false, messages: [] });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ event_id: '$reply' })));
    vi.stubGlobal('fetch', fetchMock);
    const [event] = extractMatrixTextEvents(syncPayload(), config(), 10000);

    await expect(
      handleMatrixEvent({
        config: config(),
        event,
        model: 'test:model',
        permissionMode: 'ask',
        runningTargets: new Set<string>(),
      }),
    ).resolves.toEqual({ handled: true });

    expect(h.runGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'matrix',
        target: '!dm:matrix.example.org',
        prompt: expect.stringContaining('hello from matrix dm'),
        userText: 'hello from matrix dm',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/rooms/!dm%3Amatrix.example.org/send/m.room.message/'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ msgtype: 'm.text', body: 'agent reply' }),
      }),
    );
  });

  it('auto-joins invites while handling Matrix sync batches', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: '[SILENT]', suppressDelivery: true, messages: [] });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ room_id: '!invite:matrix.example.org', event_id: '$reply' })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      handleMatrixSync({
        config: config(),
        sync: syncPayload(),
        model: 'test:model',
        startupMs: 10000,
        runningTargets: new Set<string>(),
      }),
    ).resolves.toEqual({ handled: 2, ignored: 0, joined: 1 });

    expect(fetchMock.mock.calls[0][0]).toBe('https://matrix.example.org/_matrix/client/v3/join/!invite%3Amatrix.example.org');
  });

  it('rejects unauthorized Matrix senders before running the agent', async () => {
    const [event] = extractMatrixTextEvents(syncPayload(), config(), 10000);
    await expect(
      handleMatrixEvent({
        config: config({ allowedUsers: ['@other:matrix.org'] }),
        event,
        model: 'test:model',
        runningTargets: new Set<string>(),
      }),
    ).resolves.toEqual({ handled: false, reason: 'not_allowed' });
    expect(h.runGatewayAgent).not.toHaveBeenCalled();
  });
});
