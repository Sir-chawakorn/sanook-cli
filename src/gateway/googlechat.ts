import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ResolvedGoogleChatConfig } from './config.js';
import { redactKey } from '../providers/keys.js';

export type GoogleChatTargetType = 'space' | 'webhook';

export interface GoogleChatResolvedTarget {
  type: GoogleChatTargetType;
  value: string;
  space?: string;
  thread?: string;
}

export interface GoogleChatSendResult {
  mode: 'chat_api' | 'incoming_webhook';
  target: string;
  messageIds: string[];
  messageCount: number;
}

export interface GoogleServiceAccount {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
  project_id?: string;
}

interface GoogleOAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleChatMessageResponse {
  name?: string;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

type GoogleChatErrorBody = {
  error?: string | GoogleChatMessageResponse['error'];
  error_description?: string;
};

const GOOGLE_CHAT_API_BASE_URL = 'https://chat.googleapis.com';
const GOOGLE_OAUTH_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GOOGLE_CHAT_SCOPE = 'https://www.googleapis.com/auth/chat.bot';
const GOOGLE_CHAT_TEXT_LIMIT = 4_000;

function redactGoogleChatDetail(raw: string, secrets: Array<string | undefined>): string {
  let safe = redactKey(raw);
  for (const secret of secrets) {
    const value = secret?.trim();
    if (value) safe = safe.split(value).join('<secret>');
  }
  return safe;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

export function normalizeGoogleChatApiBaseUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim() || GOOGLE_CHAT_API_BASE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function normalizeGoogleChatWebhookUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function chunkGoogleChatText(raw: string, limit = GOOGLE_CHAT_TEXT_LIMIT): string[] {
  const text = raw.trim() || '(ไม่มีผลลัพธ์)';
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += limit) {
    chunks.push(text.slice(index, index + limit));
  }
  return chunks;
}

export function parseGoogleChatTarget(config: ResolvedGoogleChatConfig, explicitTarget?: string): GoogleChatResolvedTarget {
  const target = explicitTarget?.trim() || config.homeChannel?.trim();
  if (!target) {
    const webhook = normalizeGoogleChatWebhookUrl(config.incomingWebhookUrl);
    if (webhook) return { type: 'webhook', value: webhook };
    throw new Error('ต้องระบุ Google Chat space/webhook target หรือ home channel ใน gateway config');
  }
  if (/^https:\/\//i.test(target)) {
    const webhookUrl = normalizeGoogleChatWebhookUrl(target);
    if (!webhookUrl) throw new Error('Google Chat incoming webhook target ต้องเป็น HTTPS URL ที่ถูกต้อง');
    return { type: 'webhook', value: webhookUrl };
  }
  if (target.toLowerCase() === 'webhook') {
    const webhookUrl = normalizeGoogleChatWebhookUrl(config.incomingWebhookUrl);
    if (!webhookUrl) throw new Error('ยังไม่ได้ตั้ง Google Chat incoming webhook URL');
    return { type: 'webhook', value: webhookUrl };
  }
  const cleaned = target.replace(/^space[:/](?:spaces\/)?/i, 'spaces/').trim();
  const match = /^(spaces\/[^/\s]+)(?:\/threads\/(.+))?$/.exec(cleaned);
  if (!match) throw new Error('Google Chat target ต้องเป็น spaces/<space-id> หรือ spaces/<space-id>/threads/<thread-id>');
  const space = match[1];
  const thread = match[2] ? `${space}/threads/${match[2]}` : undefined;
  return { type: 'space', value: thread ?? space, space, thread };
}

export function googleChatApiUrl(config: Pick<ResolvedGoogleChatConfig, 'apiBaseUrl'>, path: string): string {
  const baseUrl = normalizeGoogleChatApiBaseUrl(config.apiBaseUrl);
  if (!baseUrl) throw new Error('Google Chat API base URL ต้องเป็น https:// URL');
  return new URL(path, `${baseUrl}/`).toString();
}

export async function readGoogleServiceAccount(path: string): Promise<GoogleServiceAccount> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as GoogleServiceAccount;
  if (!parsed || typeof parsed !== 'object') throw new Error('Google Chat service account JSON ไม่ถูกต้อง');
  return parsed;
}

