import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ResolvedWhatsAppConfig } from './config.js';
import { redactKey } from '../providers/keys.js';
import { runGatewayAgent } from './session.js';

export interface WhatsAppSendResult {
  to: string;
  messageCount: number;
  messageIds: string[];
}

export interface WhatsAppWebhookMessage {
  from: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
}

export interface WhatsAppInboundEvent {
  from: string;
  text: string;
  messageId?: string;
  timestamp?: string;
  profileName?: string;
}

export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: WhatsAppWebhookMessage[];
      };
    }>;
  }>;
}

export interface WhatsAppWebhookHandlerOptions {
  rawBody: string;
  signature?: string;
  config: ResolvedWhatsAppConfig;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  runningTargets?: Set<string>;
  onLog?: (message: string) => void;
}

export interface WhatsAppWebhookHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export interface WhatsAppChallengeResult {
  status: number;
  body: string;
  contentType: string;
}

const WHATSAPP_GRAPH_BASE = 'https://graph.facebook.com';
const WHATSAPP_TEXT_LIMIT = 4096;
const seenMessageIds = new Set<string>();
const runningTargets = new Set<string>();

export function normalizeWhatsAppId(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const compact = trimmed.replace(/[\s()+.-]+/g, '');
  return /^\d+$/.test(compact) ? compact : undefined;
}

export function redactWhatsAppId(raw: string | undefined): string {
  const normalized = normalizeWhatsAppId(raw);
  if (!normalized) return '(not set)';
  if (normalized.length <= 6) return '<redacted>';
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

export function whatsAppMessagesUrl(config: Pick<ResolvedWhatsAppConfig, 'apiVersion' | 'phoneNumberId'>): string {
  const apiVersion = (config.apiVersion || 'v20.0').replace(/^\/+|\/+$/g, '');
  const phoneNumberId = config.phoneNumberId?.trim();
  if (!phoneNumberId) throw new Error('WhatsApp Cloud phone number id ว่าง');
  return `${WHATSAPP_GRAPH_BASE}/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`;
}

export function whatsAppPlainText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/__([^_]+)__/g, '_$1_')
    .replace(/~~([^~]+)~~/g, '~$1~')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

export function splitWhatsAppText(raw: string, limit = WHATSAPP_TEXT_LIMIT): string[] {
  let remaining = whatsAppPlainText(raw) || '(ไม่มีผลลัพธ์)';
  const chunks: string[] = [];
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    let cut = window.lastIndexOf('\n');
    if (cut < Math.floor(limit * 0.4)) cut = window.lastIndexOf(' ');
    if (cut < Math.floor(limit * 0.4)) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks.length ? chunks : ['(ไม่มีผลลัพธ์)'];
}

export async function sendWhatsAppMessage(config: ResolvedWhatsAppConfig, to: string, text: string): Promise<WhatsAppSendResult> {
  const phoneNumberId = config.phoneNumberId?.trim();
  const accessToken = config.accessToken?.trim();
  const recipient = normalizeWhatsAppId(to);
  if (!phoneNumberId || !accessToken) throw new Error('WhatsApp Cloud config ต้องมี phoneNumberId และ accessToken');
  if (!recipient) throw new Error('WhatsApp recipient ว่าง');

  const chunks = splitWhatsAppText(text);
  const messageIds: string[] = [];
  for (const body of chunks) {
    const r = await fetch(whatsAppMessagesUrl(config), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: { preview_url: false, body },
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      throw new Error(`WhatsApp Cloud send ${r.status}${detail ? `: ${redactKey(detail).slice(0, 200)}` : ''}`);
    }
    const parsed = (await r.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };
    for (const message of parsed.messages ?? []) {
      if (message.id) messageIds.push(message.id);
    }
  }
  return { to: recipient, messageCount: chunks.length, messageIds };
}

