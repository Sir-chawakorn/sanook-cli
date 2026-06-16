import type { ResolvedMattermostConfig } from './config.js';
import { BRAND } from '../brand.js';
import { redactKey } from '../providers/keys.js';
import { runGatewayAgent } from './session.js';

export interface MattermostSendResult {
  channelId: string;
  postIds: string[];
  messageCount: number;
}

export interface MattermostUser {
  id?: string;
  username?: string;
}

export interface MattermostPost {
  id?: string;
  user_id?: string;
  channel_id?: string;
  root_id?: string;
  message?: string;
  type?: string;
  create_at?: number;
  props?: Record<string, unknown>;
}

export interface MattermostWebSocketEnvelope {
  event?: string;
  status?: string;
  seq_reply?: number;
  data?: {
    post?: string | MattermostPost;
    channel_type?: string;
    mentions?: string | string[];
  };
  broadcast?: {
    channel_id?: string;
    user_id?: string;
  };
}

export interface MattermostInboundEvent {
  channelId: string;
  userId: string;
  text: string;
  postId?: string;
  rootId?: string;
  channelType?: string;
  createAt?: number;
  isDirect: boolean;
  mentionsBot: boolean;
}

export interface MattermostEventHandlerOptions {
  config: ResolvedMattermostConfig;
  event: MattermostInboundEvent;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  botUsername?: string;
  runningTargets?: Set<string>;
  onLog?: (message: string) => void;
}

export interface MattermostEventResult {
  handled: boolean;
  reason?: string;
}

type WsEvent = { data?: unknown };
type WsLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: WsEvent) => void): void;
};

export interface MattermostGatewayOpts {
  config: ResolvedMattermostConfig;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  webSocketFactory?: (url: string) => WsLike;
  onLog?: (message: string) => void;
}

const MATTERMOST_TEXT_LIMIT = 4000;
const runningTargets = new Set<string>();

export function normalizeMattermostUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

export function mattermostApiUrl(
  config: Pick<ResolvedMattermostConfig, 'serverUrl'>,
  path: string,
  params?: Record<string, string | number | undefined>,
): string {
  const base = normalizeMattermostUrl(config.serverUrl);
  if (!base) throw new Error('Mattermost URL ต้องเป็น URL เช่น https://mm.example.com');
  const url = new URL(`${base}/api/v4/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value != null && String(value).trim()) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function mattermostWebSocketUrl(serverUrl: string | undefined): string {
  const base = normalizeMattermostUrl(serverUrl);
  if (!base) throw new Error('Mattermost URL ต้องเป็น URL เช่น https://mm.example.com');
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const pathBase = url.pathname.replace(/\/+$/, '');
  url.pathname = `${pathBase}/api/v4/websocket`;
  url.search = '';
  return url.toString();
}

export function mattermostAuthHeaders(token: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  const clean = token?.trim();
  if (!clean) throw new Error('Mattermost token ว่าง');
  return { authorization: `Bearer ${clean}`, ...extra };
}

export function splitMattermostText(raw: string, limit = MATTERMOST_TEXT_LIMIT): string[] {
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

async function readJsonOrThrow<T>(response: Response, label: string): Promise<T> {
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`${label} ${response.status}${text ? `: ${redactKey(text).slice(0, 200)}` : ''}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export async function mattermostMe(config: ResolvedMattermostConfig): Promise<MattermostUser> {
  const r = await fetch(mattermostApiUrl(config, '/users/me'), {
    method: 'GET',
    headers: mattermostAuthHeaders(config.token),
  });
  return readJsonOrThrow<MattermostUser>(r, 'Mattermost users/me');
}

export async function sendMattermostMessage(
  config: ResolvedMattermostConfig,
  channelId: string,
  text: string,
  rootId?: string,
): Promise<MattermostSendResult> {
  const channel = channelId.trim();
  if (!channel) throw new Error('Mattermost channel id ว่าง');
  const chunks = splitMattermostText(text);
  const postIds: string[] = [];
  for (const chunk of chunks) {
    const r = await fetch(mattermostApiUrl(config, '/posts'), {
      method: 'POST',
      headers: mattermostAuthHeaders(config.token, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        channel_id: channel,
        message: chunk,
        ...(rootId?.trim() ? { root_id: rootId.trim() } : {}),
      }),
    });
    const parsed = await readJsonOrThrow<{ id?: string; channel_id?: string }>(r, 'Mattermost create post');
    if (parsed.id) postIds.push(parsed.id);
  }
  return { channelId: channel, postIds, messageCount: chunks.length };
}

function parsePost(raw: unknown): MattermostPost | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as MattermostPost) : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof raw === 'object' ? (raw as MattermostPost) : undefined;
}

