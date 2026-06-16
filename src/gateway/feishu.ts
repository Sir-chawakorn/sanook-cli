import type { ResolvedFeishuConfig } from './config.js';
import { redactKey } from '../providers/keys.js';

export type FeishuDomain = 'feishu' | 'lark';

export interface FeishuSendResult {
  chatId: string;
  messageIds: string[];
  messageCount: number;
}

const FEISHU_TEXT_LIMIT = 4_000;
const FEISHU_DEFAULT_BASE_URLS: Record<FeishuDomain, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
};

interface FeishuTenantTokenResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuMessageResponse {
  code?: number;
  msg?: string;
  data?: {
    message_id?: string;
  };
}

function redactFeishuDetail(raw: string, secrets: Array<string | undefined>): string {
  let safe = redactKey(raw);
  for (const secret of secrets) {
    const value = secret?.trim();
    if (value) safe = safe.split(value).join('<secret>');
  }
  return safe;
}

export function normalizeFeishuDomain(raw: string | undefined): FeishuDomain | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value || value === 'feishu' || value === 'cn') return 'feishu';
  if (value === 'lark' || value === 'larksuite' || value === 'global') return 'lark';
  return undefined;
}

export function normalizeFeishuBaseUrl(raw: string | undefined, domain: FeishuDomain = 'feishu'): string | undefined {
  const fallback = FEISHU_DEFAULT_BASE_URLS[domain];
  const value = raw?.trim() || fallback;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function chunkFeishuText(raw: string, limit = FEISHU_TEXT_LIMIT): string[] {
  const text = raw.trim() || '(ไม่มีผลลัพธ์)';
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += limit) {
    chunks.push(text.slice(index, index + limit));
  }
  return chunks;
}

export function feishuApiUrl(
  config: Pick<ResolvedFeishuConfig, 'baseUrl' | 'domain'>,
  path: string,
  searchParams?: Record<string, string>,
): string {
  const baseUrl = normalizeFeishuBaseUrl(config.baseUrl, config.domain);
  if (!baseUrl) throw new Error('Feishu/Lark base URL ต้องเป็น https:// URL');
  const url = new URL(path, `${baseUrl}/`);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function readFeishuJsonOrThrow<T extends { code?: number; msg?: string }>(
  response: Response,
  label: string,
  secrets: Array<string | undefined> = [],
): Promise<T> {
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`${label} ${response.status}${text ? `: ${redactFeishuDetail(text, secrets).slice(0, 240)}` : ''}`);
  const json = (text ? JSON.parse(text) : {}) as T;
  if (typeof json.code === 'number' && json.code !== 0) {
    throw new Error(`${label} code ${json.code}${json.msg ? `: ${redactFeishuDetail(json.msg, secrets).slice(0, 200)}` : ''}`);
  }
  return json;
}

export async function feishuTenantAccessToken(config: ResolvedFeishuConfig): Promise<string> {
  const appId = config.appId?.trim();
  const appSecret = config.appSecret?.trim();
  if (!appId || !appSecret) throw new Error('ยังไม่ได้ตั้ง Feishu/Lark app id หรือ app secret');
  const r = await fetch(feishuApiUrl(config, '/open-apis/auth/v3/tenant_access_token/internal'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = await readFeishuJsonOrThrow<FeishuTenantTokenResponse>(r, 'Feishu/Lark tenant access token', [appSecret]);
  const token = json.tenant_access_token?.trim();
  if (!token) throw new Error('Feishu/Lark tenant access token response ไม่มี token');
  return token;
}

export async function sendFeishuMessage(config: ResolvedFeishuConfig, chatId: string, text: string): Promise<FeishuSendResult> {
  const receiveId = chatId.trim();
  if (!receiveId) throw new Error('Feishu/Lark chat id ว่าง');
  const token = await feishuTenantAccessToken(config);
  const messageIds: string[] = [];
  for (const chunk of chunkFeishuText(text)) {
    const r = await fetch(feishuApiUrl(config, '/open-apis/im/v1/messages', { receive_id_type: 'chat_id' }), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text: chunk }),
      }),
    });
    const json = await readFeishuJsonOrThrow<FeishuMessageResponse>(r, 'Feishu/Lark send message', [config.appSecret, token]);
    const messageId = json.data?.message_id?.trim();
    if (messageId) messageIds.push(messageId);
  }
  return { chatId: receiveId, messageIds, messageCount: messageIds.length || chunkFeishuText(text).length };
}
