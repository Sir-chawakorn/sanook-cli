import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { appHomePath, BRAND } from '../brand.js';
import { loadConfig } from '../config.js';
import { listTasks } from '../gateway/ledger.js';
import { gatewayServiceLogPath, gatewayServiceStatus } from '../gateway/service.js';
import {
  readGatewayConfig,
  resolveDiscordConfig,
  resolveSlackConfig,
  resolveTelegramConfig,
  resolveWebhookConfig,
} from '../gateway/config.js';
import type { UsageAggregateRow } from '../usage-ledger.js';

export interface ChannelStatus {
  id: string;
  label: string;
  configured: boolean;
  setupCommand: string;
}

export async function dashboardChannels(): Promise<{ channels: ChannelStatus[]; serviceRunning: boolean }> {
  const cfg = await readGatewayConfig();
  const service = await gatewayServiceStatus();
  const channels: ChannelStatus[] = [
    {
      id: 'telegram',
      label: 'Telegram',
      configured: Boolean(resolveTelegramConfig(cfg).token),
      setupCommand: `${BRAND.cliName} gateway setup telegram`,
    },
    {
      id: 'discord',
      label: 'Discord',
      configured: Boolean(resolveDiscordConfig(cfg).token),
      setupCommand: `${BRAND.cliName} gateway setup discord`,
    },
    {
      id: 'slack',
      label: 'Slack',
      configured: Boolean(resolveSlackConfig(cfg).botToken),
      setupCommand: `${BRAND.cliName} gateway setup slack`,
    },
    {
      id: 'webhooks',
      label: 'Webhooks',
      configured: Object.keys(resolveWebhookConfig(cfg).routes ?? {}).length > 0,
      setupCommand: `${BRAND.cliName} webhook setup`,
    },
  ];
  return { channels, serviceRunning: service.running };
}

export async function dashboardCronTasks(): Promise<{ tasks: Awaited<ReturnType<typeof listTasks>> }> {
  return { tasks: await listTasks() };
}

export async function dashboardLogsTail(maxLines = 200): Promise<{ path: string; lines: string[] }> {
  const path = gatewayServiceLogPath();
  try {
    const raw = await readFile(path, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return { path, lines: lines.slice(-maxLines) };
  } catch {
    return { path, lines: [`(no log yet — run ${BRAND.cliName} serve)`] };
  }
}

function safeRoot(root: string): string {
  return resolve(root);
}

/**
 * True only if `target` is the root itself or strictly inside it. Uses path.relative (not startsWith)
 * so a sibling dir sharing the root's name-prefix (e.g. .sanook-secrets vs .sanook) and absolute-path
 * escapes are both rejected — prevents directory traversal in the dashboard file API.
 */
function isWithin(target: string, root: string): boolean {
  const rel = relative(safeRoot(root), target);
  return !rel.startsWith('..') && !isAbsolute(rel);
}

async function realAllowedRoots(roots: string[]): Promise<string[]> {
  return Promise.all(
    roots.map(async (root) => {
      try {
        return await realpath(root);
      } catch {
        return safeRoot(root);
      }
    }),
  );
}

async function assertAllowedExistingTarget(target: string, roots: string[]): Promise<string> {
  const realTarget = await realpath(target);
  const realRoots = await realAllowedRoots(roots);
  if (!realRoots.some((root) => isWithin(realTarget, root))) throw new Error('path not allowed');
  return realTarget;
}

function resolveDashboardListTarget(subpath: string, root: string, allowedRoots: string[]): string {
  if (!subpath || subpath === '/') return root;
  if (isAbsolute(subpath)) {
    const absoluteTarget = safeRoot(subpath);
    if (allowedRoots.some((allowedRoot) => isWithin(absoluteTarget, allowedRoot))) return absoluteTarget;
    throw new Error('path not allowed');
  }
  return safeRoot(join(root, subpath.replace(/^[/\\]+/, '')));
}

export async function dashboardListFiles(subpath = ''): Promise<{ root: string; entries: { name: string; dir: boolean }[] }> {
  const config = await loadConfig({});
  const roots = [appHomePath(), config.brainPath ? resolve(config.brainPath) : null].filter(Boolean) as string[];
  const root = safeRoot(roots[0] ?? appHomePath());
  const target = resolveDashboardListTarget(subpath, root, roots);
  if (!roots.some((r) => isWithin(target, r))) {
    throw new Error('path not allowed');
  }
  const realTarget = await assertAllowedExistingTarget(target, roots);
  const entries = await readdir(realTarget, { withFileTypes: true });
  return {
    root,
    entries: entries
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 200)
      .map((e) => ({ name: e.name, dir: e.isDirectory() })),
  };
}

export async function dashboardReadFile(subpath: string): Promise<{ path: string; content: string }> {
  const config = await loadConfig({});
  const allowedRoots = [appHomePath(), config.brainPath ? resolve(config.brainPath) : null].filter(Boolean) as string[];
  const target = safeRoot(isAbsolute(subpath) ? subpath : join(appHomePath(), subpath));
  if (!allowedRoots.some((root) => isWithin(target, root))) throw new Error('path not allowed');
  const realTarget = await assertAllowedExistingTarget(target, allowedRoots);
  const info = await stat(realTarget);
  if (!info.isFile()) throw new Error('not a file');
  if (info.size > 512_000) throw new Error('file too large');
  const content = await readFile(realTarget, 'utf8');
  return { path: relative(homedir(), target) || target, content };
}