function parseMentions(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // Some Mattermost-compatible gateways emit comma-separated mention IDs.
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function mattermostMentionsBot(
  text: string,
  envelope: MattermostWebSocketEnvelope,
  botUsername: string | undefined,
  botUserId: string | undefined,
): boolean {
  const mentions = parseMentions(envelope.data?.mentions);
  if (botUserId && mentions.includes(botUserId)) return true;
  const username = botUsername?.trim().replace(/^@/, '');
  if (!username) return false;
  return new RegExp(`(^|\\s)@${escapeRegExp(username)}(\\b|\\s|:)`, 'i').test(text);
}

export function parseMattermostPostedEvent(
  raw: string,
  bot: { userId?: string; username?: string } = {},
): MattermostInboundEvent | null {
  let envelope: MattermostWebSocketEnvelope;
  try {
    envelope = JSON.parse(raw) as MattermostWebSocketEnvelope;
  } catch {
    return null;
  }
  if (envelope.event !== 'posted') return null;
  const post = parsePost(envelope.data?.post);
  const userId = post?.user_id?.trim();
  const channelId = (post?.channel_id ?? envelope.broadcast?.channel_id)?.trim();
  const text = post?.message?.trim();
  if (!userId || !channelId || !text) return null;
  if (bot.userId && userId === bot.userId) return null;
  const channelType = envelope.data?.channel_type?.trim();
  return {
    channelId,
    userId,
    text,
    postId: post?.id,
    rootId: post?.root_id || undefined,
    channelType,
    createAt: post?.create_at,
    isDirect: channelType === 'D',
    mentionsBot: mattermostMentionsBot(text, envelope, bot.username, bot.userId),
  };
}

export function isAllowedMattermostEvent(config: ResolvedMattermostConfig, event: MattermostInboundEvent): boolean {
  if (!event.isDirect && config.allowedChannels.length && !config.allowedChannels.includes(event.channelId)) return false;
  if (config.allowAllUsers) return true;
  return config.allowedUsers.includes(event.userId);
}

export function mattermostShouldRespond(config: ResolvedMattermostConfig, event: MattermostInboundEvent): boolean {
  if (event.isDirect) return true;
  if (config.freeResponseChannels.includes(event.channelId)) return true;
  if (!config.requireMention) return true;
  return event.mentionsBot;
}

export function mattermostUserText(event: MattermostInboundEvent, botUsername?: string): string {
  let text = event.text.replace(/^!(new|reset|status|help)\b/i, '/$1').trim();
  const username = botUsername?.trim().replace(/^@/, '');
  if (username) text = text.replace(new RegExp(`(^|\\s)@${escapeRegExp(username)}(\\b|\\s|:)`, 'gi'), ' ').trim();
  return text || event.text;
}

function mattermostPrompt(event: MattermostInboundEvent): string {
  return [`Mattermost ${event.isDirect ? 'DM' : 'channel'} ${event.channelId} from ${event.userId}:`, event.text].join('\n');
}

function mattermostReplyRootId(config: ResolvedMattermostConfig, event: MattermostInboundEvent): string | undefined {
  return event.rootId || (config.replyMode === 'thread' ? event.postId : undefined);
}

function mattermostSessionTarget(config: ResolvedMattermostConfig, event: MattermostInboundEvent): string {
  if (event.isDirect) return event.channelId;
  const threadId = event.rootId || (config.replyMode === 'thread' ? event.postId : undefined);
  if (threadId) return config.groupSessionsPerUser ? `${event.channelId}:${threadId}:${event.userId}` : `${event.channelId}:${threadId}`;
  return config.groupSessionsPerUser ? `${event.channelId}:${event.userId}` : event.channelId;
}

export async function handleMattermostEvent(opts: MattermostEventHandlerOptions): Promise<MattermostEventResult> {
  const event = opts.event;
  if (!isAllowedMattermostEvent(opts.config, event)) {
    opts.onLog?.(`Mattermost: ปฏิเสธ ${event.userId} ใน ${event.channelId} (ไม่อยู่ใน allowlist)`);
    return { handled: false, reason: 'not_allowed' };
  }
  if (!mattermostShouldRespond(opts.config, event)) return { handled: false, reason: 'not_mentioned' };

  const target = mattermostSessionTarget(opts.config, event);
  const running = opts.runningTargets ?? runningTargets;
  if (running.has(target)) return { handled: false, reason: 'busy' };

  running.add(target);
  try {
    const result = await runGatewayAgent({
      platform: 'mattermost',
      target,
      model: opts.model,
      prompt: mattermostPrompt(event),
      userText: mattermostUserText(event, opts.botUsername),
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
    });
    if (!result.suppressDelivery) {
      await sendMattermostMessage(opts.config, event.channelId, result.text || '(ไม่มีผลลัพธ์)', mattermostReplyRootId(opts.config, event));
    }
    return { handled: true };
  } catch (e) {
    opts.onLog?.(`Mattermost run error (${event.channelId}): ${redactKey((e as Error).message)}`);
    await sendMattermostMessage(opts.config, event.channelId, 'เกิดข้อผิดพลาดภายใน', mattermostReplyRootId(opts.config, event)).catch(
      () => {},
    );
    return { handled: false, reason: 'error' };
  } finally {
    running.delete(target);
  }
}

function defaultWebSocketFactory(url: string): WsLike {
  const WS = globalThis.WebSocket as unknown as { new (url: string): WsLike } | undefined;
  if (!WS) throw new Error('WebSocket runtime ไม่พร้อมใช้งานใน Node นี้');
  return new WS(url);
}

export async function startMattermost(opts: MattermostGatewayOpts): Promise<() => void> {
  if (!normalizeMattermostUrl(opts.config.serverUrl)) {
    opts.onLog?.('Mattermost ไม่เริ่ม: ต้องตั้ง MATTERMOST_URL เช่น https://mm.example.com');
    return () => {};
  }
  if (!opts.config.token?.trim()) {
    opts.onLog?.('Mattermost ไม่เริ่ม: ต้องตั้ง MATTERMOST_TOKEN');
    return () => {};
  }
  if (!opts.config.allowAllUsers && !opts.config.allowedUsers.length) {
    opts.onLog?.('Mattermost ไม่เริ่ม: ต้องตั้ง MATTERMOST_ALLOWED_USERS เพื่อ fail-closed');
    return () => {};
  }

  const me = await mattermostMe(opts.config);
  if (!me.id) throw new Error('Mattermost users/me response ไม่มี id');
  const ws = (opts.webSocketFactory ?? defaultWebSocketFactory)(mattermostWebSocketUrl(opts.config.serverUrl));
  const bot = { userId: me.id, username: me.username };
  let stopped = false;

  ws.addEventListener('open', () => {
    opts.onLog?.(`Mattermost: websocket connecting as @${me.username ?? me.id}`);
    ws.send(
      JSON.stringify({
        seq: 1,
        action: 'authentication_challenge',
        data: { token: opts.config.token },
      }),
    );
  });

  ws.addEventListener('message', (event) => {
    const raw = String(event.data ?? '');
    if (!raw) return;
    try {
      const envelope = JSON.parse(raw) as MattermostWebSocketEnvelope;
      if (envelope.status === 'OK' && envelope.seq_reply === 1) {
        opts.onLog?.('Mattermost: websocket authenticated');
        return;
      }
    } catch {
      return;
    }
    const inbound = parseMattermostPostedEvent(raw, bot);
    if (!inbound) return;
    void handleMattermostEvent({
      config: opts.config,
      event: inbound,
      model: opts.model,
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode,
      botUsername: bot.username,
      runningTargets,
      onLog: opts.onLog,
    });
  });

  ws.addEventListener('close', () => {
    if (!stopped) opts.onLog?.('Mattermost: websocket closed');
  });
  ws.addEventListener('error', () => opts.onLog?.('Mattermost: websocket error'));

  return () => {
    stopped = true;
    ws.close();
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
