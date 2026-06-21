import { readFile, readdir, stat } from 'node:fs/promises';
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

export async function dashboardListFiles(subpath = ''): Promise<{ root: string; entries: { name: string; dir: boolean }[] }> {
  const config = await loadConfig({});
  const roots = [appHomePath(), config.brainPath ? resolve(config.brainPath) : null].filter(Boolean) as string[];
  const root = safeRoot(roots[0] ?? appHomePath());
  const target = safeRoot(join(root, subpath.replace(/^\/+/, '')));
  if (!roots.some((r) => isWithin(target, r))) {
    throw new Error('path not allowed');
  }
  const entries = await readdir(target, { withFileTypes: true });
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
  const target = safeRoot(subpath.startsWith('/') ? subpath : join(appHomePath(), subpath));
  if (!allowedRoots.some((root) => isWithin(target, root))) throw new Error('path not allowed');
  const info = await stat(target);
  if (!info.isFile()) throw new Error('not a file');
  if (info.size > 512_000) throw new Error('file too large');
  const content = await readFile(target, 'utf8');
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

export interface InstallMethod {
  id: string;
  label: string;
  recommended?: boolean;
  /** platform → shell command */
  commands: { os: string; cmd: string }[];
  ready: boolean; // ใช้ได้จริงตอนนี้ไหม (npm = พร้อม, อื่นๆ รอ publish infra)
  note?: string;
}

const NPM_PKG = 'sanook-cli';
const INSTALL_DOMAIN = 'sanook.ai'; // เปลี่ยนเป็นโดเมนจริงเมื่อมี

export function dashboardInstall(): { pkg: string; methods: InstallMethod[] } {
  return {
    pkg: NPM_PKG,
    methods: [
      {
        id: 'npm',
        label: 'npm / npx',
        recommended: true,
        ready: true,
        commands: [
          { os: 'macOS / Linux / Windows', cmd: `npm install -g ${NPM_PKG}` },
          { os: 'Run without installing', cmd: `npx ${NPM_PKG}` },
        ],
        note: 'ต้องมี Node.js ≥ 22',
      },
      {
        id: 'curl',
        label: 'Install script',
        ready: false,
        commands: [
          { os: 'macOS / Linux / WSL', cmd: `curl -fsSL https://${INSTALL_DOMAIN}/install.sh | bash` },
          { os: 'Windows PowerShell', cmd: `irm https://${INSTALL_DOMAIN}/install.ps1 | iex` },
        ],
        note: 'ต้องโฮสต์ install.sh / install.ps1 บนโดเมนก่อน (ดู docs/INSTALL_INFRA.md)',
      },
      {
        id: 'homebrew',
        label: 'Homebrew',
        ready: false,
        commands: [{ os: 'macOS / Linux', cmd: `brew install ${NPM_PKG}` }],
        note: 'ต้องสร้าง Homebrew tap ก่อน (ดู docs/INSTALL_INFRA.md)',
      },
      {
        id: 'winget',
        label: 'WinGet',
        ready: false,
        commands: [{ os: 'Windows', cmd: 'winget install Sanook.SanookCLI' }],
        note: 'ต้องส่ง manifest เข้า winget-pkgs ก่อน (ดู docs/INSTALL_INFRA.md)',
      },
    ],
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
