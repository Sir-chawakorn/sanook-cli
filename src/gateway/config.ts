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

export interface DiscordGatewayConfig {
  enabled?: boolean;
  botToken?: string;
  defaultChannelId?: string;
  allowedChannelIds?: string[];
  allowWrite?: boolean;
}

export interface SlackGatewayConfig {
  enabled?: boolean;
  botToken?: string;
  appToken?: string;
  defaultChannelId?: string;
  allowedChannelIds?: string[];
  allowWrite?: boolean;
}

export interface EmailGatewayConfig {
  enabled?: boolean;
  address?: string;
  password?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  homeAddress?: string;
  allowedUsers?: string[];
  allowAllUsers?: boolean;
  pollIntervalSeconds?: number;
}

export interface GatewayConfig {
  telegram?: TelegramGatewayConfig;
  discord?: DiscordGatewayConfig;
  slack?: SlackGatewayConfig;
  email?: EmailGatewayConfig;
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
    const discord = raw.discord;
    const slack = raw.slack;
    const email = raw.email;
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
      discord: discord
        ? {
            enabled: discord.enabled !== false,
            botToken: typeof discord.botToken === 'string' ? discord.botToken : undefined,
            defaultChannelId: typeof discord.defaultChannelId === 'string' ? discord.defaultChannelId : undefined,
            allowedChannelIds: Array.isArray(discord.allowedChannelIds)
              ? discord.allowedChannelIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowWrite: discord.allowWrite === true,
          }
        : undefined,
      slack: slack
        ? {
            enabled: slack.enabled !== false,
            botToken: typeof slack.botToken === 'string' ? slack.botToken : undefined,
            appToken: typeof slack.appToken === 'string' ? slack.appToken : undefined,
            defaultChannelId: typeof slack.defaultChannelId === 'string' ? slack.defaultChannelId : undefined,
            allowedChannelIds: Array.isArray(slack.allowedChannelIds)
              ? slack.allowedChannelIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowWrite: slack.allowWrite === true,
          }
        : undefined,
      email: email
        ? {
            enabled: email.enabled !== false,
            address: typeof email.address === 'string' ? email.address : undefined,
            password: typeof email.password === 'string' ? email.password : undefined,
            imapHost: typeof email.imapHost === 'string' ? email.imapHost : undefined,
            imapPort: Number.isInteger(email.imapPort) ? email.imapPort : undefined,
            smtpHost: typeof email.smtpHost === 'string' ? email.smtpHost : undefined,
            smtpPort: Number.isInteger(email.smtpPort) ? email.smtpPort : undefined,
            homeAddress: typeof email.homeAddress === 'string' ? email.homeAddress : undefined,
            allowedUsers: Array.isArray(email.allowedUsers)
              ? email.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim().toLowerCase())
              : undefined,
            allowAllUsers: email.allowAllUsers === true,
            pollIntervalSeconds: Number.isInteger(email.pollIntervalSeconds) ? email.pollIntervalSeconds : undefined,
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
    discord: patch.discord ? { ...current.discord, ...patch.discord } : current.discord,
    slack: patch.slack ? { ...current.slack, ...patch.slack } : current.slack,
    email: patch.email ? { ...current.email, ...patch.email } : current.email,
  };
  await writeGatewayConfig(next);
  return next;
}

function parseStringList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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