export function googleServiceAccountJwt(serviceAccount: GoogleServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const issuer = serviceAccount.client_email?.trim();
  const privateKey = serviceAccount.private_key;
  const audience = serviceAccount.token_uri?.trim() || GOOGLE_OAUTH_TOKEN_URI;
  if (!issuer || !privateKey) throw new Error('Google Chat service account JSON ต้องมี client_email และ private_key');
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iss: issuer,
      scope: GOOGLE_CHAT_SCOPE,
      aud: audience,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey);
  return `${unsigned}.${base64Url(signature)}`;
}

async function readGoogleChatJsonOrThrow<T extends GoogleOAuthTokenResponse | GoogleChatMessageResponse>(
  response: Response,
  label: string,
  secrets: Array<string | undefined> = [],
): Promise<T> {
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`${label} ${response.status}${text ? `: ${redactGoogleChatDetail(text, secrets).slice(0, 240)}` : ''}`);
  let json: T;
  try {
    json = (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new Error(`${label} ${response.status}: response ไม่ใช่ JSON: ${redactGoogleChatDetail(text, secrets).slice(0, 240)}`);
  }
  const maybe = json as GoogleChatErrorBody;
  const error = maybe.error;
  if (error) {
    const detail =
      typeof error === 'string'
        ? maybe.error_description || error
        : error.message || error.status || String(error.code ?? 'unknown');
    throw new Error(`${label}: ${redactGoogleChatDetail(detail, secrets).slice(0, 200)}`);
  }
  return json;
}

export async function googleChatAccessToken(config: ResolvedGoogleChatConfig): Promise<string> {
  const serviceAccountPath = config.serviceAccountJson?.trim();
  if (!serviceAccountPath) throw new Error('ยังไม่ได้ตั้ง Google Chat service account JSON');
  const serviceAccount = await readGoogleServiceAccount(serviceAccountPath);
  const tokenUri = serviceAccount.token_uri?.trim() || GOOGLE_OAUTH_TOKEN_URI;
  const assertion = googleServiceAccountJwt(serviceAccount);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const r = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await readGoogleChatJsonOrThrow<GoogleOAuthTokenResponse>(r, 'Google Chat OAuth token', [
    serviceAccount.private_key,
    assertion,
  ]);
  const token = json.access_token?.trim();
  if (!token) throw new Error('Google Chat OAuth token response ไม่มี access_token');
  return token;
}

async function sendGoogleChatWebhook(webhookUrl: string, text: string): Promise<GoogleChatSendResult> {
  const messageIds: string[] = [];
  for (const chunk of chunkGoogleChatText(text)) {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: chunk }),
    });
    const json = await readGoogleChatJsonOrThrow<GoogleChatMessageResponse>(r, 'Google Chat incoming webhook', [webhookUrl]);
    if (json.name) messageIds.push(json.name);
  }
  return { mode: 'incoming_webhook', target: 'webhook', messageIds, messageCount: messageIds.length || chunkGoogleChatText(text).length };
}

async function sendGoogleChatApi(config: ResolvedGoogleChatConfig, target: GoogleChatResolvedTarget, text: string): Promise<GoogleChatSendResult> {
  if (!target.space) throw new Error('Google Chat API target ต้องเป็น space');
  const token = await googleChatAccessToken(config);
  const messageIds: string[] = [];
  for (const chunk of chunkGoogleChatText(text)) {
    const r = await fetch(googleChatApiUrl(config, `/v1/${target.space}/messages`), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: chunk,
        ...(target.thread ? { thread: { name: target.thread } } : {}),
      }),
    });
    const json = await readGoogleChatJsonOrThrow<GoogleChatMessageResponse>(r, 'Google Chat API message', [token]);
    if (json.name) messageIds.push(json.name);
  }
  return {
    mode: 'chat_api',
    target: target.value,
    messageIds,
    messageCount: messageIds.length || chunkGoogleChatText(text).length,
  };
}

export async function sendGoogleChatMessage(
  config: ResolvedGoogleChatConfig,
  text: string,
  explicitTarget?: string,
): Promise<GoogleChatSendResult> {
  const target = parseGoogleChatTarget(config, explicitTarget);
  if (target.type === 'webhook') return sendGoogleChatWebhook(target.value, text);
  return sendGoogleChatApi(config, target, text);
}
