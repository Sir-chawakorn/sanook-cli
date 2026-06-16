import type { ResolvedSignalConfig } from './config.js';
import { BRAND } from '../brand.js';
import { redactKey } from '../providers/keys.js';
import { runGatewayAgent } from './session.js';

export interface SignalSendResult {
  to: string;
  messageCount: number;
  messageIds: string[];
}

export interface SignalInboundEvent {
  target: string;
  sender?: string;
  text: string;
  groupId?: string;
  timestamp?: number | string;
  noteToSelf?: boolean;
}

export interface SignalEventResult {
  handled: boolean;
  reason?: string;
}

export interface SignalEventHandlerOptions {
  config: ResolvedSignalConfig;
  event: SignalInboundEvent;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  runningTargets?: Set<string>;
  onLog?: (message: string) => void;
}

export interface SignalGatewayOpts {
  config: ResolvedSignalConfig;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  reconnectMs?: number;
  onLog?: (message: string) => void;
}

const SIGNAL_TEXT_LIMIT = 8000;
const SIGNAL_DEFAULT_HTTP_URL = 'http://127.0.0.1:8080';
const runningTargets = new Set<string>();
const recentSentTimestamps = new Set<string>();

export function normalizeSignalId(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase().startsWith('group:')) {
    const groupId = trimmed.slice(trimmed.indexOf(':') + 1).trim();
    return groupId ? `group:${groupId}` : undefined;
  }
  if (/^\+?[\d\s().-]+$/.test(trimmed)) return trimmed.replace(/[\s().-]+/g, '');
  return trimmed;
}

export function redactSignalId(raw: string | undefined): string {
  const normalized = normalizeSignalId(raw);
  if (!normalized) return '(not set)';
  if (normalized === '*') return '*';
  const prefix = normalized.startsWith('group:') ? 'group:' : '';
  const value = prefix ? normalized.slice(prefix.length) : normalized;
  if (value.length <= 6) return `${prefix}<redacted>`;
  if (value.startsWith('+') && value.length >= 8) return `${value.slice(0, 4)}…${value.slice(-4)}`;
  return `${prefix}${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function signalHttpUrl(httpUrl: string | undefined): string {
  return (httpUrl?.trim() || SIGNAL_DEFAULT_HTTP_URL).replace(/\/+$/, '');
}

export function signalRpcUrl(httpUrl: string | undefined): string {
  return `${signalHttpUrl(httpUrl)}/api/v1/rpc`;
}

export function signalEventsUrl(httpUrl: string | undefined, account: string): string {
  return `${signalHttpUrl(httpUrl)}/api/v1/events?account=${encodeURIComponent(account)}`;
}

export function signalCheckUrl(httpUrl: string | undefined): string {
  return `${signalHttpUrl(httpUrl)}/api/v1/check`;
}

export function splitSignalText(raw: string, limit = SIGNAL_TEXT_LIMIT): string[] {
  let remaining = raw.trim() || '(ไม่มีผลลัพธ์)';
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

function rememberSentTimestamp(timestamp: unknown): void {
  if (timestamp == null) return;
  const key = String(timestamp);
  recentSentTimestamps.add(key);
  setTimeout(() => recentSentTimestamps.delete(key), 5 * 60_000).unref?.();
}

export async function signalRpc(
  config: Pick<ResolvedSignalConfig, 'httpUrl' | 'account'>,
  method: string,
  params: Record<string, unknown>,
  rpcId: string | number = `${Date.now()}-${Math.random().toString(16).slice(2)}`,
): Promise<unknown> {
  const account = config.account?.trim();
  const body = {
    jsonrpc: '2.0',
    method,
    params: account && params.account == null ? { account, ...params } : params,
    id: rpcId,
  };
  const r = await fetch(signalRpcUrl(config.httpUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Signal JSON-RPC ${r.status}${detail ? `: ${redactKey(detail).slice(0, 200)}` : ''}`);
  }
  const parsed = (await r.json().catch(() => ({}))) as {
    result?: unknown;
    error?: { code?: number; message?: string } | string;
  };
  if (parsed.error) {
    const message = typeof parsed.error === 'string' ? parsed.error : parsed.error.message ?? JSON.stringify(parsed.error);
    throw new Error(`Signal JSON-RPC error: ${redactKey(message)}`);
  }
  return parsed.result;
}

