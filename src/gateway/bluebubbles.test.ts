import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blueBubblesApiUrl,
  chunkBlueBubblesText,
  formatBlueBubblesText,
  normalizeBlueBubblesServerUrl,
  normalizeBlueBubblesWebhookPath,
  parseBlueBubblesTarget,
  sendBlueBubblesMessage,
} from './bluebubbles.js';
import type { ResolvedBlueBubblesConfig } from './config.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function config(overrides: Partial<ResolvedBlueBubblesConfig> = {}): ResolvedBlueBubblesConfig {
  return {
    serverUrl: 'http://localhost:1234',
    password: 'secret',
    webhookHost: '127.0.0.1',
    webhookPort: 8645,
    webhookPath: '/bluebubbles-webhook',
    homeChannel: 'user@example.com',
    allowedUsers: ['user@example.com'],
    allowAllUsers: false,
    requireMention: false,
    mentionPatterns: [],
    sendReadReceipts: true,
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

describe('BlueBubbles gateway', () => {
  it('normalizes server URL, webhook path, and API password query', () => {
    expect(normalizeBlueBubblesServerUrl('localhost:1234/')).toBe('http://localhost:1234');
    expect(normalizeBlueBubblesServerUrl('https://bb.example.com/')).toBe('https://bb.example.com');
    expect(normalizeBlueBubblesWebhookPath('bluebubbles-webhook')).toBe('/bluebubbles-webhook');
    expect(blueBubblesApiUrl(config({ password: 's p&c' }), '/api/v1/ping')).toBe(
      'http://localhost:1234/api/v1/ping?password=s+p%26c',
    );
  });

  it('formats markdown-ish text and splits paragraph bubbles without suffixes', () => {
    expect(formatBlueBubblesText('## Heading\nUse **bold** and [docs](https://example.com)')).toBe(
      'Heading\nUse bold and docs',
    );
    expect(formatBlueBubblesText('Use FEATURE_FLAG_NAME and config_file.json')).toBe('Use FEATURE_FLAG_NAME and config_file.json');
    expect(chunkBlueBubblesText('first thought\n\nsecond thought')).toEqual(['first thought', 'second thought']);
  });

  it('parses raw GUID and address targets', () => {
    expect(parseBlueBubblesTarget(config(), 'iMessage;-;user@example.com')).toEqual({
      value: 'iMessage;-;user@example.com',
      chatGuid: 'iMessage;-;user@example.com',
    });
    expect(parseBlueBubblesTarget(config(), 'chat/iMessage;+;group-guid')).toEqual({
      value: 'iMessage;+;group-guid',
      chatGuid: 'iMessage;+;group-guid',
    });
    expect(parseBlueBubblesTarget(config(), '+15551234567')).toEqual({ value: '+15551234567' });
  });

  it('sends text through Hermes-compatible BlueBubbles REST endpoints', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/api/v1/chat/query')) {
        return new Response(
          JSON.stringify({
            status: 200,
            data: [{ guid: 'iMessage;-;user@example.com', chatIdentifier: 'user@example.com', participants: [] }],
          }),
        );
      }
      expect(String(url)).toBe('http://localhost:1234/api/v1/message/text?password=secret');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        chatGuid: 'iMessage;-;user@example.com',
        message: 'hello iMessage',
        text: 'hello iMessage',
      });
      return new Response(JSON.stringify({ status: 200, data: { guid: 'msg-1' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendBlueBubblesMessage(config(), 'hello iMessage')).resolves.toEqual({
      target: 'user@example.com',
      chatGuid: 'iMessage;-;user@example.com',
      messageIds: ['msg-1'],
      messageCount: 1,
    });
  });

  it('creates a new chat for address targets when the server private API is enabled', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/api/v1/chat/query')) return new Response(JSON.stringify({ status: 200, data: [] }));
      if (String(url).includes('/api/v1/server/info')) return new Response(JSON.stringify({ status: 200, data: { private_api: true } }));
      expect(String(url)).toBe('http://localhost:1234/api/v1/chat/new?password=secret');
      expect(JSON.parse(String(init?.body))).toMatchObject({ addresses: ['+15551234567'], message: 'first hello' });
      return new Response(JSON.stringify({ status: 200, data: { messageGuid: 'msg-new' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendBlueBubblesMessage(config({ homeChannel: '+15551234567' }), 'first hello')).resolves.toMatchObject({
      target: '+15551234567',
      messageIds: ['msg-new'],
      messageCount: 1,
    });
  });

  it('does not create a new chat when a first-contact message would be split', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/api/v1/chat/query')) return new Response(JSON.stringify({ status: 200, data: [] }));
      if (String(url).includes('/api/v1/server/info')) return new Response(JSON.stringify({ status: 200, data: { private_api: true } }));
      return new Response(JSON.stringify({ status: 200, data: { messageGuid: 'unexpected' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendBlueBubblesMessage(config({ homeChannel: '+15551234567' }), 'a'.repeat(4_001))).rejects.toThrow(
      'ข้อความหลายส่วน',
    );

    expect(fetchMock.mock.calls.map(([url]) => String(url)).some((url) => url.includes('/api/v1/chat/new'))).toBe(false);
  });
});
