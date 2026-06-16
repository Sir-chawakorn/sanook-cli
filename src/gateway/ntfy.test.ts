import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedNtfyConfig } from './config.js';
import {
  handleNtfyEvent,
  isAllowedNtfyTopic,
  ntfyAuthHeader,
  ntfyTopicUrl,
  parseNtfyJsonLine,
  sendNtfyMessage,
} from './ntfy.js';

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

function config(overrides: Partial<ResolvedNtfyConfig> = {}): ResolvedNtfyConfig {
  return {
    serverUrl: 'https://ntfy.example.com',
    topic: 'sanook-topic',
    publishTopic: 'sanook-replies',
    token: 'ntfy-token',
    homeChannel: 'sanook-topic',
    homeChannelName: 'Owner',
    allowedUsers: ['other-topic'],
    allowAllUsers: false,
    markdown: false,
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

describe('ntfy gateway adapter', () => {
  it('builds auth headers and topic URLs', () => {
    expect(ntfyAuthHeader(' ntfy-token ')).toBe('Bearer ntfy-token');
    expect(ntfyAuthHeader('user:pass')).toBe(`Basic ${Buffer.from('user:pass', 'utf8').toString('base64')}`);
    expect(ntfyAuthHeader('   ')).toBeUndefined();
    expect(ntfyTopicUrl('https://ntfy.example.com/', 'topic with spaces')).toBe('https://ntfy.example.com/topic%20with%20spaces');
  });

  it('publishes messages with markdown, auth, and byte-safe truncation', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'ntfy-message-1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendNtfyMessage(config({ markdown: true, token: 'user:pass' }), ' topic with spaces ', 'x'.repeat(5000), {
        title: 'Build report',
      }),
    ).resolves.toEqual({
      topic: 'topic with spaces',
      messageId: 'ntfy-message-1',
      messageCount: 1,
      truncated: true,
    });

    const [url, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://ntfy.example.com/topic%20with%20spaces');
    expect(headers.authorization).toBe(`Basic ${Buffer.from('user:pass', 'utf8').toString('base64')}`);
    expect(headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(headers.markdown).toBe('yes');
    expect(headers.title).toBe('Build report');
    expect(Buffer.byteLength(String(init.body), 'utf8')).toBeLessThanOrEqual(4096);
    expect(String(init.body)).toMatch(/\.\.\.$/);
  });

  it('parses message events and enforces topic allowlists', () => {
    expect(parseNtfyJsonLine('')).toBeNull();
    expect(parseNtfyJsonLine(JSON.stringify({ event: 'open', topic: 'sanook-topic' }))).toBeNull();
    expect(parseNtfyJsonLine(JSON.stringify({ event: 'message', topic: 'sanook-topic', message: 'hello' }))).toMatchObject({
      event: 'message',
      topic: 'sanook-topic',
      message: 'hello',
    });
    expect(isAllowedNtfyTopic(config(), 'sanook-topic')).toBe(true);
    expect(isAllowedNtfyTopic(config(), 'other-topic')).toBe(true);
    expect(isAllowedNtfyTopic(config(), 'unknown-topic')).toBe(false);
    expect(isAllowedNtfyTopic(config({ allowAllUsers: true }), 'unknown-topic')).toBe(true);
  });

  it('runs the gateway agent for allowed inbound messages and publishes the reply topic', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'agent reply', suppressDelivery: false, messages: [] });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'reply-1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      handleNtfyEvent({
        config: config(),
        event: { event: 'message', topic: 'sanook-topic', message: 'hello from ntfy' },
        model: 'test:model',
        permissionMode: 'ask',
        runningTargets: new Set<string>(),
      }),
    ).resolves.toEqual({ handled: true });

    expect(h.runGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'ntfy',
        target: 'sanook-topic',
        model: 'test:model',
        prompt: expect.stringContaining('hello from ntfy'),
        userText: 'hello from ntfy',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ntfy.example.com/sanook-replies',
      expect.objectContaining({
        method: 'POST',
        body: 'agent reply',
      }),
    );
  });
});
