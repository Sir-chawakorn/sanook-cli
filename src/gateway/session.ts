import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';
import { appHomePath, persistenceEnabled } from '../brand.js';
import { runAgent } from '../loop.js';
import { redactKey, redactUnknown } from '../providers/keys.js';
import { canonicalSpec, parseSpec, PROVIDERS } from '../providers/registry.js';
import { autoCompact, estimateTokens } from '../compaction.js';
import { patchGlobalConfig } from '../config.js';
import { parseInsightsDays } from '../insights-args.js';
import { normalizePersonalityName, personalityListText } from '../personality.js';
import { patchGatewayConfig, readGatewayConfig } from './config.js';

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
  userText?: string;
  budgetUsd?: number;
  maxSteps?: number;
  permissionMode?: 'auto' | 'ask';
}

export interface GatewayAgentRunResult {
  text: string;
  suppressDelivery: boolean;
  messages: ModelMessage[];
}

function safePlatformSegment(platform: string): string {
  const safe = platform.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'gateway';
}

export function gatewaySessionId(platform: string, target: string): string {
  const digest = createHash('sha256').update(`${platform}:${target}`).digest('hex').slice(0, 24);
  return `${safePlatformSegment(platform)}-${digest}`;
}

function sessionPath(id: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(id) || id.includes('..')) {
    throw new Error(`gateway session id ไม่ถูกต้อง: ${id}`);
  }
  return join(SESSION_DIR, `${id}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isModelMessage(value: unknown): value is ModelMessage {
  if (!isRecord(value)) return false;
  if (value.role === 'system') return typeof value.content === 'string';
  if (value.role === 'tool') return Array.isArray(value.content);
  if (value.role === 'user' || value.role === 'assistant') {
    return typeof value.content === 'string' || Array.isArray(value.content);
  }
  return false;
}

function isGatewaySession(value: unknown): value is GatewaySession {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.platform === 'string' &&
    typeof value.target === 'string' &&
    typeof value.created === 'string' &&
    typeof value.updated === 'string' &&
    typeof value.model === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.every(isModelMessage)
  );
}

export function shouldSuppressDelivery(text: string): boolean {
  const normalized = text.trim().toUpperCase().replace(/[\s_-]+/g, ' ');
  return normalized === '[SILENT]' || normalized === 'SILENT' || normalized === 'NO REPLY';
}

export async function loadGatewaySession(platform: string, target: string): Promise<GatewaySession | null> {
  try {
    const id = gatewaySessionId(platform, target);
    const parsed: unknown = JSON.parse(await readFile(sessionPath(id), 'utf8'));
    return isGatewaySession(parsed) && parsed.id === id ? parsed : null;
  } catch {
    return null;
  }
}

export async function listGatewaySessions(): Promise<GatewaySession[]> {
  try {
    const files = (await readdir(SESSION_DIR)).filter((f) => f.endsWith('.json'));
    const sessions = await Promise.all(
      files.map(async (file) => {
        try {
          const parsed: unknown = JSON.parse(await readFile(join(SESSION_DIR, file), 'utf8'));
          return isGatewaySession(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }),
    );
    return sessions.filter((s): s is GatewaySession => s !== null).sort((a, b) => b.updated.localeCompare(a.updated));
  } catch {
    return [];
  }
}

export async function saveGatewaySession(session: GatewaySession): Promise<void> {
  if (!persistenceEnabled()) return;
  await mkdir(SESSION_DIR, { recursive: true });
  const safeSession: GatewaySession = {
    ...session,
    messages: redactUnknown(session.messages) as ModelMessage[],
  };
  await writeFile(sessionPath(session.id), `${JSON.stringify(safeSession, null, 2)}\n`, { mode: 0o600 });
  await chmod(sessionPath(session.id), 0o600).catch(() => {});
}

export async function removeGatewaySession(platform: string, target: string): Promise<boolean> {
  try {
    await rm(sessionPath(gatewaySessionId(platform, target)));
    return true;
  } catch {
    return false;
  }
}

function gatewayCommandHelp(): string {
  return [
    'Messaging commands:',
    '/new หรือ /reset — เริ่มบทสนทนาใหม่',
    '/model [spec] — ดู/เปลี่ยน model ของ chat นี้',
    '/personality [name] — ดู/ตั้ง personality overlay',
    '/retry — รัน user turn ล่าสุดอีกครั้ง',
    '/undo — ลบ exchange ล่าสุดจาก history',
    '/compress — compact history ของ chat นี้',
    '/usage — ดู usage โดยประมาณของ chat นี้',
    '/insights [days] — ดู usage/session insights',
    '/stop — หยุด turn ที่กำลังรัน (ถ้ามี)',
    '/status — ดู session ปัจจุบัน',
    '/sethome — ตั้ง chat นี้เป็น home target สำหรับ delivery/cron',
    '/help — ดูคำสั่งที่รองรับ',
  ].join('\n');
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function lastUserIndex(messages: ModelMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as { role?: string }).role === 'user') return i;
  }
  return -1;
}

function trimLastExchange(messages: ModelMessage[]): ModelMessage[] {
  const userIdx = lastUserIndex(messages);
  return userIdx === -1 ? messages : messages.slice(0, userIdx);
}

async function saveGatewayState(
  opts: GatewayAgentRunOptions,
  existing: GatewaySession | null,
  model: string,
  messages: ModelMessage[],
): Promise<GatewaySession> {
  const now = new Date().toISOString();
  const session = {
    id: gatewaySessionId(opts.platform, opts.target),
    platform: opts.platform,
    target: opts.target,
    created: existing?.created ?? now,
    updated: now,
    model,
    messages,
  };
  await saveGatewaySession(session);
  return session;
}

async function runAndSaveGatewayTurn(
  opts: GatewayAgentRunOptions,
  existing: GatewaySession | null,
  prompt: string,
  history: ModelMessage[],
  model: string,
): Promise<GatewayAgentRunResult> {
  const { text, messages } = await runAgent({
    model,
    prompt,
    history,
    maxSteps: opts.maxSteps ?? 20,
    budgetUsd: opts.budgetUsd,
    permissionMode: opts.permissionMode ?? 'ask',
    usageMeta: {
      sessionId: `${opts.platform}:${opts.target}`,
      source: 'gateway',
    },
  });
  await saveGatewayState(opts, existing, model, messages);
  return { text, messages, suppressDelivery: shouldSuppressDelivery(text) };
}

function addFirst<T>(items: T[] | undefined, item: T): T[] {
  return [item, ...(items ?? []).filter((x) => x !== item)];
}

async function setHomeTarget(platform: string, target: string): Promise<string> {
  const cfg = await readGatewayConfig();
  switch (platform) {
    case 'telegram': {
      const chatId = Number(target);
      if (!Number.isInteger(chatId)) return 'Telegram /sethome ต้องมาจาก numeric chat id';
      await patchGatewayConfig({ telegram: { allowedChatIds: addFirst(cfg.telegram?.allowedChatIds, chatId) } });
      return `ตั้ง Telegram home/allowed chat เป็น ${chatId} แล้ว`;
    }
    case 'discord':
      await patchGatewayConfig({ discord: { defaultChannelId: target, allowedChannelIds: addFirst(cfg.discord?.allowedChannelIds, target) } });
      return `ตั้ง Discord home channel เป็น ${target} แล้ว`;
    case 'slack':
      await patchGatewayConfig({ slack: { defaultChannelId: target, allowedChannelIds: addFirst(cfg.slack?.allowedChannelIds, target) } });
      return `ตั้ง Slack home channel เป็น ${target} แล้ว`;
    case 'mattermost':
      await patchGatewayConfig({ mattermost: { homeChannel: target, allowedChannels: addFirst(cfg.mattermost?.allowedChannels, target) } });
      return `ตั้ง Mattermost home channel เป็น ${target} แล้ว`;
    case 'homeassistant':
      await patchGatewayConfig({ homeassistant: { homeChannel: target } });
      return `ตั้ง Home Assistant home notification เป็น ${target} แล้ว`;
    case 'email':
      await patchGatewayConfig({ email: { homeAddress: target, allowedUsers: addFirst(cfg.email?.allowedUsers, target.toLowerCase()) } });
      return `ตั้ง Email home address เป็น ${target} แล้ว`;
    case 'line':
      await patchGatewayConfig({ line: { homeChannel: target, allowedUsers: addFirst(cfg.line?.allowedUsers, target) } });
      return `ตั้ง LINE home channel เป็น ${target} แล้ว`;
    case 'sms':
      await patchGatewayConfig({ sms: { homeChannel: target, allowedUsers: addFirst(cfg.sms?.allowedUsers, target) } });
      return `ตั้ง SMS home channel เป็น ${target} แล้ว`;
    case 'ntfy':
      await patchGatewayConfig({ ntfy: { homeChannel: target, allowedUsers: addFirst(cfg.ntfy?.allowedUsers, target) } });
      return `ตั้ง ntfy home topic เป็น ${target} แล้ว`;
    case 'signal':
      await patchGatewayConfig({ signal: { homeChannel: target, allowedUsers: addFirst(cfg.signal?.allowedUsers, target) } });
      return `ตั้ง Signal home channel เป็น ${target} แล้ว`;
    case 'whatsapp':
      await patchGatewayConfig({ whatsapp: { homeChannel: target, allowedUsers: addFirst(cfg.whatsapp?.allowedUsers, target) } });
      return `ตั้ง WhatsApp home channel เป็น ${target} แล้ว`;
    case 'matrix':
      await patchGatewayConfig({ matrix: { homeRoom: target, allowedRooms: addFirst(cfg.matrix?.allowedRooms, target) } });
      return `ตั้ง Matrix home room เป็น ${target} แล้ว`;
    case 'googlechat':
      await patchGatewayConfig({ googleChat: { homeChannel: target, allowedSpaces: addFirst(cfg.googleChat?.allowedSpaces, target) } });
      return `ตั้ง Google Chat home channel เป็น ${target} แล้ว`;
    case 'bluebubbles':
      await patchGatewayConfig({ bluebubbles: { homeChannel: target, allowedUsers: addFirst(cfg.bluebubbles?.allowedUsers, target) } });
      return `ตั้ง BlueBubbles home channel เป็น ${target} แล้ว`;
    case 'teams':
      await patchGatewayConfig({ teams: { homeChannel: target, chatId: target } });
      return `ตั้ง Teams home channel เป็น ${target} แล้ว`;
    default:
      return `platform ${platform} ยังไม่รองรับ /sethome`;
  }
}

async function handleGatewayCommand(opts: GatewayAgentRunOptions): Promise<GatewayAgentRunResult | null> {
  const input = opts.userText?.trim();
  if (!input?.startsWith('/')) return null;
  const [command, ...args] = input.slice(1).trim().split(/\s+/);
  const normalized = command?.toLowerCase();
  if (!normalized) return null;

  if (normalized === 'new' || normalized === 'reset') {
    await removeGatewaySession(opts.platform, opts.target);
    return { text: 'เริ่มบทสนทนาใหม่แล้ว', messages: [], suppressDelivery: false };
  }

  if (normalized === 'status') {
    const existing = await loadGatewaySession(opts.platform, opts.target);
    const turns = existing?.messages.length ?? 0;
    const text = existing
      ? [
          `Session: ${existing.id}`,
          `Platform: ${existing.platform}`,
          `Target: ${existing.target}`,
          `Model: ${existing.model}`,
          `Messages: ${turns}`,
          `Updated: ${existing.updated}`,
        ].join('\n')
      : `ยังไม่มี session สำหรับ ${opts.platform}:${opts.target}`;
    return { text, messages: existing?.messages ?? [], suppressDelivery: false };
  }

  if (normalized === 'help') {
    const existing = await loadGatewaySession(opts.platform, opts.target);
    return { text: gatewayCommandHelp(), messages: existing?.messages ?? [], suppressDelivery: false };
  }

  if (normalized === 'sethome') {
    const existing = await loadGatewaySession(opts.platform, opts.target);
    return { text: await setHomeTarget(opts.platform, opts.target), messages: existing?.messages ?? [], suppressDelivery: false };
  }

  if (normalized === 'stop') {
    const existing = await loadGatewaySession(opts.platform, opts.target);
    return { text: 'ไม่มี turn ที่กำลังทำงานให้หยุดใน command นี้', messages: existing?.messages ?? [], suppressDelivery: false };
  }

  if (normalized === 'model') {
    const existing = await loadGatewaySession(opts.platform, opts.target);
    const currentModel = existing?.model ?? opts.model;
    const spec = args[0];
    if (!spec) return { text: `model ปัจจุบัน: ${currentModel}`, messages: existing?.messages ?? [], suppressDelivery: false };
    const canonical = canonicalSpec(spec);
    const parsed = parseSpec(canonical);
    if (!PROVIDERS[parsed.provider] || !parsed.model) {
      return { text: `model spec ไม่รองรับ: ${spec}`, messages: existing?.messages ?? [], suppressDelivery: false };
    }
    const session = await saveGatewayState(opts, existing, canonical, existing?.messages ?? []);
    return { text: `เปลี่ยน model ของ chat นี้ → ${canonical}`, messages: session.messages, suppressDelivery: false };
  }

  if (normalized === 'personality') {
    const existing = await loadGatewaySession(opts.platform, opts.target);
    const raw = args.join(' ').trim();
    if (!raw) return { text: personalityListText(), messages: existing?.messages ?? [], suppressDelivery: false };
    const name = normalizePersonalityName(raw);
    if (!name) return { text: `ไม่รู้จัก personality: ${raw}\n\n${personalityListText()}`, messages: existing?.messages ?? [], suppressDelivery: false };
    await patchGlobalConfig({ personality: name === 'none' ? undefined : name });
    return {
      text: name === 'none' ? 'ปิด personality overlay แล้ว' : `ตั้ง personality → ${name}`,
      messages: existing?.messages ?? [],
      suppressDelivery: false,
    };
  }

  if (normalized === 'usage') {
    const existing = await loadGatewaySession(opts.platform, opts.target);
    const messages = existing?.messages ?? [];
    return {
      text: [
        `messages: ${messages.length}`,
        `approx tokens: ~${estimateTokens(messages)}`,
        `model: ${existing?.model ?? opts.model}`,
      ].join('\n'),
      messages,
      suppressDelivery: false,
    };
  }

  if (normalized === 'insights') {
    const existing = await loadGatewaySession(opts.platform, opts.target);
    const days = parseInsightsDays(args);
    if (days === null) return { text: 'ใช้: /insights [days]', messages: existing?.messages ?? [], suppressDelivery: false };
    const { renderInsights } = await import('../insights.js');
    return { text: await renderInsights({ days, cwd: null, includeGateway: true }), messages: existing?.messages ?? [], suppressDelivery: false };
  }

  if (normalized === 'compress') {
    const existing = await loadGatewaySession(opts.platform, opts.target);
    if (!existing?.messages.length) return { text: 'ยังไม่มี history ให้ compact', messages: [], suppressDelivery: false };
    const before = estimateTokens(existing.messages);
    const messages = autoCompact(existing.messages, 40_000, 20);
    await saveGatewayState(opts, existing, existing.model, messages);
    return { text: `compact แล้ว: ~${before} → ~${estimateTokens(messages)} tokens`, messages, suppressDelivery: false };
  }

  if (normalized === 'undo') {
    const existing = await loadGatewaySession(opts.platform, opts.target);
    if (!existing?.messages.length) return { text: 'ยังไม่มี turn ให้ undo', messages: [], suppressDelivery: false };
    const messages = trimLastExchange(existing.messages);
    await saveGatewayState(opts, existing, existing.model, messages);
    return { text: 'undo exchange ล่าสุดแล้ว', messages, suppressDelivery: false };
  }

  if (normalized === 'retry') {
    const existing = await loadGatewaySession(opts.platform, opts.target);
    const idx = existing ? lastUserIndex(existing.messages) : -1;
    if (!existing || idx === -1) return { text: 'ยังไม่มี user turn ให้ retry', messages: existing?.messages ?? [], suppressDelivery: false };
    const prompt = messageText((existing.messages[idx] as { content?: unknown }).content).trim();
    if (!prompt) return { text: 'user turn ล่าสุดว่าง retry ไม่ได้', messages: existing.messages, suppressDelivery: false };
    return runAndSaveGatewayTurn(opts, existing, prompt, existing.messages.slice(0, idx), existing.model);
  }

  return null;
}

export async function runGatewayAgent(opts: GatewayAgentRunOptions): Promise<GatewayAgentRunResult> {
  const command = await handleGatewayCommand(opts);
  if (command) return command;

  const existing = await loadGatewaySession(opts.platform, opts.target);
  return runAndSaveGatewayTurn(opts, existing, opts.prompt, existing?.messages ?? [], existing?.model ?? opts.model);
}
