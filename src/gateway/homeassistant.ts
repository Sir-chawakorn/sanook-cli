import type { ResolvedHomeAssistantConfig } from './config.js';
import { BRAND } from '../brand.js';
import { redactKey } from '../providers/keys.js';
import { runGatewayAgent } from './session.js';

export interface HomeAssistantSendResult {
  notificationId?: string;
  messageId?: string;
  messageCount: number;
}

export interface HomeAssistantState {
  state?: string;
  attributes?: Record<string, unknown>;
  entity_id?: string;
  last_changed?: string;
  last_updated?: string;
}

export interface HomeAssistantStateChangedEvent {
  event_type?: string;
  time_fired?: string;
  data?: {
    entity_id?: string;
    old_state?: HomeAssistantState | null;
    new_state?: HomeAssistantState | null;
  };
}

export interface HomeAssistantWebSocketMessage {
  id?: number;
  type?: string;
  success?: boolean;
  event?: HomeAssistantStateChangedEvent;
  message?: string;
}

export interface HomeAssistantEventResult {
  handled: boolean;
  reason?: string;
}

export interface HomeAssistantEventHandlerOptions {
  config: ResolvedHomeAssistantConfig;
  event: HomeAssistantStateChangedEvent;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  runningTargets?: Set<string>;
  lastEventTime?: Map<string, number>;
  nowSeconds?: number;
  onLog?: (message: string) => void;
}

type WsEvent = { data?: unknown };
type WsLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: WsEvent) => void): void;
};

export interface HomeAssistantGatewayOpts {
  config: ResolvedHomeAssistantConfig;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  reconnectMs?: number;
  webSocketFactory?: (url: string) => WsLike;
  onLog?: (message: string) => void;
}

const HA_TEXT_LIMIT = 4096;
const HA_DEFAULT_NOTIFICATION_ID = 'sanook_agent';
const runningTargets = new Set<string>();
const lastEventTime = new Map<string, number>();

export function normalizeHomeAssistantUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

export function homeAssistantApiUrl(config: Pick<ResolvedHomeAssistantConfig, 'url'>, path: string): string {
  const base = normalizeHomeAssistantUrl(config.url);
  if (!base) throw new Error('Home Assistant URL ต้องเป็น URL เช่น http://homeassistant.local:8123');
  return `${base}/api/${path.replace(/^\/+/, '')}`;
}

export function homeAssistantWebSocketUrl(url: string | undefined): string {
  const base = normalizeHomeAssistantUrl(url);
  if (!base) throw new Error('Home Assistant URL ต้องเป็น URL เช่น http://homeassistant.local:8123');
  const parsed = new URL(base);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/api/websocket`;
  parsed.search = '';
  return parsed.toString();
}

export function homeAssistantAuthHeaders(token: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  const clean = token?.trim();
  if (!clean) throw new Error('Home Assistant token ว่าง');
  return { authorization: `Bearer ${clean}`, ...extra };
}

export function truncateHomeAssistantMessage(raw: string, limit = HA_TEXT_LIMIT): string {
  const text = raw.trim() || '(ไม่มีผลลัพธ์)';
  return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 3)).trimEnd()}...`;
}

