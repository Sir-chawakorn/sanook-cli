import type { ResolvedNtfyConfig } from './config.js';
import { BRAND } from '../brand.js';
import { redactKey } from '../providers/keys.js';
import { runGatewayAgent } from './session.js';

export interface NtfySendOptions {
  title?: string;
  markdown?: boolean;
}

export interface NtfySendResult {
  topic: string;
  messageId?: string;
  messageCount: number;
  truncated: boolean;
}

export interface NtfyEvent {
  id?: string;
  time?: number;
  event?: string;
  topic?: string;
  message?: string;
  title?: string;
  tags?: string[];
  priority?: number;
}

export interface NtfyEventResult {
  handled: boolean;
  reason?: string;
}

export interface NtfyEventHandlerOptions {
  config: ResolvedNtfyConfig;
  event: NtfyEvent;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  runningTargets?: Set<string>;
  onLog?: (message: string) => void;
}

export interface NtfyGatewayOpts {
  config: ResolvedNtfyConfig;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  reconnectMs?: number;
  onLog?: (message: string) => void;
}

const NTFY_MESSAGE_LIMIT_BYTES = 4096;
const NTFY_REPLY_TITLE = BRAND.productName;
const runningTargets = new Set<string>();

function truthyHeader(value: string | undefined): boolean {
  return value === 'true' || value === '1' || value === 'yes';
}

export function ntfyAuthHeader(token: string | undefined): string | undefined {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(':')) return `Basic ${Buffer.from(trimmed, 'utf8').toString('base64')}`;
  return `Bearer ${trimmed}`;
}

