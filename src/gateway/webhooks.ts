import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { ResolvedWebhookConfig, ResolvedWebhookRouteConfig, WebhookRouteConfig } from './config.js';
import { redactKey } from '../providers/keys.js';
import { deliverToTarget } from './deliver.js';
import { runGatewayAgent } from './session.js';

export interface WebhookHandlerOptions {
  routeName: string;
  rawBody: string;
  headers: IncomingHttpHeaders;
  config: ResolvedWebhookConfig;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  onLog?: (message: string) => void;
}

export interface WebhookHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const INSECURE_NO_AUTH = 'INSECURE_NO_AUTH';
const RAW_LIMIT = 4000;
const VALUE_LIMIT = 2000;
const seenDeliveries = new Map<string, number>();
const rateWindows = new Map<string, { start: number; count: number }>();

export function isValidWebhookRouteName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name);
}

export function generateWebhookSecret(): string {
  return randomBytes(24).toString('hex');
}

function firstHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hmacHex(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyWebhookSignature(
  secret: string | undefined,
  rawBody: string,
  headers: IncomingHttpHeaders,
): { ok: boolean; kind: 'github' | 'gitlab' | 'generic' | 'none' | 'insecure' } {
  if (!secret) return { ok: false, kind: 'none' };
  if (secret === INSECURE_NO_AUTH) return { ok: true, kind: 'insecure' };

  const github = firstHeader(headers, 'x-hub-signature-256');
  if (github?.startsWith('sha256=')) {
    return { ok: safeCompare(github, `sha256=${hmacHex(secret, rawBody)}`), kind: 'github' };
  }

  const gitlab = firstHeader(headers, 'x-gitlab-token');
  if (gitlab) return { ok: safeCompare(gitlab, secret), kind: 'gitlab' };

  const generic = firstHeader(headers, 'x-webhook-signature') ?? firstHeader(headers, 'x-sanook-signature');
  if (generic) {
    const expected = hmacHex(secret, rawBody);
    const cleaned = generic.startsWith('sha256=') ? generic.slice('sha256='.length) : generic;
    return { ok: safeCompare(cleaned, expected), kind: 'generic' };
  }

  return { ok: false, kind: 'none' };
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function getPath(payload: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, part) => {
    if (cur && typeof cur === 'object' && part in cur) return (cur as Record<string, unknown>)[part];
    return undefined;
  }, payload);
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return truncate(value, VALUE_LIMIT);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return truncate(JSON.stringify(value, null, 2), VALUE_LIMIT);
}

export function renderWebhookTemplate(template: string | undefined, payload: unknown): string {
  const fallback = `Webhook event:\n${truncate(JSON.stringify(payload, null, 2), RAW_LIMIT)}`;
  const source = template?.trim() ? template : fallback;
  return source.replace(/\{([A-Za-z0-9_.-]+|__raw__)\}/g, (match, key: string) => {
    if (key === '__raw__') return truncate(JSON.stringify(payload, null, 2), RAW_LIMIT);
    const value = getPath(payload, key);
    return value === undefined ? match : stringifyTemplateValue(value);
  });
}

export function webhookEventType(headers: IncomingHttpHeaders, payload: unknown): string | undefined {
  const fromHeader = firstHeader(headers, 'x-github-event') ?? firstHeader(headers, 'x-gitlab-event') ?? firstHeader(headers, 'x-event-type');
  if (fromHeader?.trim()) return fromHeader.trim();
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.event_type === 'string') return record.event_type;
    if (typeof record.object_kind === 'string') return record.object_kind;
    if (typeof record.type === 'string') return record.type;
  }
  return undefined;
}

function deliveryId(routeName: string, headers: IncomingHttpHeaders): string | undefined {
  const id = firstHeader(headers, 'x-github-delivery') ?? firstHeader(headers, 'x-request-id') ?? firstHeader(headers, 'x-webhook-delivery');
  return id ? `${routeName}:${id}` : undefined;
}

function pruneSeenDeliveries(now: number): void {
  for (const [key, seenAt] of seenDeliveries) {
    if (now - seenAt > 60 * 60 * 1000) seenDeliveries.delete(key);
  }
}

function hasSeenDelivery(routeName: string, headers: IncomingHttpHeaders, now = Date.now()): boolean {
  const id = deliveryId(routeName, headers);
  if (!id) return false;
  pruneSeenDeliveries(now);
  return seenDeliveries.has(id);
}