export async function readHomeAssistantJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`${label} ${response.status}${text ? `: ${redactKey(text).slice(0, 200)}` : ''}`);
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} ${response.status}: response ไม่ใช่ JSON: ${redactKey(text).slice(0, 200)}`);
  }
}

export async function sendHomeAssistantNotification(
  config: ResolvedHomeAssistantConfig,
  text: string,
  notificationId?: string,
): Promise<HomeAssistantSendResult> {
  const id = notificationId?.trim() || config.homeChannel?.trim() || HA_DEFAULT_NOTIFICATION_ID;
  const r = await fetch(homeAssistantApiUrl(config, '/services/persistent_notification/create'), {
    method: 'POST',
    headers: homeAssistantAuthHeaders(config.token, { 'content-type': 'application/json' }),
    body: JSON.stringify({
      title: BRAND.productName,
      message: truncateHomeAssistantMessage(text),
      notification_id: id,
    }),
  });
  await readHomeAssistantJsonResponse<unknown>(r, 'Home Assistant persistent_notification.create');
  return { notificationId: id, messageId: `${id}:${Date.now()}`, messageCount: 1 };
}

export function homeAssistantDomain(entityId: string): string {
  return entityId.includes('.') ? entityId.split('.')[0] : '';
}

export function shouldForwardHomeAssistantEvent(
  config: ResolvedHomeAssistantConfig,
  event: HomeAssistantStateChangedEvent,
  state: { lastEventTime?: Map<string, number>; nowSeconds?: number } = {},
): { ok: boolean; reason?: string; entityId?: string } {
  const entityId = event.data?.entity_id?.trim();
  if (!entityId) return { ok: false, reason: 'missing_entity' };
  if (config.ignoreEntities.includes(entityId)) return { ok: false, reason: 'ignored_entity', entityId };

  const domain = homeAssistantDomain(entityId);
  if (config.watchDomains.length || config.watchEntities.length) {
    const domainMatch = config.watchDomains.includes(domain);
    const entityMatch = config.watchEntities.includes(entityId);
    if (!domainMatch && !entityMatch) return { ok: false, reason: 'not_watched', entityId };
  } else if (!config.watchAll) {
    return { ok: false, reason: 'not_watched', entityId };
  }

  const oldValue = event.data?.old_state?.state ?? 'unknown';
  const newValue = event.data?.new_state?.state ?? 'unknown';
  if (oldValue === newValue) return { ok: false, reason: 'unchanged', entityId };

  const seen = state.lastEventTime;
  if (seen) {
    const now = state.nowSeconds ?? Date.now() / 1000;
    const last = seen.get(entityId) ?? 0;
    if (now - last < config.cooldownSeconds) return { ok: false, reason: 'cooldown', entityId };
    seen.set(entityId, now);
  }
  return { ok: true, entityId };
}

export function formatHomeAssistantStateChange(event: HomeAssistantStateChangedEvent): string | undefined {
  const entityId = event.data?.entity_id?.trim();
  const newState = event.data?.new_state;
  if (!entityId || !newState) return undefined;
  const oldValue = event.data?.old_state?.state ?? 'unknown';
  const newValue = newState.state ?? 'unknown';
  if (oldValue === newValue) return undefined;
  const attrs = newState.attributes ?? {};
  const friendly = String(attrs.friendly_name ?? entityId);
  const domain = homeAssistantDomain(entityId);

  if (domain === 'climate') {
    const current = attrs.current_temperature ?? '?';
    const target = attrs.temperature ?? '?';
    return `[Home Assistant] ${friendly}: HVAC mode changed from '${oldValue}' to '${newValue}' (current: ${current}, target: ${target})`;
  }
  if (domain === 'sensor') {
    const unit = String(attrs.unit_of_measurement ?? '');
    return `[Home Assistant] ${friendly}: changed from ${oldValue}${unit} to ${newValue}${unit}`;
  }
  if (domain === 'binary_sensor') {
    const oldText = oldValue === 'on' ? 'triggered' : 'cleared';
    const newText = newValue === 'on' ? 'triggered' : 'cleared';
    return `[Home Assistant] ${friendly}: ${newText} (was ${oldText})`;
  }
  if (['light', 'switch', 'fan'].includes(domain)) {
    return `[Home Assistant] ${friendly}: turned ${newValue === 'on' ? 'on' : 'off'}`;
  }
  if (domain === 'alarm_control_panel') {
    return `[Home Assistant] ${friendly}: alarm state changed from '${oldValue}' to '${newValue}'`;
  }
  return `[Home Assistant] ${friendly} (${entityId}): changed from '${oldValue}' to '${newValue}'`;
}

export async function handleHomeAssistantEvent(opts: HomeAssistantEventHandlerOptions): Promise<HomeAssistantEventResult> {
  const allowed = shouldForwardHomeAssistantEvent(opts.config, opts.event, {
    lastEventTime: opts.lastEventTime,
    nowSeconds: opts.nowSeconds,
  });
  if (!allowed.ok) return { handled: false, reason: allowed.reason };

  const text = formatHomeAssistantStateChange(opts.event);
  if (!text) return { handled: false, reason: 'empty_message' };

  const target = opts.config.homeChannel || 'ha_events';
  const running = opts.runningTargets ?? runningTargets;
  if (running.has(target)) return { handled: false, reason: 'busy' };

  running.add(target);
  try {
    const result = await runGatewayAgent({
      platform: 'homeassistant',
      target,
      model: opts.model,
      prompt: text,
      userText: text,
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
    });
    if (!result.suppressDelivery) await sendHomeAssistantNotification(opts.config, result.text || '(ไม่มีผลลัพธ์)', target);
    return { handled: true };
  } catch (e) {
    opts.onLog?.(`Home Assistant run error (${allowed.entityId ?? 'event'}): ${redactKey((e as Error).message)}`);
    await sendHomeAssistantNotification(opts.config, 'เกิดข้อผิดพลาดภายใน', target).catch(() => {});
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

export function startHomeAssistant(opts: HomeAssistantGatewayOpts): () => void {
  if (!normalizeHomeAssistantUrl(opts.config.url)) {
    opts.onLog?.('Home Assistant ไม่เริ่ม: ต้องตั้ง HASS_URL เช่น http://homeassistant.local:8123');
    return () => {};
  }
  if (!opts.config.token?.trim()) {
    opts.onLog?.('Home Assistant ไม่เริ่ม: ต้องตั้ง HASS_TOKEN');
    return () => {};
  }
  if (!opts.config.watchAll && !opts.config.watchDomains.length && !opts.config.watchEntities.length) {
    opts.onLog?.('Home Assistant: ยังไม่มี watch_domains/watch_entities/watch_all — จะเชื่อมต่อแต่ drop state_changed ทั้งหมด');
  }

  const reconnectMs = opts.reconnectMs ?? 5000;
  const webSocketFactory = opts.webSocketFactory ?? defaultWebSocketFactory;
  let stopped = false;
  let ws: WsLike | undefined;
  let reconnect: NodeJS.Timeout | undefined;
  let subscribeId = 0;

  const connect = (): void => {
    if (stopped) return;
    ws = webSocketFactory(homeAssistantWebSocketUrl(opts.config.url));
    ws.addEventListener('open', () => opts.onLog?.(`Home Assistant: websocket connecting ${opts.config.url}`));
    ws.addEventListener('message', (event) => {
      let msg: HomeAssistantWebSocketMessage;
      try {
        msg = JSON.parse(String(event.data ?? '{}')) as HomeAssistantWebSocketMessage;
      } catch {
        return;
      }
      if (msg.type === 'auth_required') {
        ws?.send(JSON.stringify({ type: 'auth', access_token: opts.config.token }));
        return;
      }
      if (msg.type === 'auth_ok') {
        subscribeId += 1;
        ws?.send(JSON.stringify({ id: subscribeId, type: 'subscribe_events', event_type: 'state_changed' }));
        return;
      }
      if (msg.type === 'auth_invalid') {
        opts.onLog?.(`Home Assistant auth failed: ${redactKey(msg.message ?? 'auth_invalid')}`);
        return;
      }
      if (msg.id === subscribeId && msg.success === true) {
        opts.onLog?.('Home Assistant: subscribed to state_changed');
        return;
      }
      if (msg.type === 'event' && msg.event) {
        void handleHomeAssistantEvent({
          config: opts.config,
          event: msg.event,
          model: opts.model,
          budgetUsd: opts.budgetUsd,
          permissionMode: opts.permissionMode,
          runningTargets,
          lastEventTime,
          onLog: opts.onLog,
        });
      }
    });
    ws.addEventListener('close', () => {
      if (stopped) return;
      opts.onLog?.(`Home Assistant: websocket closed; reconnecting in ${Math.round(reconnectMs / 1000)}s`);
      reconnect = setTimeout(connect, reconnectMs);
    });
    ws.addEventListener('error', () => opts.onLog?.('Home Assistant: websocket error'));
  };

  connect();
  return () => {
    stopped = true;
    if (reconnect) clearTimeout(reconnect);
    ws?.close();
  };
}
