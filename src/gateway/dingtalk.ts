import { createHmac } from 'node:crypto';
import type { ResolvedDingTalkConfig } from './config.js';
import { redactKey } from '../providers/keys.js';

export type DingTalkTargetType = 'conversation' | 'user' | 'webhook';

export interface DingTalkResolvedTarget {
  type: DingTalkTargetType;
  value: string;
}

export interface DingTalkSendResult {
  mode: 'openapi' | 'webhook';
  target: string;
  messageIds: string[];
  messageCount: number;
}

const DINGTALK_API_BASE_URL = 'https://api.dingtalk.com';
const DINGTALK_TEXT_LIMIT = 4_000;

interface DingTalkTokenResponse {
  accessToken?: string;
  expireIn?: number;
}

interface DingTalkOpenApiResponse {
  processQueryKey?: string;
  messageId?: string;
  taskId?: string;
}

interface DingTalkWebhookResponse {
  errcode?: number;
  errmsg?: string;
}

function redactDingTalkDetail(raw: string, secrets: Array<string | undefined>): string {
  let safe = redactKey(raw);
  for (const secret of secrets) {
    const value = secret?.trim();
    if (value) safe = safe.split(value).join('<secret>');
  }
  return safe;
}

export function normalizeDingTalkApiBaseUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim() || DINGTALK_API_BASE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function normalizeDingTalkWebhookUrl(raw: string | undefined): string | undefined {
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

export function chunkDingTalkText(raw: string, limit = DINGTALK_TEXT_LIMIT): string[] {
  const text = raw.trim() || '(ไม่มีผลลัพธ์)';
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += limit) {
    chunks.push(text.slice(index, index + limit));
  }
  return chunks;
}

export function dingtalkSignedWebhookUrl(webhookUrl: string, secret: string | undefined, now = Date.now()): string {
  const url = new URL(webhookUrl);
  const cleanSecret = secret?.trim();
  if (!cleanSecret) return url.toString();
  const timestamp = String(now);
  const sign = createHmac('sha256', cleanSecret).update(`${timestamp}\n${cleanSecret}`).digest('base64');
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', sign);
  return url.toString();
}

export function dingtalkApiUrl(config: Pick<ResolvedDingTalkConfig, 'apiBaseUrl'>, path: string): string {
  const baseUrl = normalizeDingTalkApiBaseUrl(config.apiBaseUrl);
  if (!baseUrl) throw new Error('DingTalk API base URL ต้องเป็น https:// URL');
  return new URL(path, `${baseUrl}/`).toString();
}

export function parseDingTalkTarget(config: ResolvedDingTalkConfig, explicitTarget?: string): DingTalkResolvedTarget {
  const target = explicitTarget?.trim() || config.homeChannel?.trim() || (config.webhookUrl ? 'webhook' : undefined);
  if (!target) throw new Error('ต้องระบุ DingTalk conversation/user target หรือ home channel ใน gateway config');
  if (/^https:\/\//i.test(target)) {
    const webhookUrl = normalizeDingTalkWebhookUrl(target);
    if (!webhookUrl) throw new Error('DingTalk webhook target ต้องเป็น HTTPS URL ที่ถูกต้อง');
    return { type: 'webhook', value: webhookUrl };
  }
  if (target === 'webhook') {
    const webhookUrl = normalizeDingTalkWebhookUrl(config.webhookUrl);
    if (!webhookUrl) throw new Error('ยังไม่ได้ตั้ง DingTalk webhook URL');
    return { type: 'webhook', value: webhookUrl };
  }
  const userMatch = /^(?:user[:/])(.+)$/i.exec(target);
  if (userMatch?.[1]?.trim()) return { type: 'user', value: userMatch[1].trim() };
  const conversationMatch = /^(?:(?:conversation|group|chat)[:/])(.+)$/i.exec(target);
  if (conversationMatch?.[1]?.trim()) return { type: 'conversation', value: conversationMatch[1].trim() };
  return { type: 'conversation', value: target };
}