function beginDelivery(routeName: string, headers: IncomingHttpHeaders, now = Date.now()): string | undefined {
  const id = deliveryId(routeName, headers);
  if (!id) return undefined;
  pruneSeenDeliveries(now);
  seenDeliveries.set(id, now);
  return id;
}

function completeDelivery(id: string | undefined, now = Date.now()): void {
  if (!id) return;
  pruneSeenDeliveries(now);
  seenDeliveries.set(id, now);
}

function forgetDelivery(id: string | undefined): void {
  if (id) seenDeliveries.delete(id);
}

function checkRateLimit(route: ResolvedWebhookRouteConfig, config: ResolvedWebhookConfig, now = Date.now()): boolean {
  const limit = route.rateLimitPerMinute ?? config.rateLimitPerMinute;
  if (!Number.isInteger(limit) || limit <= 0) return true;
  const key = route.name;
  const current = rateWindows.get(key);
  if (!current || now - current.start >= 60_000) {
    rateWindows.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

export function routeToConfig(name: string, route: WebhookRouteConfig): ResolvedWebhookRouteConfig {
  return {
    name,
    events: route.events ?? [],
    secret: route.secret,
    prompt: route.prompt,
    deliver: route.deliver?.trim() || 'log',
    deliverOnly: route.deliverOnly === true,
    description: route.description,
    rateLimitPerMinute: route.rateLimitPerMinute,
  };
}

export async function handleWebhookRequest(opts: WebhookHandlerOptions): Promise<WebhookHandlerResult> {
  if (!opts.config.enabled) return { status: 503, body: { error: 'webhooks_disabled' } };
  const route = opts.config.routes[opts.routeName];
  if (!route) return { status: 404, body: { error: 'unknown_route' } };

  const secret = route.secret || opts.config.secret;
  const sig = verifyWebhookSignature(secret, opts.rawBody, opts.headers);
  if (!sig.ok) return { status: 401, body: { error: 'invalid_signature', route: route.name } };

  let payload: unknown;
  try {
    payload = opts.rawBody.trim() ? JSON.parse(opts.rawBody) : {};
  } catch {
    return { status: 400, body: { error: 'invalid_json', route: route.name } };
  }

  const event = webhookEventType(opts.headers, payload);
  if (route.events.length && (!event || !route.events.includes(event))) {
    return { status: 200, body: { status: 'ignored', route: route.name, event: event ?? null } };
  }
  if (route.deliverOnly && route.deliver === 'log') {
    return { status: 400, body: { error: 'deliver_only_requires_target', route: route.name } };
  }
  if (hasSeenDelivery(route.name, opts.headers)) return { status: 200, body: { status: 'duplicate', route: route.name } };
  if (!checkRateLimit(route, opts.config)) return { status: 429, body: { error: 'rate_limited', route: route.name } };
  const trackedDeliveryId = beginDelivery(route.name, opts.headers);

  const rendered = renderWebhookTemplate(route.prompt, payload);
  if (route.deliverOnly) {
    try {
      const delivery = await deliverToTarget(route.deliver, rendered, { subject: `Webhook ${route.name}` });
      completeDelivery(trackedDeliveryId);
      return { status: 200, body: { status: 'delivered', route: route.name, target: delivery.target } };
    } catch (e) {
      forgetDelivery(trackedDeliveryId);
      opts.onLog?.(`Webhook delivery error (${route.name}): ${redactKey((e as Error).message)}`);
      return { status: 502, body: { error: 'delivery_failed', route: route.name } };
    }
  }

  try {
    const out = await runGatewayAgent({
      platform: 'webhook',
      target: route.name,
      model: opts.model,
      prompt: rendered,
      userText: rendered,
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
    });
    if (out.suppressDelivery || route.deliver === 'log') {
      opts.onLog?.(`Webhook ${route.name}: ${truncate(out.text || '(ไม่มีผลลัพธ์)', 500)}`);
      completeDelivery(trackedDeliveryId);
      return { status: 200, body: { status: 'processed', route: route.name, delivered: false } };
    }
    const delivery = await deliverToTarget(route.deliver, out.text || '(ไม่มีผลลัพธ์)', { subject: `Webhook ${route.name}` });
    completeDelivery(trackedDeliveryId);
    return { status: 200, body: { status: 'delivered', route: route.name, target: delivery.target } };
  } catch (e) {
    forgetDelivery(trackedDeliveryId);
    opts.onLog?.(`Webhook run error (${route.name}): ${redactKey((e as Error).message)}`);
    return { status: 500, body: { error: 'agent_failed', route: route.name } };
  }
}
