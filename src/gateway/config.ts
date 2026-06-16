import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { appHomePath } from '../brand.js';
import { parseAllowedChats } from './telegram.js';

export interface TelegramGatewayConfig {
  enabled?: boolean;
  botToken?: string;
  allowedChatIds?: number[];
  allowWrite?: boolean;
}

export interface GatewayConfig {
  telegram?: TelegramGatewayConfig;
}

const CONFIG_PATH = appHomePath('gateway', 'config.json');

export function gatewayConfigPath(): string {
  return CONFIG_PATH;
}

export async function readGatewayConfig(): Promise<GatewayConfig> {
  try {
    const parsed = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const raw = parsed as GatewayConfig;
    const telegram = raw.telegram;
    return {
      telegram: telegram
        ? {
            enabled: telegram.enabled !== false,
            botToken: typeof telegram.botToken === 'string' ? telegram.botToken : undefined,
            allowedChatIds: Array.isArray(telegram.allowedChatIds)
              ? telegram.allowedChatIds.filter((n) => Number.isInteger(n))
              : undefined,
            allowWrite: telegram.allowWrite === true,
          }
        : undefined,
    };
  } catch {
    return {};
  }
}

export async function writeGatewayConfig(config: GatewayConfig): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600).catch(() => {});
}

export async function patchGatewayConfig(patch: GatewayConfig): Promise<GatewayConfig> {
  const current = await readGatewayConfig();
  const next: GatewayConfig = {
    ...current,
    ...patch,
    telegram: patch.telegram ? { ...current.telegram, ...patch.telegram } : current.telegram,
  };
  await writeGatewayConfig(next);
  return next;
}

export interface ResolvedTelegramConfig {
  token?: string;
  allowedChatIds: number[];
  allowWrite: boolean;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveTelegramConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedTelegramConfig {
  const envToken = env.TELEGRAM_BOT_TOKEN;
  const cfg = config.telegram;
  const token = envToken || cfg?.botToken;
  const allowedChatIds = env.TELEGRAM_ALLOWED_CHATS
    ? parseAllowedChats(env.TELEGRAM_ALLOWED_CHATS)
    : (cfg?.allowedChatIds ?? []);
  return {
    token,
    allowedChatIds,
    allowWrite: env.TELEGRAM_ALLOW_WRITE === '1' || cfg?.allowWrite === true,
    enabled: cfg?.enabled !== false,
    source: envToken ? 'env' : token ? 'config' : 'none',
  };
}

export function redactGatewayConfig(config: GatewayConfig): GatewayConfig {
  return {
    ...config,
    telegram: config.telegram
      ? {
          ...config.telegram,
          botToken: config.telegram.botToken ? '<secret:TELEGRAM_BOT_TOKEN>' : undefined,
        }
      : undefined,
  };
}