// ---- Skills (incl. auto-created by self-improvement) ------------------------

export interface DashboardSkill {
  name: string;
  description: string;
  whenToUse: string | null;
  auto: boolean; // สร้างอัตโนมัติจาก self-improvement
}

export async function dashboardSkills(): Promise<{ skills: DashboardSkill[] }> {
  const { loadSkills } = await import('../skills.js');
  const { loadLedger } = await import('../self-improve.js');
  const [skills, ledger] = await Promise.all([loadSkills(), loadLedger().catch(() => ({ families: [] as { skillName: string | null }[] }))]);
  const autoNames = new Set((ledger.families ?? []).map((f) => f.skillName).filter((n): n is string => Boolean(n)));
  return {
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      whenToUse: s.whenToUse ?? null,
      auto: autoNames.has(s.name),
    })),
  };
}

// ---- Memory facts (auto-memory store) --------------------------------------

export interface DashboardFact {
  id: string;
  text: string;
  noteType: string;
  trust: string;
  tier: string;
  importance: number;
  created: number;
  lastAccessed: number;
  accessCount: number;
}

export async function dashboardMemory(): Promise<{ facts: DashboardFact[]; brainPath: string | null }> {
  const { loadStore, activeFacts } = await import('../memory-store.js');
  const config = await loadConfig({});
  const store = await loadStore();
  const facts = activeFacts(store)
    .slice()
    .sort((a, b) => b.lastAccessed - a.lastAccessed)
    .map((f) => ({
      id: f.id,
      text: f.text,
      noteType: f.noteType,
      trust: f.trust,
      tier: f.tier,
      importance: Math.round(f.importance * 100) / 100,
      created: f.created,
      lastAccessed: f.lastAccessed,
      accessCount: f.accessCount,
    }));
  return { facts, brainPath: config.brainPath ?? null };
}

// ---- Usage / cost ledger ---------------------------------------------------

export async function dashboardUsage(): Promise<{
  totals: { turns: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  daily: UsageAggregateRow[];
}> {
  const { loadUsageEvents, aggregateUsageEvents } = await import('../usage-ledger.js');
  const events = await loadUsageEvents();
  const daily = aggregateUsageEvents(events, 'daily').slice(-30);
  const totals = events.reduce(
    (acc, e) => {
      acc.turns += 1;
      acc.inputTokens += e.inputTokens;
      acc.outputTokens += e.outputTokens;
      acc.totalTokens += e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheWriteTokens;
      acc.costUsd += e.costUsd ?? 0;
      return acc;
    },
    { turns: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
  );
  return { totals, daily };
}

// ---- Self-improvement ledger -----------------------------------------------

export interface DashboardTaskFamily {
  sig: string;
  terms: string[];
  sample: string;
  count: number;
  skillCreated: boolean;
  skillName: string | null;
  firstSeen: number;
  lastSeen: number;
}

// ---- Install commands (multi-platform) -------------------------------------

export { type InstallMethod } from '../install-info.js';
import { dashboardInstallPayload } from '../install-info.js';

export function dashboardInstall() {
  return dashboardInstallPayload();
}

// ---- Persona profile -------------------------------------------------------

export interface DashboardPersonaRow {
  id: string;
  label: string;
  value: string;
  display: string;
}

export async function dashboardPersona(): Promise<{
  brainPath: string | null;
  profilePath: string | null;
  rows: DashboardPersonaRow[];
  hasProfile: boolean;
  cliCommand: string;
}> {
  const { loadPersonaAnswers } = await import('../memory.js');
  const { PERSONA_QUESTIONS } = await import('../persona.js');
  const { BRAND } = await import('../brand.js');
  const config = await loadConfig({});
  const brainPath = config.brainPath ?? null;
  const answers = await loadPersonaAnswers();
  const rows = PERSONA_QUESTIONS.map((q) => {
    const v = (answers[q.id] ?? '').trim();
    return {
      id: q.id,
      label: q.label,
      value: v,
      display: v ? (q.type === 'select' ? (q.options?.find((o) => o.value === v)?.label ?? v) : v) : '—',
    };
  });
  const hasProfile = rows.some((r) => r.value);
  const profilePath = brainPath ? `${brainPath}/Shared/User-Persona/persona.md` : null;
  return {
    brainPath,
    profilePath,
    rows,
    hasProfile,
    cliCommand: `${BRAND.cliName} persona`,
  };
}

export async function dashboardSelfImprove(): Promise<{ enabled: boolean; threshold: number; families: DashboardTaskFamily[] }> {
  const { loadLedger } = await import('../self-improve.js');
  const { selfImproveEnabled, selfImproveThreshold } = await import('../brand.js');
  const ledger = await loadLedger();
  const families = (ledger.families ?? [])
    .slice()
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((f) => ({
      sig: f.sig,
      terms: f.terms,
      sample: f.samples[f.samples.length - 1] ?? '',
      count: f.count,
      skillCreated: f.skillCreated,
      skillName: f.skillName,
      firstSeen: f.firstSeen,
      lastSeen: f.lastSeen,
    }));
  return { enabled: selfImproveEnabled(), threshold: selfImproveThreshold(), families };
}
