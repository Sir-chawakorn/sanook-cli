import type { ResolvedMatrixConfig } from './config.js';
import { BRAND } from '../brand.js';
import { redactKey } from '../providers/keys.js';
import { runGatewayAgent } from './session.js';

export interface MatrixSendResult {
  roomId: string;
  eventIds: string[];
  messageCount: number;
}

export interface MatrixLoginResult {
  accessToken: string;
  userId?: string;
  deviceId?: string;
}

export interface MatrixSyncEvent {
  type?: string;
  event_id?: string;
  sender?: string;
  origin_server_ts?: number;
  content?: {
    msgtype?: string;
    body?: string;
    'm.mentions'?: { user_ids?: string[] };
  };
}

export interface MatrixSyncPayload {
  next_batch?: string;
  account_data?: {
    events?: Array<{ type?: string; content?: Record<string, string[]> }>;
  };
  rooms?: {
    invite?: Record<string, unknown>;
    join?: Record<
      string,
      {
        summary?: { 'm.joined_member_count'?: number; 'm.invited_member_count'?: number };
        timeline?: { events?: MatrixSyncEvent[] };
      }
    >;
  };
}

export interface MatrixInboundEvent {
  roomId: string;
  sender: string;
  text: string;
  eventId?: string;
  originServerTs?: number;
  isDirect: boolean;
  mentionsBot: boolean;
}

export interface MatrixEventHandlerOptions {
  config: ResolvedMatrixConfig;
  event: MatrixInboundEvent;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  runningTargets?: Set<string>;
  onLog?: (message: string) => void;
}

export interface MatrixEventResult {
  handled: boolean;
  reason?: string;
}

export interface MatrixSyncHandlerOptions {
  config: ResolvedMatrixConfig;
  sync: MatrixSyncPayload;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  startupMs?: number;
  runningTargets?: Set<string>;
  onLog?: (message: string) => void;
}

export interface MatrixGatewayOpts {
  config: ResolvedMatrixConfig;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  reconnectMs?: number;
  startupMs?: number;
  onLog?: (message: string) => void;
}

const MATRIX_TEXT_LIMIT = 4000;
const MATRIX_STARTUP_GRACE_MS = 5000;
const runningTargets = new Set<string>();

