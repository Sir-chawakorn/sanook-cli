import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSmsConfig } from './config.js';
import {
  handleSmsWebhook,
  isAllowedSmsSender,
  sendSmsMessage,
  smsPlainText,
  smsTwiml,
  splitSmsText,
  verifyTwilioSignature,
} from './sms.js';

const gatewayAgent = vi.hoisted(() => ({
  runGatewayAgent: vi.fn(),
}));

vi.mock('./session.js', () => gatewayAgent);

afterEach(() => {
  vi.unstubAllGlobals();
  gatewayAgent.runGatewayAgent.mockReset();
});

function baseConfig(overrides: Partial<ResolvedSmsConfig> = {}): ResolvedSmsConfig {
  return {
    accountSid: 'AC123',
    authToken: 'twilio-auth-token',
    phoneNumber: '+15550000000',
    homeChannel: '+15551234567',
    homeChannelName: 'Owner',
    allowedUsers: ['+15551234567'],
    allowAllUsers: false,
    webhookUrl: 'https://sms.example.com/sms/webhook',
    insecureNoSignature: false,
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

function signedForm(fields: Record<string, string>, webhookUrl = 'https://sms.example.com/sms/webhook') {
  const params = new URLSearchParams(fields);
  let payload = webhookUrl;
  for (const key of [...new Set([...params.keys()])].sort()) {
    for (const value of params.getAll(key).sort()) payload += `${key}${value}`;
  }
  const signature = createHmac('sha1', 'twilio-auth-token').update(payload).digest('base64');
  return { rawBody: params.toString(), params, signature };
}

describe('SMS / Twilio gateway adapter', () => {
  it('sends SMS through the Twilio Messages API', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 201,
      json: async () => ({ sid: 'SM123' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendSmsMessage({ accountSid: 'AC123', authToken: 'twilio-auth-token', phoneNumber: '+1 (555) 000-0000' }, '+1 555 123-4567', 'hello'),
    ).resolves.toEqual({ to: '+15551234567', messageCount: 1, messageIds: ['SM123'] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('AC123:twilio-auth-token', 'utf8').toString('base64')}`,
    );
    const body = init.body as URLSearchParams;
    expect(body.get('From')).toBe('+15550000000');
    expect(body.get('To')).toBe('+15551234567');
    expect(body.get('Body')).toBe('hello');
  });

  it('strips Markdown and splits long SMS text at natural boundaries', () => {
    expect(smsPlainText('# Heading\n**Bold** [docs](https://example.com)\n`code`')).toBe(
      'Heading\nBold docs (https://example.com)\ncode',
    );
    const chunks = splitSmsText(`intro\n${'word '.repeat(400)}`, 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
    expect(smsTwiml(['5 < 6 & **ok**'])).toContain('<Message>5 &lt; 6 &amp; ok</Message>');
  });

  it('validates Twilio form webhook signatures', () => {
    const { params, signature } = signedForm({ From: '+15551234567', To: '+15550000000', Body: 'hello' });
    expect(verifyTwilioSignature('twilio-auth-token', 'https://sms.example.com/sms/webhook', params, signature)).toBe(true);
    expect(verifyTwilioSignature('twilio-auth-token', 'https://wrong.example.com/sms/webhook', params, signature)).toBe(false);
  });

  it('runs the gateway agent for allowed inbound SMS and replies with TwiML', async () => {
    gatewayAgent.runGatewayAgent.mockResolvedValue({ text: 'agent **reply**', suppressDelivery: false });
    const { rawBody, signature } = signedForm({
      From: '+15551234567',
      To: '+15550000000',
      Body: 'ช่วยสรุปให้หน่อย',
      MessageSid: 'SMIN',
    });

    const result = await handleSmsWebhook({
      rawBody,
      signature,
      config: baseConfig(),
      model: 'openai:gpt-5.3-codex',
      permissionMode: 'ask',
    });

    expect(result.status).toBe(200);
    expect(result.contentType).toContain('application/xml');
    expect(result.body).toContain('<Message>agent reply</Message>');
    expect(gatewayAgent.runGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'sms',
        target: '+15551234567',
        model: 'openai:gpt-5.3-codex',
      }),
    );
  });

  it('rejects invalid signatures before running the agent', async () => {
    const { rawBody } = signedForm({ From: '+15551234567', To: '+15550000000', Body: 'hello' });
    const result = await handleSmsWebhook({
      rawBody,
      signature: 'bad-signature',
      config: baseConfig(),
      model: 'openai:gpt-5.3-codex',
    });

    expect(result.status).toBe(401);
    expect(gatewayAgent.runGatewayAgent).not.toHaveBeenCalled();
  });

  it('denies senders outside the SMS allowlist', async () => {
    const { rawBody, signature } = signedForm({ From: '+15557654321', To: '+15550000000', Body: 'hello' });
    const result = await handleSmsWebhook({
      rawBody,
      signature,
      config: baseConfig(),
      model: 'openai:gpt-5.3-codex',
    });

    expect(result.status).toBe(200);
    expect(result.body).toContain('ไม่ได้รับอนุญาต');
    expect(gatewayAgent.runGatewayAgent).not.toHaveBeenCalled();
    expect(isAllowedSmsSender(baseConfig({ allowAllUsers: true, allowedUsers: [] }), '+15557654321')).toBe(true);
  });

  it('ignores inbound messages from the configured Twilio phone number', async () => {
    const { rawBody, signature } = signedForm({ From: '+1 (555) 000-0000', To: '+15551234567', Body: 'delivery echo' });
    const result = await handleSmsWebhook({
      rawBody,
      signature,
      config: baseConfig(),
      model: 'openai:gpt-5.3-codex',
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(gatewayAgent.runGatewayAgent).not.toHaveBeenCalled();
  });

  it('requires an exact webhook URL unless local signature validation is disabled', async () => {
    const { rawBody, signature } = signedForm({ From: '+15551234567', To: '+15550000000', Body: 'hello' });
    await expect(
      handleSmsWebhook({
        rawBody,
        signature,
        config: baseConfig({ webhookUrl: undefined }),
        model: 'openai:gpt-5.3-codex',
      }),
    ).resolves.toMatchObject({ status: 503 });

    gatewayAgent.runGatewayAgent.mockResolvedValue({ text: '[SILENT]', suppressDelivery: true });
    await expect(
      handleSmsWebhook({
        rawBody,
        signature: undefined,
        config: baseConfig({ webhookUrl: undefined, insecureNoSignature: true }),
        model: 'openai:gpt-5.3-codex',
      }),
    ).resolves.toMatchObject({ status: 200 });
  });
});
