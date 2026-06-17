import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedGoogleChatConfig } from './config.js';
import {
  chunkGoogleChatText,
  googleChatAccessToken,
  googleServiceAccountJwt,
  normalizeGoogleChatApiBaseUrl,
  normalizeGoogleChatWebhookUrl,
  parseGoogleChatTarget,
  sendGoogleChatMessage,
} from './googlechat.js';

const TMP = mkdtempSync(join(tmpdir(), 'sanook-googlechat-'));

function config(overrides: Partial<ResolvedGoogleChatConfig> = {}): ResolvedGoogleChatConfig {
  return {
    projectId: 'project-1',
    subscriptionName: 'projects/project-1/subscriptions/hermes-chat-events-sub',
    serviceAccountJson: join(TMP, 'google-chat-sa.json'),
    apiBaseUrl: 'https://chat.googleapis.com',
    incomingWebhookUrl: undefined,
    homeChannel: 'spaces/AAAA',
    homeChannelName: 'Owner Google Chat',
    allowedUsers: ['owner@example.com'],
    allowedSpaces: ['spaces/AAAA'],
    freeResponseSpaces: [],
    allowAllUsers: false,
    allowAllSpaces: false,
    maxMessages: 1,
    maxBytes: 16_777_216,
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

function serviceAccountJson(): { privateKey: string; json: Record<string, string> } {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    privateKey: pem,
    json: {
      type: 'service_account',
      project_id: 'project-1',
      client_email: 'sanook-chat@project-1.iam.gserviceaccount.com',
      private_key: pem,
      token_uri: 'https://oauth2.googleapis.com/token',
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('google chat gateway', () => {
  it('normalizes URLs, chunks text, and parses targets', () => {
    expect(normalizeGoogleChatApiBaseUrl(undefined)).toBe('https://chat.googleapis.com');
    expect(normalizeGoogleChatApiBaseUrl('https://chat.googleapis.com/')).toBe('https://chat.googleapis.com');
    expect(normalizeGoogleChatApiBaseUrl('http://chat.googleapis.com')).toBeUndefined();
    expect(normalizeGoogleChatWebhookUrl('https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t')).toBe(
      'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t',
    );
    expect(normalizeGoogleChatWebhookUrl('http://example.com')).toBeUndefined();
    expect(chunkGoogleChatText('x'.repeat(4001))).toHaveLength(2);
    expect(parseGoogleChatTarget(config(), 'spaces/AAAA')).toMatchObject({ type: 'space', value: 'spaces/AAAA', space: 'spaces/AAAA' });
    expect(parseGoogleChatTarget(config(), 'space:AAAA')).toMatchObject({ type: 'space', value: 'spaces/AAAA', space: 'spaces/AAAA' });
    expect(parseGoogleChatTarget(config(), 'space:spaces/AAAA')).toMatchObject({
      type: 'space',
      value: 'spaces/AAAA',
      space: 'spaces/AAAA',
    });
    expect(parseGoogleChatTarget(config(), 'spaces/AAAA/threads/thread-1')).toMatchObject({
      type: 'space',
      value: 'spaces/AAAA/threads/thread-1',
      space: 'spaces/AAAA',
      thread: 'spaces/AAAA/threads/thread-1',
    });
    expect(parseGoogleChatTarget(config({ incomingWebhookUrl: 'https://chat.googleapis.com/webhook' }), 'webhook')).toMatchObject({
      type: 'webhook',
      value: 'https://chat.googleapis.com/webhook',
    });
  });

  it('builds service-account JWTs with the Chat bot scope', () => {
    const { json } = serviceAccountJson();
    const jwt = googleServiceAccountJwt(json, 1718584242);
    const [, payload] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    expect(claims).toMatchObject({
      iss: 'sanook-chat@project-1.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/chat.bot',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1718584242,
      exp: 1718587842,
    });
  });

  it('gets an OAuth token and sends Chat REST API messages', async () => {
    const { json } = serviceAccountJson();
    await writeFile(join(TMP, 'google-chat-sa.json'), JSON.stringify(json));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'google-chat-token', token_type: 'Bearer', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'spaces/AAAA/messages/msg-1' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendGoogleChatMessage(config(), 'hello google chat')).resolves.toEqual({
      mode: 'chat_api',
      target: 'spaces/AAAA',
      messageIds: ['spaces/AAAA/messages/msg-1'],
      messageCount: 1,
    });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    expect(tokenInit.headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' });
    expect((tokenInit.body as URLSearchParams).get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect((tokenInit.body as URLSearchParams).get('assertion')).toMatch(/^ey/);
    const [messageUrl, messageInit] = fetchMock.mock.calls[1];
    expect(messageUrl).toBe('https://chat.googleapis.com/v1/spaces/AAAA/messages');
    expect(messageInit.headers).toMatchObject({ authorization: 'Bearer google-chat-token' });
    expect(JSON.parse(String(messageInit.body))).toEqual({ text: 'hello google chat' });
  });

  it('sends incoming webhook messages and splits long text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'spaces/AAAA/messages/1' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'spaces/AAAA/messages/2' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendGoogleChatMessage(
        config({
          serviceAccountJson: undefined,
          incomingWebhookUrl: 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t',
          homeChannel: 'webhook',
        }),
        'x'.repeat(4001),
      ),
    ).resolves.toMatchObject({
      mode: 'incoming_webhook',
      target: 'webhook',
      messageIds: ['spaces/AAAA/messages/1', 'spaces/AAAA/messages/2'],
      messageCount: 2,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).text).toHaveLength(4000);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).text).toHaveLength(1);
  });

  it('reports malformed successful webhook responses with a redacted preview', async () => {
    const webhookUrl = 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=secret-webhook-token';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init: RequestInit) => new Response(`bad ${webhookUrl} payload`)));

    const result = sendGoogleChatMessage(
      config({
        serviceAccountJson: undefined,
        incomingWebhookUrl: webhookUrl,
        homeChannel: 'webhook',
      }),
      'hello google chat',
    );

    await expect(result).rejects.toThrow('response ไม่ใช่ JSON');
    await expect(result).rejects.not.toThrow('secret-webhook-token');
  });

  it('redacts service-account secrets from OAuth errors', async () => {
    const { privateKey, json } = serviceAccountJson();
    await writeFile(join(TMP, 'google-chat-sa.json'), JSON.stringify(json));
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const assertion = (init.body as URLSearchParams).get('assertion');
      return new Response(JSON.stringify({ error: 'invalid_grant', error_description: `${assertion} ${privateKey}` }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(googleChatAccessToken(config())).rejects.toThrow('Google Chat OAuth token');
    await expect(googleChatAccessToken(config())).rejects.not.toThrow(privateKey);
  });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});