async function readDingTalkJsonOrThrow<T>(response: Response, label: string, secrets: Array<string | undefined> = []): Promise<T> {
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`${label} ${response.status}${text ? `: ${redactDingTalkDetail(text, secrets).slice(0, 240)}` : ''}`);
  const json = (text ? JSON.parse(text) : {}) as T & { code?: string; errcode?: number; errmsg?: string; message?: string };
  if (typeof json.errcode === 'number' && json.errcode !== 0) {
    throw new Error(`${label} errcode ${json.errcode}${json.errmsg ? `: ${redactDingTalkDetail(json.errmsg, secrets).slice(0, 200)}` : ''}`);
  }
  if (json.code && json.message) {
    throw new Error(`${label} code ${json.code}: ${redactDingTalkDetail(json.message, secrets).slice(0, 200)}`);
  }
  return json as T;
}

export async function dingTalkAccessToken(config: ResolvedDingTalkConfig): Promise<string> {
  const appKey = config.clientId?.trim();
  const appSecret = config.clientSecret?.trim();
  if (!appKey || !appSecret) throw new Error('ยังไม่ได้ตั้ง DingTalk client id หรือ client secret');
  const r = await fetch(dingtalkApiUrl(config, '/v1.0/oauth2/accessToken'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appKey, appSecret }),
  });
  const json = await readDingTalkJsonOrThrow<DingTalkTokenResponse>(r, 'DingTalk access token', [appSecret]);
  const token = json.accessToken?.trim();
  if (!token) throw new Error('DingTalk access token response ไม่มี token');
  return token;
}

function dingtalkMarkdownPayload(text: string, title = 'Sanook'): { msgKey: string; msgParam: string } {
  return {
    msgKey: 'sampleMarkdown',
    msgParam: JSON.stringify({
      title: title.trim() || 'Sanook',
      text,
    }),
  };
}

async function sendDingTalkWebhook(config: ResolvedDingTalkConfig, webhookUrl: string, text: string): Promise<DingTalkSendResult> {
  const messageCount = chunkDingTalkText(text).length;
  for (const chunk of chunkDingTalkText(text)) {
    const r = await fetch(dingtalkSignedWebhookUrl(webhookUrl, config.webhookSecret), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: config.homeChannelName || 'Sanook',
          text: chunk,
        },
      }),
    });
    await readDingTalkJsonOrThrow<DingTalkWebhookResponse>(r, 'DingTalk webhook', [config.webhookSecret, webhookUrl]);
  }
  return { mode: 'webhook', target: 'webhook', messageIds: [], messageCount };
}

async function sendDingTalkOpenApi(config: ResolvedDingTalkConfig, target: DingTalkResolvedTarget, text: string): Promise<DingTalkSendResult> {
  const robotCode = config.robotCode?.trim();
  if (!robotCode) throw new Error('ยังไม่ได้ตั้ง DingTalk robot code');
  const token = await dingTalkAccessToken(config);
  const messageIds: string[] = [];
  for (const chunk of chunkDingTalkText(text)) {
    const payload =
      target.type === 'user'
        ? {
            robotCode,
            userIds: [target.value],
            ...dingtalkMarkdownPayload(chunk, config.homeChannelName),
          }
        : {
            robotCode,
            openConversationId: target.value,
            ...dingtalkMarkdownPayload(chunk, config.homeChannelName),
          };
    const path = target.type === 'user' ? '/v1.0/robot/oToMessages/batchSend' : '/v1.0/robot/groupMessages/send';
    const r = await fetch(dingtalkApiUrl(config, path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify(payload),
    });
    const json = await readDingTalkJsonOrThrow<DingTalkOpenApiResponse>(r, 'DingTalk robot message', [
      config.clientSecret,
      token,
    ]);
    const id = json.processQueryKey || json.messageId || json.taskId;
    if (id) messageIds.push(id);
  }
  return {
    mode: 'openapi',
    target: target.type === 'user' ? `user/${target.value}` : target.value,
    messageIds,
    messageCount: messageIds.length || chunkDingTalkText(text).length,
  };
}

export async function sendDingTalkMessage(config: ResolvedDingTalkConfig, text: string, explicitTarget?: string): Promise<DingTalkSendResult> {
  const target = parseDingTalkTarget(config, explicitTarget);
  if (target.type === 'webhook') return sendDingTalkWebhook(config, target.value, text);
  return sendDingTalkOpenApi(config, target, text);
}
