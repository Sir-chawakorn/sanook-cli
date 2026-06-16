import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ResolvedSmsConfig } from './config.js';
import { redactKey } from '../providers/keys.js';
import { runGatewayAgent } from './session.js';

export interface SmsSendConfig {
  accountSid?: string;
  authToken?: string;
  phoneNumber?: string;
}

export interface SmsSendResult {
  to: string;
  messageCount: number;
  messageIds: string[];
}

export interface SmsWebhookHandlerOptions {
  rawBody: string;
  signature?: string;
  config: ResolvedSmsConfig;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  onLog?: (message: string) => void;
}

export interface SmsWebhookHandlerResult {
  status: number;
  body: string;
  contentType: string;
}

const SMS_TEXT_LIMIT = 1600;
const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';
const runningTargets = new Set<string>();

export function normalizeSmsPhone(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/[\s().-]+/g, '');
}

export function smsPlainText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

export function splitSmsText(raw: string, limit = SMS_TEXT_LIMIT): string[] {
  let remaining = smsPlainText(raw) || '(ไม่มีผลลัพธ์)';
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

export async function sendSmsMessage(config: SmsSendConfig, to: string, text: string): Promise<SmsSendResult> {
  const accountSid = config.accountSid?.trim();
  const authToken = config.authToken?.trim();
  const from = normalizeSmsPhone(config.phoneNumber);
  const recipient = normalizeSmsPhone(to);
  if (!accountSid || !authToken || !from) throw new Error('Twilio SMS config ต้องมี accountSid, authToken และ phoneNumber');
  if (!recipient) throw new Error('SMS recipient ว่าง');

  const url = `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`, 'utf8').toString('base64');
  const messageIds: string[] = [];
  for (const bodyText of splitSmsText(text)) {
    const body = new URLSearchParams({ From: from, To: recipient, Body: bodyText });
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      throw new Error(`Twilio SMS ${r.status}${detail ? `: ${redactKey(detail).slice(0, 200)}` : ''}`);
    }
    const parsed = (await r.json().catch(() => ({}))) as { sid?: string };
    if (parsed.sid) messageIds.push(parsed.sid);
  }
  return { to: recipient, messageCount: messageIds.length || splitSmsText(text).length, messageIds };
}

export function parseTwilioForm(rawBody: string): URLSearchParams {
  return new URLSearchParams(rawBody);
}

export function verifyTwilioSignature(
  authToken: string | undefined,
  webhookUrl: string | undefined,
  params: URLSearchParams,
  signature: string | undefined,
): boolean {
  if (!authToken || !webhookUrl || !signature) return false;
  const grouped = new Map<string, string[]>();
  for (const [key, value] of params) {
    const list = grouped.get(key) ?? [];
    list.push(value);
    grouped.set(key, list);
  }
  let payload = webhookUrl;
  for (const key of [...grouped.keys()].sort()) {
    for (const value of (grouped.get(key) ?? []).sort()) payload += `${key}${value}`;
  }
  const expected = createHmac('sha1', authToken).update(payload).digest('base64');
  const a = Buffer.from(signature.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAllowedSmsSender(config: ResolvedSmsConfig, from: string | undefined): boolean {
  if (config.allowAllUsers) return true;
  const sender = normalizeSmsPhone(from);
  if (!sender) return false;
  if (sender === normalizeSmsPhone(config.homeChannel)) return true;
  return config.allowedUsers.map(normalizeSmsPhone).includes(sender);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function smsTwiml(messages: string[] = []): string {
  const body = messages
    .flatMap((message) => splitSmsText(message))
    .map((message) => `<Message>${escapeXml(message)}</Message>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

function smsPrompt(params: URLSearchParams, from: string, to: string): string {
  return [`SMS from ${from} to ${to}:`, params.get('Body')?.trim() || '(empty)'].join('\n');
}

function xml(status: number, messages: string[] = []): SmsWebhookHandlerResult {
  return { status, body: smsTwiml(messages), contentType: 'application/xml; charset=utf-8' };
}

export async function handleSmsWebhook(opts: SmsWebhookHandlerOptions): Promise<SmsWebhookHandlerResult> {
  const cfg = opts.config;
  if (!cfg.accountSid || !cfg.authToken || !cfg.phoneNumber) return xml(503);
  if (!cfg.insecureNoSignature && !cfg.webhookUrl) return xml(503);

  const params = parseTwilioForm(opts.rawBody);
  if (!cfg.insecureNoSignature && !verifyTwilioSignature(cfg.authToken, cfg.webhookUrl, params, opts.signature)) {
    return xml(401);
  }

  const from = normalizeSmsPhone(params.get('From') ?? undefined);
  const to = normalizeSmsPhone(params.get('To') ?? undefined);
  const body = params.get('Body')?.trim();
  const messageSid = params.get('MessageSid')?.trim();
  if (!from || !to || !body) return xml(200);
  if (from === normalizeSmsPhone(cfg.phoneNumber)) {
    opts.onLog?.(`SMS: ข้ามข้อความจากเบอร์ Twilio เอง ${from}`);
    return xml(200);
  }
  if (!isAllowedSmsSender(cfg, from)) {
    opts.onLog?.(`SMS: ปฏิเสธ sender ${from} (ไม่อยู่ใน allowlist)`);
    return xml(200, ['ไม่ได้รับอนุญาตให้ใช้ bot นี้']);
  }
  if (runningTargets.has(from)) return xml(200, ['กำลังทำงานก่อนหน้าอยู่ รอสักครู่']);

  runningTargets.add(from);
  try {
    const result = await runGatewayAgent({
      platform: 'sms',
      target: from,
      model: opts.model,
      prompt: smsPrompt(params, from, to),
      userText: body,
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
    });
    if (result.suppressDelivery) return xml(200);
    return xml(200, [result.text || '(ไม่มีผลลัพธ์)']);
  } catch (e) {
    opts.onLog?.(`SMS run error (${messageSid || from}): ${redactKey((e as Error).message)}`);
    return xml(200, ['เกิดข้อผิดพลาดภายใน']);
  } finally {
    runningTargets.delete(from);
  }
}
