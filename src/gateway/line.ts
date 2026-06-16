import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ResolvedLineConfig } from './config.js';
import { redactKey } from '../providers/keys.js';
import { runGatewayAgent } from './session.js';

export interface LineSendResult {
  to: string;
  messageCount: number;
}

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const LINE_TEXT_LIMIT = 5000;
const LINE_PUSH_MESSAGE_LIMIT = 5;

export interface LineWebhookSource {
  type?: string;
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineWebhookEvent {
  type?: string;
  replyToken?: string;
  source?: LineWebhookSource;
  message?: {
    type?: string;
    text?: string;
  };
}

export interface LineWebhookPayload {
  destination?: string;
  events?: LineWebhookEvent[];
}

export interface LineWebhookHandlerOptions {
  rawBody: string;
  signature?: string;
  config: ResolvedLineConfig;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  onLog?: (message: string) => void;
}

export interface LineWebhookHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const runningTargets = new Set<string>();

export function splitLineText(text: string): string[] {
  const trimmed = text.trim() || '(ไม่มีผลลัพธ์)';
  const chunks: string[] = [];
  for (let i = 0; i < trimmed.length && chunks.length < LINE_PUSH_MESSAGE_LIMIT; i += LINE_TEXT_LIMIT) {
    chunks.push(trimmed.slice(i, i + LINE_TEXT_LIMIT));
  }
  return chunks.length ? chunks : ['(ไม่มีผลลัพธ์)'];
}

function lineTextMessages(text: string): { type: 'text'; text: string }[] {
  return splitLineText(text).map((chunk) => ({ type: 'text', text: chunk }));
}

export async function sendLineMessage(channelAccessToken: string, to: string, text: string): Promise<LineSendResult> {
  const messages = lineTextMessages(text);
  const r = await fetch(LINE_PUSH_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${channelAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!r.ok) throw new Error(`LINE push message ${r.status}`);
  return { to, messageCount: messages.length };
}

export async function replyLineMessage(channelAccessToken: string, replyToken: string, text: string): Promise<LineSendResult> {
  const messages = lineTextMessages(text);
  const r = await fetch(LINE_REPLY_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${channelAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!r.ok) throw new Error(`LINE reply message ${r.status}`);
  return { to: replyToken, messageCount: messages.length };
}

export function verifyLineSignature(channelSecret: string, rawBody: string, signature: string | undefined): boolean {
  if (!channelSecret || !signature) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function lineSourceTarget(source: LineWebhookSource | undefined): string | undefined {
  if (!source) return undefined;
  if (source.type === 'user') return source.userId;
  if (source.type === 'group') return source.groupId;
  if (source.type === 'room') return source.roomId;
  return source.userId ?? source.groupId ?? source.roomId;
}

export function isAllowedLineSource(config: ResolvedLineConfig, source: LineWebhookSource | undefined): boolean {
  if (config.allowAllUsers) return true;
  const target = lineSourceTarget(source);
  if (!target) return false;
  if (target === config.homeChannel) return true;
  if (source?.type === 'user') return config.allowedUsers.includes(target);
  if (source?.type === 'group') return config.allowedGroups.includes(target);
  if (source?.type === 'room') return config.allowedRooms.includes(target);
  return [...config.allowedUsers, ...config.allowedGroups, ...config.allowedRooms].includes(target);
}

function parseWebhookPayload(rawBody: string): LineWebhookPayload {
  const parsed = JSON.parse(rawBody) as unknown;
  if (!parsed || typeof parsed !== 'object') return {};
  const payload = parsed as LineWebhookPayload;
  return Array.isArray(payload.events) ? payload : {};
}

function linePrompt(event: LineWebhookEvent, target: string): string {
  const text = event.message?.text?.trim() || '';
  const source = event.source;
  const actor = source?.userId && source.userId !== target ? ` from user ${source.userId}` : '';
  return [`LINE ${source?.type ?? 'unknown'} ${target}${actor}:`, text].join('\n');
}

async function replyOrPush(config: ResolvedLineConfig, event: LineWebhookEvent, target: string, text: string): Promise<void> {
  if (!config.channelAccessToken) throw new Error('LINE channel access token is not configured');
  if (event.replyToken) {
    try {
      await replyLineMessage(config.channelAccessToken, event.replyToken, text);
      return;
    } catch {
      // Reply tokens can expire; fall through to Push so long runs can still deliver.
    }
  }
  await sendLineMessage(config.channelAccessToken, target, text);
}

export async function handleLineWebhook(opts: LineWebhookHandlerOptions): Promise<LineWebhookHandlerResult> {
  if (!opts.config.channelAccessToken || !opts.config.channelSecret) {
    return { status: 503, body: { error: 'line_not_configured' } };
  }
  if (!verifyLineSignature(opts.config.channelSecret, opts.rawBody, opts.signature)) {
    return { status: 401, body: { error: 'invalid_signature' } };
  }

  let payload: LineWebhookPayload;
  try {
    payload = parseWebhookPayload(opts.rawBody);
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }

  let accepted = 0;
  let ignored = 0;
  for (const event of payload.events ?? []) {
    const target = lineSourceTarget(event.source);
    const text = event.type === 'message' && event.message?.type === 'text' ? event.message.text?.trim() : undefined;
    if (!target || !text) {
      ignored += 1;
      continue;
    }
    if (!isAllowedLineSource(opts.config, event.source)) {
      ignored += 1;
      opts.onLog?.(`LINE: ปฏิเสธ target ${target} (ไม่อยู่ใน allowlist)`);
      if (event.replyToken) await replyLineMessage(opts.config.channelAccessToken, event.replyToken, 'ไม่ได้รับอนุญาตให้ใช้ bot นี้').catch(() => {});
      continue;
    }
    if (runningTargets.has(target)) {
      ignored += 1;
      if (event.replyToken) await replyLineMessage(opts.config.channelAccessToken, event.replyToken, 'กำลังทำงานก่อนหน้าอยู่ รอสักครู่').catch(() => {});
      continue;
    }

    accepted += 1;
    runningTargets.add(target);
    try {
      const result = await runGatewayAgent({
        platform: 'line',
        target,
        model: opts.model,
        prompt: linePrompt(event, target),
        userText: text,
        budgetUsd: opts.budgetUsd,
        permissionMode: opts.permissionMode ?? 'ask',
      });
      if (!result.suppressDelivery) await replyOrPush(opts.config, event, target, result.text || '(ไม่มีผลลัพธ์)');
    } catch (e) {
      opts.onLog?.(`LINE run error (${target}): ${redactKey((e as Error).message)}`);
      if (event.replyToken) await replyLineMessage(opts.config.channelAccessToken, event.replyToken, 'เกิดข้อผิดพลาดภายใน').catch(() => {});
    } finally {
      runningTargets.delete(target);
    }
  }

  return { status: 200, body: { ok: true, accepted, ignored } };
}
