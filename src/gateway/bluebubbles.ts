import { randomUUID } from 'node:crypto';
import type { ResolvedBlueBubblesConfig } from './config.js';
import { redactKey } from '../providers/keys.js';

export interface BlueBubblesResolvedTarget {
  value: string;
  chatGuid?: string;
}

export interface BlueBubblesSendResult {
  target: string;
  chatGuid?: string;
  messageIds: string[];
  messageCount: number;
}

interface BlueBubblesResponse<T = unknown> {
  status?: number;
  message?: string;
  data?: T;
  error?: {
    type?: string;
    error?: string;
  };
}

interface BlueBubblesChat {
  guid?: string;
  chatGuid?: string;
  chatIdentifier?: string;
  identifier?: string;
  participants?: Array<{ address?: string }>;
}

interface BlueBubblesMessageData {
  guid?: string;
  messageGuid?: string;
}

const BLUEBUBBLES_TEXT_LIMIT = 4_000;
const GUID_CACHE_SIZE = 500;

const chatGuidCache = new Map<string, string>();

function chatGuidCacheKey(config: ResolvedBlueBubblesConfig, target: string): string {
  return `${normalizeBlueBubblesServerUrl(config.serverUrl) ?? ''}|${target}`;
}

function rememberChatGuid(config: ResolvedBlueBubblesConfig, target: string, guid: string): void {
  chatGuidCache.set(chatGuidCacheKey(config, target), guid);
  if (chatGuidCache.size <= GUID_CACHE_SIZE) return;
  const first = chatGuidCache.keys().next().value as string | undefined;
  if (first) chatGuidCache.delete(first);
}

function redactBlueBubblesDetail(raw: string, secrets: Array<string | undefined>): string {
  let safe = redactKey(raw);
  for (const secret of secrets) {
    const value = secret?.trim();
    if (value) safe = safe.split(value).join('<secret>');
  }
  return safe;
}

export function normalizeBlueBubblesServerUrl(raw: string | undefined): string | undefined {
  let value = raw?.trim();
  if (!value) return undefined;
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function normalizeBlueBubblesWebhookPath(raw: string | undefined): string {
  const value = raw?.trim() || '/bluebubbles-webhook';
  return value.startsWith('/') ? value : `/${value}`;
}

export function blueBubblesApiUrl(config: Pick<ResolvedBlueBubblesConfig, 'serverUrl' | 'password'>, path: string): string {
  const baseUrl = normalizeBlueBubblesServerUrl(config.serverUrl);
  const password = config.password?.trim();
  if (!baseUrl) throw new Error('BlueBubbles server URL ต้องเป็น http:// หรือ https:// URL');
  if (!password) throw new Error('ยังไม่ได้ตั้ง BlueBubbles password');
  const url = new URL(path, `${baseUrl}/`);
  url.searchParams.set('password', password);
  return url.toString();
}

export function parseBlueBubblesTarget(config: ResolvedBlueBubblesConfig, explicitTarget?: string): BlueBubblesResolvedTarget {
  const target = explicitTarget?.trim() || config.homeChannel?.trim();
  if (!target) throw new Error('ต้องระบุ BlueBubbles target หรือ home channel ใน gateway config');
  const stripped = target.replace(/^(?:chat|guid)[:/]/i, '').trim();
  if (!stripped || /\s/.test(stripped)) throw new Error('BlueBubbles target ต้องเป็น chat GUID, email, หรือเบอร์โทรที่ไม่มีช่องว่าง');
  if (stripped.includes(';')) return { value: stripped, chatGuid: stripped };
  return { value: stripped };
}

export function formatBlueBubblesText(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .trim();
}

export function chunkBlueBubblesText(raw: string, limit = BLUEBUBBLES_TEXT_LIMIT): string[] {
  const text = formatBlueBubblesText(raw) || '(ไม่มีผลลัพธ์)';
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const paragraph of paragraphs.length ? paragraphs : [text]) {
    if (paragraph.length <= limit) {
      chunks.push(paragraph);
      continue;
    }
    for (let index = 0; index < paragraph.length; index += limit) {
      chunks.push(paragraph.slice(index, index + limit));
    }
  }
  return chunks;
}

async function readBlueBubblesJsonOrThrow<T>(
  response: Response,
  label: string,
  secrets: Array<string | undefined> = [],
): Promise<BlueBubblesResponse<T>> {
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`${label} ${response.status}${text ? `: ${redactBlueBubblesDetail(text, secrets).slice(0, 240)}` : ''}`);
  let json: BlueBubblesResponse<T>;
  try {
    json = (text ? JSON.parse(text) : {}) as BlueBubblesResponse<T>;
  } catch {
    throw new Error(`${label} ${response.status}: response ไม่ใช่ JSON: ${redactBlueBubblesDetail(text, secrets).slice(0, 240)}`);
  }
  const status = typeof json.status === 'number' ? json.status : response.status;
  if (status >= 400 || json.error) {
    const detail = json.error?.error || json.error?.type || json.message || 'unknown error';
    throw new Error(`${label} status ${status}: ${redactBlueBubblesDetail(detail, secrets).slice(0, 200)}`);
  }
  return json;
}