export function ntfyTopicUrl(serverUrl: string, topic: string, suffix = ''): string {
  const base = (serverUrl || 'https://ntfy.sh').replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(topic.trim())}${suffix}`;
}

export function truncateNtfyMessage(raw: string, limitBytes = NTFY_MESSAGE_LIMIT_BYTES): { text: string; truncated: boolean } {
  const text = raw.trim() || '(ไม่มีผลลัพธ์)';
  if (Buffer.byteLength(text, 'utf8') <= limitBytes) return { text, truncated: false };
  const suffix = '...';
  const budget = Math.max(1, limitBytes - Buffer.byteLength(suffix, 'utf8'));
  let out = '';
  let used = 0;
  for (const ch of text) {
    const next = Buffer.byteLength(ch, 'utf8');
    if (used + next > budget) break;
    out += ch;
    used += next;
  }
  return { text: `${out.trimEnd()}${suffix}`, truncated: true };
}

export async function sendNtfyMessage(config: ResolvedNtfyConfig, topic: string, text: string, options: NtfySendOptions = {}): Promise<NtfySendResult> {
  const targetTopic = topic.trim();
  if (!targetTopic) throw new Error('ntfy topic ว่าง');
  const body = truncateNtfyMessage(text);
  const headers: Record<string, string> = {
    'content-type': options.markdown ?? config.markdown ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
    title: options.title?.trim() || NTFY_REPLY_TITLE,
  };
  const auth = ntfyAuthHeader(config.token);
  if (auth) headers.authorization = auth;
  if (options.markdown ?? config.markdown) headers.markdown = 'yes';

  const r = await fetch(ntfyTopicUrl(config.serverUrl, targetTopic), {
    method: 'POST',
    headers,
    body: body.text,
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`ntfy publish ${r.status}${detail ? `: ${redactKey(detail).slice(0, 200)}` : ''}`);
  }
  const parsed = (await r.json().catch(() => ({}))) as { id?: string };
  return { topic: targetTopic, messageId: parsed.id, messageCount: 1, truncated: body.truncated };
}

export function parseNtfyJsonLine(line: string): NtfyEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object') return null;
  const event = parsed as NtfyEvent;
  if (event.event !== 'message') return null;
  if (typeof event.message !== 'string' || !event.message.trim()) return null;
  return event;
}

export function isAllowedNtfyTopic(config: ResolvedNtfyConfig, topic: string | undefined): boolean {
  if (config.allowAllUsers) return true;
  const target = topic?.trim();
  if (!target) return false;
  const allowed = new Set([config.topic, config.homeChannel, ...config.allowedUsers].filter((v): v is string => Boolean(v?.trim())));
  return allowed.has(target);
}

function ntfyPrompt(event: NtfyEvent, topic: string): string {
  const parts = [`ntfy topic ${topic}:`, event.message?.trim() || '(empty)'];
  if (event.title?.trim() && event.title !== NTFY_REPLY_TITLE) parts.splice(1, 0, `title: ${event.title.trim()}`);
  return parts.join('\n');
}

export async function handleNtfyEvent(opts: NtfyEventHandlerOptions): Promise<NtfyEventResult> {
  const event = opts.event;
  if (event.event !== 'message' || !event.message?.trim()) return { handled: false, reason: 'ignored_event' };
  if (event.title === NTFY_REPLY_TITLE || truthyHeader(String((event as Record<string, unknown>).sanookReply ?? ''))) {
    return { handled: false, reason: 'self_message' };
  }

  const topic = event.topic?.trim() || opts.config.topic?.trim();
  if (!isAllowedNtfyTopic(opts.config, topic)) {
    opts.onLog?.(`ntfy: ปฏิเสธ topic ${topic ?? '(unknown)'} (ไม่อยู่ใน allowlist)`);
    return { handled: false, reason: 'not_allowed' };
  }
  if (!topic) return { handled: false, reason: 'missing_topic' };

  const running = opts.runningTargets ?? runningTargets;
  if (running.has(topic)) return { handled: false, reason: 'busy' };

  running.add(topic);
  try {
    const result = await runGatewayAgent({
      platform: 'ntfy',
      target: topic,
      model: opts.model,
      prompt: ntfyPrompt(event, topic),
      userText: event.message.trim(),
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
    });
    if (!result.suppressDelivery) {
      await sendNtfyMessage(opts.config, opts.config.publishTopic || topic, result.text || '(ไม่มีผลลัพธ์)', { title: NTFY_REPLY_TITLE });
    }
    return { handled: true };
  } catch (e) {
    opts.onLog?.(`ntfy run error (${topic}): ${redactKey((e as Error).message)}`);
    await sendNtfyMessage(opts.config, opts.config.publishTopic || topic, 'เกิดข้อผิดพลาดภายใน', { title: NTFY_REPLY_TITLE }).catch(() => {});
    return { handled: false, reason: 'error' };
  } finally {
    running.delete(topic);
  }
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function readNtfyStream(response: Response, opts: NtfyGatewayOpts, signal: AbortSignal): Promise<void> {
  if (!response.body) throw new Error('ntfy stream ไม่มี response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (signal.aborted) return;
      try {
        const event = parseNtfyJsonLine(line);
        if (event) await handleNtfyEvent({ ...opts, event, runningTargets });
      } catch (e) {
        opts.onLog?.(`ntfy parse error: ${redactKey((e as Error).message)}`);
      }
    }
    if (done) break;
  }
  const last = pending.trim();
  if (last && !signal.aborted) {
    const event = parseNtfyJsonLine(last);
    if (event) await handleNtfyEvent({ ...opts, event, runningTargets });
  }
}

export function startNtfy(opts: NtfyGatewayOpts): () => void {
  const topic = opts.config.topic?.trim();
  if (!topic) {
    opts.onLog?.('ntfy ไม่เริ่ม: ต้องตั้ง NTFY_TOPIC หรือ gateway setup ntfy --topic');
    return () => {};
  }
  if (!isAllowedNtfyTopic(opts.config, topic)) {
    opts.onLog?.('ntfy ไม่เริ่ม: ต้องตั้ง NTFY_ALLOWED_USERS ให้รวม topic หรือระบุ --allow-all-users เพื่อ fail-closed');
    return () => {};
  }

  const controller = new AbortController();
  const reconnectMs = opts.reconnectMs ?? 5000;
  const headers: Record<string, string> = { accept: 'application/x-ndjson' };
  const auth = ntfyAuthHeader(opts.config.token);
  if (auth) headers.authorization = auth;

  const loop = async () => {
    opts.onLog?.(`ntfy: subscribe ${ntfyTopicUrl(opts.config.serverUrl, topic, '/json?since=1s')}`);
    while (!controller.signal.aborted) {
      try {
        const r = await fetch(ntfyTopicUrl(opts.config.serverUrl, topic, '/json?since=1s'), {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        if (!r.ok) throw new Error(`ntfy subscribe ${r.status}`);
        await readNtfyStream(r, opts, controller.signal);
      } catch (e) {
        if (!controller.signal.aborted) opts.onLog?.(`ntfy stream error: ${redactKey((e as Error).message)}; reconnecting`);
      }
      await delay(reconnectMs, controller.signal);
    }
  };
  void loop();
  return () => controller.abort();
}