export function normalizeMatrixHomeserver(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

export function normalizeMatrixUserId(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return /^@[^:\s]+:[^:\s]+$/.test(trimmed) ? trimmed : undefined;
}

export function normalizeMatrixRoomId(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return /^[!#][^:\s]+:[^:\s]+(?::\d+)?$/.test(trimmed) ? trimmed : undefined;
}

export function redactMatrixToken(raw: string | undefined): string {
  const token = raw?.trim();
  if (!token) return '(not set)';
  if (token.length <= 10) return '<redacted>';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function matrixClientUrl(config: Pick<ResolvedMatrixConfig, 'homeserver'>, path: string, params?: Record<string, string | number | undefined>): string {
  const homeserver = normalizeMatrixHomeserver(config.homeserver);
  if (!homeserver) throw new Error('Matrix homeserver ต้องเป็น URL เช่น https://matrix.org');
  const url = new URL(`${homeserver}/_matrix/client/v3/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value != null && String(value).trim()) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function matrixAuthHeaders(accessToken: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  const token = accessToken?.trim();
  if (!token) throw new Error('Matrix access token ว่าง');
  return { authorization: `Bearer ${token}`, ...extra };
}

export function splitMatrixText(raw: string, limit = MATRIX_TEXT_LIMIT): string[] {
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

export async function loginMatrix(config: ResolvedMatrixConfig): Promise<MatrixLoginResult> {
  if (config.accessToken?.trim()) return { accessToken: config.accessToken.trim(), userId: config.userId };
  const user = config.userId?.trim();
  const password = config.password?.trim();
  if (!user || !password) throw new Error('Matrix config ต้องมี accessToken หรือ userId/password');
  const r = await fetch(matrixClientUrl(config, '/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user },
      password,
      initial_device_display_name: `${BRAND.productName} Gateway`,
    }),
  });
  const parsed = await readJsonOrThrow<{ access_token?: string; user_id?: string; device_id?: string }>(r, 'Matrix login');
  if (!parsed.access_token) throw new Error('Matrix login response ไม่มี access_token');
  return { accessToken: parsed.access_token, userId: parsed.user_id ?? user, deviceId: parsed.device_id };
}

export async function matrixWhoami(config: ResolvedMatrixConfig): Promise<{ userId?: string; deviceId?: string }> {
  const auth = await loginMatrix(config);
  const r = await fetch(matrixClientUrl(config, '/account/whoami'), {
    method: 'GET',
    headers: matrixAuthHeaders(auth.accessToken),
  });
  const parsed = await readJsonOrThrow<{ user_id?: string; device_id?: string }>(r, 'Matrix whoami');
  return { userId: parsed.user_id ?? auth.userId, deviceId: parsed.device_id ?? auth.deviceId };
}

export async function sendMatrixMessage(config: ResolvedMatrixConfig, roomId: string, text: string): Promise<MatrixSendResult> {
  const room = normalizeMatrixRoomId(roomId);
  if (!room) throw new Error('Matrix room id ต้องขึ้นต้นด้วย ! หรือ # และมี homeserver เช่น !abc:matrix.org');
  const auth = await loginMatrix(config);
  const chunks = splitMatrixText(text);
  const eventIds: string[] = [];
  for (const body of chunks) {
    const txnId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const r = await fetch(matrixClientUrl(config, `/rooms/${encodeURIComponent(room)}/send/m.room.message/${encodeURIComponent(txnId)}`), {
      method: 'PUT',
      headers: matrixAuthHeaders(auth.accessToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ msgtype: 'm.text', body }),
    });
    const parsed = await readJsonOrThrow<{ event_id?: string }>(r, 'Matrix send');
    if (parsed.event_id) eventIds.push(parsed.event_id);
  }
  return { roomId: room, eventIds, messageCount: chunks.length };
}

export async function joinMatrixRoom(config: ResolvedMatrixConfig, roomId: string): Promise<void> {
  const room = normalizeMatrixRoomId(roomId);
  if (!room) return;
  const auth = await loginMatrix(config);
  const r = await fetch(matrixClientUrl(config, `/join/${encodeURIComponent(room)}`), {
    method: 'POST',
    headers: matrixAuthHeaders(auth.accessToken, { 'content-type': 'application/json' }),
    body: '{}',
  });
  await readJsonOrThrow<Record<string, unknown>>(r, 'Matrix join');
}

export function matrixSyncUrl(config: ResolvedMatrixConfig, since?: string): string {
  return matrixClientUrl(config, '/sync', {
    since,
    timeout: config.pollTimeoutMs,
    set_presence: 'online',
  });
}

export function extractMatrixDirectRooms(sync: MatrixSyncPayload): Set<string> {
  const rooms = new Set<string>();
  for (const event of sync.account_data?.events ?? []) {
    if (event.type !== 'm.direct' || !event.content) continue;
    for (const ids of Object.values(event.content)) {
      if (Array.isArray(ids)) {
        for (const room of ids) if (normalizeMatrixRoomId(room)) rooms.add(room);
      }
    }
  }
  return rooms;
}

export function extractMatrixTextEvents(sync: MatrixSyncPayload, config: ResolvedMatrixConfig, nowMs = Date.now()): MatrixInboundEvent[] {
  const directRooms = extractMatrixDirectRooms(sync);
  const out: MatrixInboundEvent[] = [];
  const botUserId = normalizeMatrixUserId(config.userId);
  const staleBefore = nowMs - MATRIX_STARTUP_GRACE_MS;
  for (const [roomId, room] of Object.entries(sync.rooms?.join ?? {})) {
    const normalizedRoom = normalizeMatrixRoomId(roomId);
    if (!normalizedRoom) continue;
    const isDirect = directRooms.has(normalizedRoom) || (room.summary?.['m.joined_member_count'] ?? 0) <= 2;
    for (const event of room.timeline?.events ?? []) {
      if (event.type !== 'm.room.message') continue;
      const sender = normalizeMatrixUserId(event.sender);
      const text = event.content?.body?.trim();
      const msgtype = event.content?.msgtype;
      if (!sender || !text || !['m.text', 'm.notice'].includes(String(msgtype))) continue;
      if (botUserId && sender === botUserId) continue;
      if (event.origin_server_ts != null && event.origin_server_ts < staleBefore) continue;
      out.push({
        roomId: normalizedRoom,
        sender,
        text,
        eventId: event.event_id,
        originServerTs: event.origin_server_ts,
        isDirect,
        mentionsBot: matrixMentionsBot(text, event, botUserId),
      });
    }
  }
  return out;
}

export function matrixMentionsBot(text: string, event: MatrixSyncEvent, botUserId: string | undefined): boolean {
  if (!botUserId) return false;
  if (event.content?.['m.mentions']?.user_ids?.includes(botUserId)) return true;
  const localpart = botUserId.slice(1).split(':')[0];
  return text.includes(botUserId) || Boolean(localpart && new RegExp(`(^|\\s)@?${escapeRegExp(localpart)}(\\b|\\s|:)`, 'i').test(text));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isAllowedMatrixEvent(config: ResolvedMatrixConfig, event: MatrixInboundEvent): boolean {
  if (config.allowedRooms.length && !event.isDirect && !config.allowedRooms.includes(event.roomId)) return false;
  if (config.allowAllUsers) return true;
  return config.allowedUsers.includes(event.sender);
}

export function matrixShouldRespond(config: ResolvedMatrixConfig, event: MatrixInboundEvent): boolean {
  if (event.isDirect) return true;
  if (config.freeResponseRooms.includes(event.roomId)) return true;
  if (!config.requireMention) return true;
  return event.mentionsBot;
}

function matrixSessionTarget(config: ResolvedMatrixConfig, event: MatrixInboundEvent): string {
  if (event.isDirect || !config.groupSessionsPerUser) return event.roomId;
  return `${event.roomId}:${event.sender}`;
}

function matrixUserText(event: MatrixInboundEvent): string {
  return event.text.replace(/^!(new|reset|status|help)\b/i, '/$1').trim();
}

function matrixPrompt(event: MatrixInboundEvent): string {
  return [`Matrix ${event.isDirect ? 'DM' : 'room'} ${event.roomId} from ${event.sender}:`, event.text].join('\n');
}

export async function handleMatrixEvent(opts: MatrixEventHandlerOptions): Promise<MatrixEventResult> {
  const event = opts.event;
  if (!isAllowedMatrixEvent(opts.config, event)) {
    opts.onLog?.(`Matrix: ปฏิเสธ ${event.sender} ใน ${event.roomId} (ไม่อยู่ใน allowlist)`);
    return { handled: false, reason: 'not_allowed' };
  }
  if (!matrixShouldRespond(opts.config, event)) return { handled: false, reason: 'not_mentioned' };

  const target = matrixSessionTarget(opts.config, event);
  const running = opts.runningTargets ?? runningTargets;
  if (running.has(target)) return { handled: false, reason: 'busy' };

  running.add(target);
  try {
    const result = await runGatewayAgent({
      platform: 'matrix',
      target,
      model: opts.model,
      prompt: matrixPrompt(event),
      userText: matrixUserText(event),
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
    });
    if (!result.suppressDelivery) await sendMatrixMessage(opts.config, event.roomId, result.text || '(ไม่มีผลลัพธ์)');
    return { handled: true };
  } catch (e) {
    opts.onLog?.(`Matrix run error (${event.roomId}): ${redactKey((e as Error).message)}`);
    await sendMatrixMessage(opts.config, event.roomId, 'เกิดข้อผิดพลาดภายใน').catch(() => {});
    return { handled: false, reason: 'error' };
  } finally {
    running.delete(target);
  }
}

export async function handleMatrixSync(opts: MatrixSyncHandlerOptions): Promise<{ handled: number; ignored: number; joined: number }> {
  let handled = 0;
  let ignored = 0;
  let joined = 0;
  if (opts.config.autoJoin) {
    for (const roomId of Object.keys(opts.sync.rooms?.invite ?? {})) {
      try {
        await joinMatrixRoom(opts.config, roomId);
        joined += 1;
      } catch (e) {
        opts.onLog?.(`Matrix join error (${roomId}): ${redactKey((e as Error).message)}`);
      }
    }
  }
  for (const event of extractMatrixTextEvents(opts.sync, opts.config, opts.startupMs ?? Date.now())) {
    const result = await handleMatrixEvent({ ...opts, event });
    if (result.handled) handled += 1;
    else ignored += 1;
  }
  return { handled, ignored, joined };
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

export function startMatrix(opts: MatrixGatewayOpts): () => void {
  if (!normalizeMatrixHomeserver(opts.config.homeserver)) {
    opts.onLog?.('Matrix ไม่เริ่ม: ต้องตั้ง MATRIX_HOMESERVER เช่น https://matrix.org');
    return () => {};
  }
  if (!opts.config.accessToken && (!opts.config.userId || !opts.config.password)) {
    opts.onLog?.('Matrix ไม่เริ่ม: ต้องตั้ง MATRIX_ACCESS_TOKEN หรือ MATRIX_USER_ID/MATRIX_PASSWORD');
    return () => {};
  }
  if (!opts.config.allowAllUsers && !opts.config.allowedUsers.length) {
    opts.onLog?.('Matrix ไม่เริ่ม: ต้องตั้ง MATRIX_ALLOWED_USERS เพื่อ fail-closed');
    return () => {};
  }

  const controller = new AbortController();
  const reconnectMs = opts.reconnectMs ?? 5000;
  const startupMs = opts.startupMs ?? Date.now();
  const loop = async () => {
    let since: string | undefined;
    let runtimeConfig = opts.config;
    opts.onLog?.(`Matrix: syncing ${opts.config.homeserver}`);
    while (!controller.signal.aborted) {
      try {
        if (!runtimeConfig.userId) {
          const whoami = await matrixWhoami(runtimeConfig);
          runtimeConfig = { ...runtimeConfig, userId: whoami.userId };
        }
        const auth = await loginMatrix(runtimeConfig);
        runtimeConfig = { ...runtimeConfig, accessToken: auth.accessToken, userId: runtimeConfig.userId ?? auth.userId };
        const r = await fetch(matrixSyncUrl(runtimeConfig, since), {
          method: 'GET',
          headers: matrixAuthHeaders(auth.accessToken),
          signal: controller.signal,
        });
        const sync = await readJsonOrThrow<MatrixSyncPayload>(r, 'Matrix sync');
        since = sync.next_batch || since;
        await handleMatrixSync({
          config: runtimeConfig,
          sync,
          model: opts.model,
          budgetUsd: opts.budgetUsd,
          permissionMode: opts.permissionMode,
          startupMs,
          runningTargets,
          onLog: opts.onLog,
        });
      } catch (e) {
        if (!controller.signal.aborted) opts.onLog?.(`Matrix sync error: ${redactKey((e as Error).message)}; reconnecting`);
        await delay(reconnectMs, controller.signal);
      }
    }
  };
  void loop();
  return () => controller.abort();
}