export function verifyWhatsAppSignature(appSecret: string | undefined, rawBody: string, signature: string | undefined): boolean {
  const secret = appSecret?.trim();
  const header = signature?.trim();
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function handleWhatsAppChallenge(config: ResolvedWhatsAppConfig, params: URLSearchParams): WhatsAppChallengeResult {
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge') ?? '';
  if (mode !== 'subscribe' || !config.verifyToken || token !== config.verifyToken) {
    return { status: 403, body: 'forbidden', contentType: 'text/plain; charset=utf-8' };
  }
  return { status: 200, body: challenge, contentType: 'text/plain; charset=utf-8' };
}

function parseWhatsAppPayload(rawBody: string): WhatsAppWebhookPayload {
  const parsed = JSON.parse(rawBody) as unknown;
  return parsed && typeof parsed === 'object' ? (parsed as WhatsAppWebhookPayload) : {};
}

export function extractWhatsAppTextEvents(payload: WhatsAppWebhookPayload): WhatsAppInboundEvent[] {
  const out: WhatsAppInboundEvent[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const contacts = new Map<string, string>();
      for (const contact of change.value?.contacts ?? []) {
        if (contact.wa_id) contacts.set(contact.wa_id, contact.profile?.name ?? '');
      }
      for (const message of change.value?.messages ?? []) {
        const from = normalizeWhatsAppId(message.from);
        const text = message.type === 'text' ? message.text?.body?.trim() : undefined;
        if (!from || !text) continue;
        out.push({
          from,
          text,
          messageId: message.id,
          timestamp: message.timestamp,
          profileName: contacts.get(from),
        });
      }
    }
  }
  return out;
}

export function isAllowedWhatsAppSender(config: ResolvedWhatsAppConfig, from: string | undefined): boolean {
  if (config.allowAllUsers) return true;
  const sender = normalizeWhatsAppId(from);
  if (!sender) return false;
  if (sender === normalizeWhatsAppId(config.homeChannel)) return true;
  return config.allowedUsers.map(normalizeWhatsAppId).includes(sender);
}

function rememberMessageId(id: string | undefined): boolean {
  if (!id) return true;
  if (seenMessageIds.has(id)) return false;
  seenMessageIds.add(id);
  if (seenMessageIds.size > 5000) {
    const first = seenMessageIds.values().next().value as string | undefined;
    if (first) seenMessageIds.delete(first);
  }
  return true;
}

function whatsAppPrompt(event: WhatsAppInboundEvent): string {
  const name = event.profileName?.trim();
  return [`WhatsApp from ${name ? `${name} ` : ''}${redactWhatsAppId(event.from)}:`, event.text].join('\n');
}

export async function handleWhatsAppWebhook(opts: WhatsAppWebhookHandlerOptions): Promise<WhatsAppWebhookHandlerResult> {
  if (!opts.config.phoneNumberId || !opts.config.accessToken) return { status: 503, body: { error: 'whatsapp_not_configured' } };
  if (!opts.config.appSecret) return { status: 503, body: { error: 'whatsapp_app_secret_required' } };
  if (!verifyWhatsAppSignature(opts.config.appSecret, opts.rawBody, opts.signature)) {
    return { status: 401, body: { error: 'invalid_signature' } };
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = parseWhatsAppPayload(opts.rawBody);
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }

  let accepted = 0;
  let ignored = 0;
  const running = opts.runningTargets ?? runningTargets;
  for (const event of extractWhatsAppTextEvents(payload)) {
    if (!rememberMessageId(event.messageId)) {
      ignored += 1;
      continue;
    }
    if (!isAllowedWhatsAppSender(opts.config, event.from)) {
      ignored += 1;
      opts.onLog?.(`WhatsApp: ปฏิเสธ sender ${redactWhatsAppId(event.from)} (ไม่อยู่ใน allowlist)`);
      continue;
    }
    if (running.has(event.from)) {
      ignored += 1;
      await sendWhatsAppMessage(opts.config, event.from, 'กำลังทำงานก่อนหน้าอยู่ รอสักครู่').catch(() => {});
      continue;
    }

    accepted += 1;
    running.add(event.from);
    try {
      const result = await runGatewayAgent({
        platform: 'whatsapp',
        target: event.from,
        model: opts.model,
        prompt: whatsAppPrompt(event),
        userText: event.text,
        budgetUsd: opts.budgetUsd,
        permissionMode: opts.permissionMode ?? 'ask',
      });
      if (!result.suppressDelivery) await sendWhatsAppMessage(opts.config, event.from, result.text || '(ไม่มีผลลัพธ์)');
    } catch (e) {
      opts.onLog?.(`WhatsApp run error (${redactWhatsAppId(event.from)}): ${redactKey((e as Error).message)}`);
      await sendWhatsAppMessage(opts.config, event.from, 'เกิดข้อผิดพลาดภายใน').catch(() => {});
    } finally {
      running.delete(event.from);
    }
  }

  return { status: 200, body: { ok: true, accepted, ignored } };
}