async function postBlueBubbles<T>(config: ResolvedBlueBubblesConfig, path: string, body: Record<string, unknown>): Promise<BlueBubblesResponse<T>> {
  const r = await fetch(blueBubblesApiUrl(config, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readBlueBubblesJsonOrThrow<T>(r, `BlueBubbles ${path}`, [config.password]);
}

async function getBlueBubbles<T>(config: ResolvedBlueBubblesConfig, path: string): Promise<BlueBubblesResponse<T>> {
  const r = await fetch(blueBubblesApiUrl(config, path));
  return readBlueBubblesJsonOrThrow<T>(r, `BlueBubbles ${path}`, [config.password]);
}

async function resolveBlueBubblesChatGuid(config: ResolvedBlueBubblesConfig, target: BlueBubblesResolvedTarget): Promise<string | undefined> {
  if (target.chatGuid) return target.chatGuid;
  const cached = chatGuidCache.get(chatGuidCacheKey(config, target.value));
  if (cached) return cached;
  const res = await postBlueBubbles<BlueBubblesChat[]>(config, '/api/v1/chat/query', {
    limit: 100,
    offset: 0,
    with: ['participants'],
  });
  for (const chat of res.data ?? []) {
    const guid = chat.guid || chat.chatGuid;
    const identifier = chat.chatIdentifier || chat.identifier;
    if (guid && identifier === target.value) {
      rememberChatGuid(config, target.value, guid);
      return guid;
    }
    for (const participant of chat.participants ?? []) {
      if (guid && participant.address?.trim() === target.value) {
        rememberChatGuid(config, target.value, guid);
        return guid;
      }
    }
  }
  return undefined;
}

async function canCreateBlueBubblesChat(config: ResolvedBlueBubblesConfig): Promise<boolean> {
  try {
    const info = await getBlueBubbles<{ private_api?: boolean }>(config, '/api/v1/server/info');
    return Boolean(info.data?.private_api);
  } catch {
    return false;
  }
}

async function createBlueBubblesChat(config: ResolvedBlueBubblesConfig, target: string, message: string): Promise<BlueBubblesSendResult> {
  const res = await postBlueBubbles<BlueBubblesMessageData>(config, '/api/v1/chat/new', {
    addresses: [target],
    message,
    text: message,
    tempGuid: `temp-${randomUUID()}`,
  });
  const messageId = res.data?.guid || res.data?.messageGuid || 'ok';
  return { target, messageIds: [messageId], messageCount: 1 };
}

function looksLikeBlueBubblesAddress(target: string): boolean {
  return target.includes('@') || /^\+\d{7,15}$/.test(target);
}

export async function sendBlueBubblesMessage(
  config: ResolvedBlueBubblesConfig,
  text: string,
  explicitTarget?: string,
): Promise<BlueBubblesSendResult> {
  if (!normalizeBlueBubblesServerUrl(config.serverUrl) || !config.password?.trim()) {
    throw new Error('ยังไม่ได้ตั้ง BlueBubbles server URL/password');
  }
  const target = parseBlueBubblesTarget(config, explicitTarget);
  const chunks = chunkBlueBubblesText(text);
  const messageIds: string[] = [];
  let chatGuid: string | undefined;

  for (const chunk of chunks) {
    chatGuid = await resolveBlueBubblesChatGuid(config, target);
    if (!chatGuid) {
      if (looksLikeBlueBubblesAddress(target.value) && (await canCreateBlueBubblesChat(config))) {
        if (chunks.length > 1) {
          throw new Error(
            'BlueBubbles new chat ยังไม่รองรับข้อความหลายส่วนแบบปลอดภัย — ส่งข้อความแรกให้สั้นลงหรือระบุ chat GUID ที่มีอยู่',
          );
        }
        return createBlueBubblesChat(config, target.value, chunk);
      }
      throw new Error(`BlueBubbles chat not found for target: ${target.value}`);
    }
    const res = await postBlueBubbles<BlueBubblesMessageData>(config, '/api/v1/message/text', {
      chatGuid,
      tempGuid: `temp-${randomUUID()}`,
      message: chunk,
      text: chunk,
    });
    const messageId = res.data?.guid || res.data?.messageGuid || 'ok';
    if (messageId) messageIds.push(String(messageId));
  }

  return {
    target: target.value,
    chatGuid,
    messageIds,
    messageCount: messageIds.length || chunks.length,
  };
}
