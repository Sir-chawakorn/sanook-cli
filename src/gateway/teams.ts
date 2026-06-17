import type { ResolvedTeamsConfig } from './config.js';
import { redactKey } from '../providers/keys.js';

export type TeamsDeliveryMode = 'incoming_webhook' | 'graph';

export interface TeamsSendResult {
  mode: TeamsDeliveryMode;
  target: string;
  messageId?: string;
  messageCount: number;
}

const TEAMS_TEXT_LIMIT = 28_000;
const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';

export function normalizeTeamsWebhookUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function truncateTeamsText(raw: string, limit = TEAMS_TEXT_LIMIT): string {
  const text = raw.trim() || '(ไม่มีผลลัพธ์)';
  return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 3)).trimEnd()}...`;
}

export function teamsGraphAuthHeaders(token: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  const clean = token?.trim();
  if (!clean) throw new Error('Microsoft Teams Graph access token ว่าง');
  return { authorization: `Bearer ${clean}`, ...extra };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function teamsGraphHtml(raw: string): string {
  return escapeHtml(truncateTeamsText(raw)).replace(/\n/g, '<br>');
}

export function teamsGraphMessageUrl(config: ResolvedTeamsConfig, explicitTarget?: string): { url: string; target: string } {
  const target = explicitTarget?.trim();
  if (target?.startsWith('team/')) {
    const match = /^team\/([^/]+)\/channel\/(.+)$/.exec(target);
    if (!match) throw new Error('Teams target ต้องเป็น teams:team/<team-id>/channel/<channel-id>');
    return {
      url: `${GRAPH_ROOT}/teams/${encodeURIComponent(match[1])}/channels/${encodeURIComponent(match[2])}/messages`,
      target,
    };
  }
  const chatId = target || config.chatId || config.homeChannel;
  if (chatId) return { url: `${GRAPH_ROOT}/chats/${encodeURIComponent(chatId)}/messages`, target: chatId };
  if (config.teamId && config.channelId) {
    return {
      url: `${GRAPH_ROOT}/teams/${encodeURIComponent(config.teamId)}/channels/${encodeURIComponent(config.channelId)}/messages`,
      target: `team/${config.teamId}/channel/${config.channelId}`,
    };
  }
  throw new Error('Teams Graph delivery ต้องมี TEAMS_CHAT_ID หรือ TEAMS_TEAM_ID + TEAMS_CHANNEL_ID');
}

async function readTeamsJsonOrThrow<T>(response: Response, label: string): Promise<T> {
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`${label} ${response.status}${text ? `: ${redactKey(text).slice(0, 240)}` : ''}`);
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} ${response.status}: response ไม่ใช่ JSON: ${redactKey(text).slice(0, 240)}`);
  }
}

export async function sendTeamsMessage(
  config: ResolvedTeamsConfig,
  text: string,
  explicitTarget?: string,
): Promise<TeamsSendResult> {
  const target = explicitTarget?.trim();
  const targetLooksLikeWebhook = /^https:\/\//i.test(target ?? '');
  const targetWebhookUrl = targetLooksLikeWebhook ? normalizeTeamsWebhookUrl(target) : undefined;
  if (targetLooksLikeWebhook && !targetWebhookUrl) throw new Error('Teams incoming webhook target ต้องเป็น HTTPS URL ที่ถูกต้อง');
  const useWebhook = Boolean(targetWebhookUrl) || (!target && config.deliveryMode === 'incoming_webhook');
  if (useWebhook) {
    const webhookUrl = targetWebhookUrl ?? config.incomingWebhookUrl;
    if (!webhookUrl) throw new Error('ยังไม่ได้ตั้ง Microsoft Teams incoming webhook URL');
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: truncateTeamsText(text) }),
    });
    await readTeamsJsonOrThrow<unknown>(r, 'Microsoft Teams incoming webhook');
    return { mode: 'incoming_webhook', target: targetWebhookUrl ? 'webhook' : config.homeChannel || 'webhook', messageCount: 1 };
  }

  const graph = teamsGraphMessageUrl(config, target);
  const r = await fetch(graph.url, {
    method: 'POST',
    headers: teamsGraphAuthHeaders(config.graphAccessToken, { 'content-type': 'application/json' }),
    body: JSON.stringify({
      body: {
        contentType: 'html',
        content: teamsGraphHtml(text),
      },
    }),
  });
  const json = await readTeamsJsonOrThrow<{ id?: string }>(r, 'Microsoft Teams Graph message');
  return { mode: 'graph', target: graph.target, messageId: json.id, messageCount: 1 };
}