export async function sendSignalMessage(config: ResolvedSignalConfig, target: string, text: string): Promise<SignalSendResult> {
  const account = normalizeSignalId(config.account);
  const to = normalizeSignalId(target);
  if (!config.httpUrl || !account) throw new Error('Signal config ต้องมี httpUrl และ account');
  if (!to) throw new Error('Signal recipient ว่าง');

  const chunks = splitSignalText(text);
  const messageIds: string[] = [];
  for (const chunk of chunks) {
    const params: Record<string, unknown> = to.startsWith('group:')
      ? { account, groupId: to.slice('group:'.length), message: chunk }
      : { account, recipient: [to], message: chunk };
    const result = (await signalRpc({ httpUrl: config.httpUrl, account }, 'send', params)) as { timestamp?: number | string } | number | string | undefined;
    const timestamp = typeof result === 'object' && result ? result.timestamp : result;
    if (timestamp != null) {
      const id = String(timestamp);
      messageIds.push(id);
      rememberSentTimestamp(id);
    }
  }
  return { to, messageCount: chunks.length, messageIds };
}

export function parseSignalSseLine(line: string): unknown | null {
  const trimmed = line.trimEnd();
  if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return null;
  const data = trimmed.slice('data:'.length).trimStart();
  if (!data) return null;
  return JSON.parse(data) as unknown;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function stringField(record: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function numberOrStringField(record: Record<string, unknown> | undefined, ...keys: string[]): number | string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'number' || (typeof value === 'string' && value.trim())) return value;
  }
  return undefined;
}

export function signalEnvelopeMessage(raw: unknown, account?: string): SignalInboundEvent | null {
  const outer = objectRecord(raw);
  const envelope = objectRecord(outer?.envelope) ?? outer;
  if (!envelope) return null;
  if (objectRecord(envelope.storyMessage)) return null;

  const sync = objectRecord(objectRecord(envelope.syncMessage)?.sentMessage);
  if (sync) {
    const data = objectRecord(sync.dataMessage) ?? sync;
    const groupId = stringField(objectRecord(data.groupInfo), 'groupId');
    const destination = normalizeSignalId(stringField(sync, 'destination', 'destinationNumber', 'recipient'));
    const self = normalizeSignalId(account);
    const text = stringField(data, 'message');
    if (!text) return null;
    if (!groupId && (!self || destination !== self)) return null;
    const target = groupId ? `group:${groupId}` : self;
    if (!target) return null;
    return {
      target,
      sender: self,
      text,
      groupId,
      timestamp: numberOrStringField(sync, 'timestamp') ?? numberOrStringField(envelope, 'timestamp'),
      noteToSelf: !groupId,
    };
  }

  const dataMessage = objectRecord(envelope.dataMessage) ?? objectRecord(objectRecord(envelope.editMessage)?.dataMessage);
  if (!dataMessage) return null;
  const text = stringField(dataMessage, 'message');
  if (!text) return null;
  const groupId = stringField(objectRecord(dataMessage.groupInfo), 'groupId');
  const sender = normalizeSignalId(stringField(envelope, 'sourceNumber', 'sourceUuid', 'source'));
  const target = groupId ? `group:${groupId}` : sender;
  if (!target) return null;
  return {
    target,
    sender,
    text,
    groupId,
    timestamp: numberOrStringField(envelope, 'timestamp') ?? numberOrStringField(dataMessage, 'timestamp'),
  };
}

export function isAllowedSignalSource(config: ResolvedSignalConfig, event: SignalInboundEvent): boolean {
  if (event.groupId) {
    const allowed = config.groupAllowedUsers.map((id) => normalizeSignalId(id) ?? id.trim()).filter(Boolean);
    return allowed.includes('*') || allowed.includes(event.groupId) || allowed.includes(`group:${event.groupId}`);
  }
  const sender = normalizeSignalId(event.sender ?? event.target);
  if (!sender) return false;
  if (config.allowAllUsers) return true;
  if (sender === normalizeSignalId(config.homeChannel)) return true;
  return config.allowedUsers.map(normalizeSignalId).includes(sender);
}

function signalPrompt(event: SignalInboundEvent): string {
  if (event.groupId) {
    const sender = event.sender ? ` from ${redactSignalId(event.sender)}` : '';
    return [`Signal group ${redactSignalId(event.target)}${sender}:`, event.text.trim()].join('\n');
  }
  return [`Signal from ${redactSignalId(event.sender ?? event.target)}:`, event.text.trim()].join('\n');
}

