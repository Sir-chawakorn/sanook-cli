import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedWhatsAppConfig } from './config.js';
import {
  extractWhatsAppTextEvents,
  handleWhatsAppChallenge,
  handleWhatsAppWebhook,
  isAllowedWhatsAppSender,
  normalizeWhatsAppId,
  redactWhatsAppId,
  sendWhatsAppMessage,
  splitWhatsAppText,
  verifyWhatsAppSignature,
  whatsAppMessagesUrl,
  whatsAppPlainText,
} from './whatsapp.js';

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

function config(overrides: Partial<ResolvedWhatsAppConfig> = {}): ResolvedWhatsAppConfig {
  return {
    phoneNumberId: '123456789012345',
    accessToken: 'EAA-test-token',
    appSecret: '0123456789abcdef0123456789abcdef',
    verifyToken: 'verify-token',
    homeChannel: '15551234567',
    homeChannelName: 'Owner',
    allowedUsers: ['15551234567'],
    allowAllUsers: false,
    publicUrl: 'https://wa.example.com',
    apiVersion: 'v20.0',
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

function webhookBody(from = '15551234567', id = 'wamid.1'): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: from, profile: { name: 'Owner' } }],
              messages: [
                {
                  from,
                  id,
                  timestamp: '1718584242',
                  type: 'text',
                  text: { body: 'hello from whatsapp' },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function statusWebhookBody(id = 'wamid.status.1'): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                {
                  id,
                  status: 'delivered',
                  recipient_id: '15551234567',
                  timestamp: '1718584242',
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function signature(raw: string): string {
  return `sha256=${createHmac('sha256', config().appSecret!).update(raw).digest('hex')}`;
}

describe('WhatsApp Cloud gateway adapter', () => {
  it('normalizes/redacts ids and builds Graph API URLs', () => {
    expect(normalizeWhatsAppId('+1 (555) 123-4567')).toBe('15551234567');
    expect(normalizeWhatsAppId('not-a-number')).toBeUndefined();
    expect(redactWhatsAppId('15551234567')).toBe('1555…4567');
    expect(whatsAppMessagesUrl(config())).toBe('https://graph.facebook.com/v20.0/123456789012345/messages');
  });

  it('formats Markdown into WhatsApp-flavored text and chunks long messages', () => {
    expect(whatsAppPlainText('# Title\n**Bold** [docs](https://example.com)\n`code`')).toBe(
      '*Title*\n*Bold* docs (https://example.com)\ncode',
    );
    const chunks = splitWhatsAppText(`intro\n${'word '.repeat(1200)}`, 500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true);
  });

  it('sends direct text messages through the Meta Graph Messages API', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.out.1' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendWhatsAppMessage(config(), '+1 (555) 123-4567', 'hello **wa**')).resolves.toEqual({
      to: '15551234567',
      messageCount: 1,
      messageIds: ['wamid.out.1'],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v20.0/123456789012345/messages');
    expect(init.headers).toMatchObject({ authorization: 'Bearer EAA-test-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '15551234567',
      type: 'text',
      text: { preview_url: false, body: 'hello *wa*' },
    });
  });

  it('verifies webhook signatures and the Meta GET challenge', () => {
    const raw = webhookBody();
    expect(verifyWhatsAppSignature(config().appSecret, raw, signature(raw))).toBe(true);
    expect(verifyWhatsAppSignature(config().appSecret, raw, 'sha256=bad')).toBe(false);
    expect(
      handleWhatsAppChallenge(config(), new URLSearchParams('hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=hello')),
    ).toEqual({ status: 200, body: 'hello', contentType: 'text/plain; charset=utf-8' });
    expect(
      handleWhatsAppChallenge(config(), new URLSearchParams('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=hello')),
    ).toMatchObject({ status: 403 });
  });

  it('extracts text events and enforces allowlists', () => {
    const events = extractWhatsAppTextEvents(JSON.parse(webhookBody()) as never);
    expect(events).toEqual([
      {
        from: '15551234567',
        text: 'hello from whatsapp',
        messageId: 'wamid.1',
        timestamp: '1718584242',
        profileName: 'Owner',
      },
    ]);
    expect(isAllowedWhatsAppSender(config(), '15551234567')).toBe(true);
    expect(isAllowedWhatsAppSender(config(), '15557654321')).toBe(false);
    expect(isAllowedWhatsAppSender(config({ allowAllUsers: true, allowedUsers: [] }), '15557654321')).toBe(true);
  });

  it('runs the gateway agent for signed authorized inbound WhatsApp text messages and replies', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'agent reply', suppressDelivery: false, messages: [] });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.reply' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const raw = webhookBody('15551234567', 'wamid.unique.1');

    await expect(
      handleWhatsAppWebhook({
        rawBody: raw,
        signature: signature(raw),
        config: config(),
        model: 'test:model',
        permissionMode: 'ask',
        runningTargets: new Set<string>(),
      }),
    ).resolves.toEqual({ status: 200, body: { ok: true, accepted: 1, ignored: 0 } });

    expect(h.runGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'whatsapp',
        target: '15551234567',
        model: 'test:model',
        prompt: expect.stringContaining('hello from whatsapp'),
        userText: 'hello from whatsapp',
      }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      messaging_product: 'whatsapp',
      to: '15551234567',
      text: { body: 'agent reply' },
    });
  });

  it('ignores signed WhatsApp status callbacks without starting an agent run', async () => {
    const raw = statusWebhookBody();

    await expect(
      handleWhatsAppWebhook({
        rawBody: raw,
        signature: signature(raw),
        config: config(),
        model: 'test:model',
        runningTargets: new Set<string>(),
      }),
    ).resolves.toEqual({ status: 200, body: { ok: true, accepted: 0, ignored: 0 } });

    expect(h.runGatewayAgent).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures before running the agent', async () => {
    await expect(
      handleWhatsAppWebhook({
        rawBody: webhookBody('15551234567', 'wamid.unique.2'),
        signature: 'sha256=bad',
        config: config(),
        model: 'test:model',
      }),
    ).resolves.toEqual({ status: 401, body: { error: 'invalid_signature' } });
    expect(h.runGatewayAgent).not.toHaveBeenCalled();
  });
});
