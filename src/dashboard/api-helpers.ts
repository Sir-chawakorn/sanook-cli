import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
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

export async function dashboardListFiles(subpath = ''): Promise<{ root: string; entries: { name: string; dir: boolean }[] }> {
  const config = await loadConfig({});
  const roots = [appHomePath(), config.brainPath ? resolve(config.brainPath) : null].filter(Boolean) as string[];
  const root = safeRoot(roots[0] ?? appHomePath());
  const target = safeRoot(join(root, subpath.replace(/^\/+/, '')));
  if (!target.startsWith(root) && !roots.some((r) => target.startsWith(safeRoot(r)))) {
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
  if (!allowedRoots.some((root) => target.startsWith(safeRoot(root)))) throw new Error('path not allowed');
  const info = await stat(target);
  if (!info.isFile()) throw new Error('not a file');
  if (info.size > 512_000) throw new Error('file too large');
  const content = await readFile(target, 'utf8');
  return { path: relative(homedir(), target) || target, content };
}