function signalMentioned(config: ResolvedSignalConfig, event: SignalInboundEvent): boolean {
  if (!event.groupId || !config.requireMention) return true;
  const account = normalizeSignalId(config.account);
  return Boolean(account && event.text.includes(account));
}

export async function handleSignalEvent(opts: SignalEventHandlerOptions): Promise<SignalEventResult> {
  const event = opts.event;
  const text = event.text.trim();
  if (!text) return { handled: false, reason: 'empty' };
  if (event.timestamp != null && recentSentTimestamps.has(String(event.timestamp))) return { handled: false, reason: 'self_message' };
  const account = normalizeSignalId(opts.config.account);
  if (account && normalizeSignalId(event.sender) === account && !event.noteToSelf) return { handled: false, reason: 'self_message' };
  if (!isAllowedSignalSource(opts.config, event)) {
    opts.onLog?.(`Signal: ปฏิเสธ target ${redactSignalId(event.target)} (ไม่อยู่ใน allowlist)`);
    return { handled: false, reason: 'not_allowed' };
  }
  if (!signalMentioned(opts.config, event)) return { handled: false, reason: 'not_mentioned' };

  const running = opts.runningTargets ?? runningTargets;
  if (running.has(event.target)) return { handled: false, reason: 'busy' };

  running.add(event.target);
  try {
    const result = await runGatewayAgent({
      platform: 'signal',
      target: event.target,
      model: opts.model,
      prompt: signalPrompt(event),
      userText: text,
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
    });
    if (!result.suppressDelivery) await sendSignalMessage(opts.config, event.target, result.text || '(ไม่มีผลลัพธ์)');
    return { handled: true };
  } catch (e) {
    opts.onLog?.(`Signal run error (${redactSignalId(event.target)}): ${redactKey((e as Error).message)}`);
    await sendSignalMessage(opts.config, event.target, 'เกิดข้อผิดพลาดภายใน').catch(() => {});
    return { handled: false, reason: 'error' };
  } finally {
    running.delete(event.target);
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

async function readSignalStream(response: Response, opts: SignalGatewayOpts, signal: AbortSignal): Promise<void> {
  if (!response.body) throw new Error('Signal stream ไม่มี response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let dataLines: string[] = [];
  const flush = async () => {
    if (!dataLines.length || signal.aborted) return;
    const raw = dataLines.join('\n');
    dataLines = [];
    const parsed = JSON.parse(raw) as unknown;
    const event = signalEnvelopeMessage(parsed, opts.config.account);
    if (event) await handleSignalEvent({ ...opts, event, runningTargets });
  };

  for (;;) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (signal.aborted) return;
      if (!line.trim()) {
        await flush();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }
    if (done) break;
  }
  if (pending.startsWith('data:')) dataLines.push(pending.slice('data:'.length).trimStart());
  await flush();
}

export function startSignal(opts: SignalGatewayOpts): () => void {
  const account = normalizeSignalId(opts.config.account);
  if (!account) {
    opts.onLog?.('Signal ไม่เริ่ม: ต้องตั้ง SIGNAL_ACCOUNT หรือ gateway setup signal --account <+E.164>');
    return () => {};
  }
  if (!opts.config.allowAllUsers && !opts.config.homeChannel && !opts.config.allowedUsers.length && !opts.config.groupAllowedUsers.length) {
    opts.onLog?.('Signal ไม่เริ่ม: ต้องตั้ง home channel หรือ allowlist เพื่อ fail-closed');
    return () => {};
  }

  const controller = new AbortController();
  const reconnectMs = opts.reconnectMs ?? 5000;
  const loop = async () => {
    opts.onLog?.(`Signal: subscribe ${signalEventsUrl(opts.config.httpUrl, account)}`);
    while (!controller.signal.aborted) {
      try {
        const health = await fetch(signalCheckUrl(opts.config.httpUrl), { signal: controller.signal });
        if (!health.ok) throw new Error(`Signal health ${health.status}`);
        const r = await fetch(signalEventsUrl(opts.config.httpUrl, account), {
          method: 'GET',
          headers: { accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!r.ok) throw new Error(`Signal events ${r.status}`);
        await readSignalStream(r, opts, controller.signal);
      } catch (e) {
        if (!controller.signal.aborted) opts.onLog?.(`Signal stream error: ${redactKey((e as Error).message)}; reconnecting`);
      }
      await delay(reconnectMs, controller.signal);
    }
  };
  void loop();
  return () => controller.abort();
}
