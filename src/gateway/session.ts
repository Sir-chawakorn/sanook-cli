import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';
import { appHomePath, persistenceEnabled } from '../brand.js';
import { runAgent } from '../loop.js';
import { redactKey } from '../providers/keys.js';

const SESSION_DIR = appHomePath('gateway', 'sessions');

export interface GatewaySession {
  id: string;
  platform: string;
  target: string;
  created: string;
  updated: string;
  model: string;
  messages: ModelMessage[];
}

export interface GatewayAgentRunOptions {
  platform: string;
  target: string;
  model: string;
  prompt: string;
  budgetUsd?: number;
  maxSteps?: number;
  permissionMode?: 'auto' | 'ask';
}

export interface GatewayAgentRunResult {
  text: string;
  suppressDelivery: boolean;
  messages: ModelMessage[];
}

export function gatewaySessionId(platform: string, target: string): string {
  const digest = createHash('sha256').update(`${platform}:${target}`).digest('hex').slice(0, 24);
  return `${platform}-${digest}`;
}

function sessionPath(id: string): string {
  return join(SESSION_DIR, `${id}.json`);
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') return redactKey(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactUnknown(v)]));
  }
  return value;
}

export function shouldSuppressDelivery(text: string): boolean {
  const normalized = text.trim().toUpperCase().replace(/[\s_-]+/g, ' ');
  return normalized === '[SILENT]' || normalized === 'SILENT' || normalized === 'NO REPLY';
}

export async function loadGatewaySession(platform: string, target: string): Promise<GatewaySession | null> {
  try {
    const id = gatewaySessionId(platform, target);
    return JSON.parse(await readFile(sessionPath(id), 'utf8')) as GatewaySession;
  } catch {
    return null;
  }
}

export async function saveGatewaySession(session: GatewaySession): Promise<void> {
  if (!persistenceEnabled()) return;
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(sessionPath(session.id), `${JSON.stringify(redactUnknown(session), null, 2)}\n`, { mode: 0o600 });
  await chmod(sessionPath(session.id), 0o600).catch(() => {});
}

export async function runGatewayAgent(opts: GatewayAgentRunOptions): Promise<GatewayAgentRunResult> {
  const existing = await loadGatewaySession(opts.platform, opts.target);
  const { text, messages } = await runAgent({
    model: opts.model,
    prompt: opts.prompt,
    history: existing?.messages,
    maxSteps: opts.maxSteps ?? 20,
    budgetUsd: opts.budgetUsd,
    permissionMode: opts.permissionMode ?? 'ask',
  });
  const now = new Date().toISOString();
  await saveGatewaySession({
    id: gatewaySessionId(opts.platform, opts.target),
    platform: opts.platform,
    target: opts.target,
    created: existing?.created ?? now,
    updated: now,
    model: opts.model,
    messages,
  });
  return { text, messages, suppressDelivery: shouldSuppressDelivery(text) };
}