export interface ResolvedDiscordConfig {
  token?: string;
  defaultChannelId?: string;
  allowedChannelIds: string[];
  allowWrite: boolean;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveDiscordConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedDiscordConfig {
  const envToken = env.DISCORD_BOT_TOKEN;
  const cfg = config.discord;
  const token = envToken || cfg?.botToken;
  return {
    token,
    defaultChannelId: env.DISCORD_DEFAULT_CHANNEL || cfg?.defaultChannelId,
    allowedChannelIds: env.DISCORD_ALLOWED_CHANNELS ? parseStringList(env.DISCORD_ALLOWED_CHANNELS) : (cfg?.allowedChannelIds ?? []),
    allowWrite: env.DISCORD_ALLOW_WRITE === '1' || cfg?.allowWrite === true,
    enabled: cfg?.enabled !== false,
    source: envToken ? 'env' : token ? 'config' : 'none',
  };
}

export interface ResolvedSlackConfig {
  botToken?: string;
  appToken?: string;
  defaultChannelId?: string;
  allowedChannelIds: string[];
  allowWrite: boolean;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveSlackConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedSlackConfig {
  const envBotToken = env.SLACK_BOT_TOKEN;
  const cfg = config.slack;
  const botToken = envBotToken || cfg?.botToken;
  return {
    botToken,
    appToken: env.SLACK_APP_TOKEN || cfg?.appToken,
    defaultChannelId: env.SLACK_DEFAULT_CHANNEL || cfg?.defaultChannelId,
    allowedChannelIds: env.SLACK_ALLOWED_CHANNELS ? parseStringList(env.SLACK_ALLOWED_CHANNELS) : (cfg?.allowedChannelIds ?? []),
    allowWrite: env.SLACK_ALLOW_WRITE === '1' || cfg?.allowWrite === true,
    enabled: cfg?.enabled !== false,
    source: envBotToken ? 'env' : botToken ? 'config' : 'none',
  };
}

export interface ResolvedEmailConfig {
  address?: string;
  password?: string;
  imapHost?: string;
  imapPort: number;
  smtpHost?: string;
  smtpPort: number;
  homeAddress?: string;
  allowedUsers: string[];
  allowAllUsers: boolean;
  pollIntervalSeconds: number;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function resolveEmailConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedEmailConfig {
  const cfg = config.email;
  const envAddress = env.EMAIL_ADDRESS;
  const address = envAddress || cfg?.address;
  const password = env.EMAIL_PASSWORD || cfg?.password;
  const imapHost = env.EMAIL_IMAP_HOST || cfg?.imapHost;
  const smtpHost = env.EMAIL_SMTP_HOST || cfg?.smtpHost;
  return {
    address,
    password,
    imapHost,
    imapPort: parsePositiveInt(env.EMAIL_IMAP_PORT, cfg?.imapPort ?? 993),
    smtpHost,
    smtpPort: parsePositiveInt(env.EMAIL_SMTP_PORT, cfg?.smtpPort ?? 587),
    homeAddress: env.EMAIL_HOME_ADDRESS || cfg?.homeAddress,
    allowedUsers: env.EMAIL_ALLOWED_USERS ? parseStringList(env.EMAIL_ALLOWED_USERS).map((s) => s.toLowerCase()) : (cfg?.allowedUsers ?? []),
    allowAllUsers: env.EMAIL_ALLOW_ALL_USERS === '1' || env.EMAIL_ALLOW_ALL_USERS === 'true' || cfg?.allowAllUsers === true,
    pollIntervalSeconds: parsePositiveInt(env.EMAIL_POLL_INTERVAL, cfg?.pollIntervalSeconds ?? 15),
    enabled: cfg?.enabled !== false,
    source: envAddress ? 'env' : address ? 'config' : 'none',
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
    discord: config.discord
      ? {
          ...config.discord,
          botToken: config.discord.botToken ? '<secret:DISCORD_BOT_TOKEN>' : undefined,
        }
      : undefined,
    slack: config.slack
      ? {
          ...config.slack,
          botToken: config.slack.botToken ? '<secret:SLACK_BOT_TOKEN>' : undefined,
          appToken: config.slack.appToken ? '<secret:SLACK_APP_TOKEN>' : undefined,
        }
      : undefined,
    email: config.email
      ? {
          ...config.email,
          password: config.email.password ? '<secret:EMAIL_PASSWORD>' : undefined,
        }
      : undefined,
  };
}
