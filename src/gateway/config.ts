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

export interface LineGatewayConfig {
  enabled?: boolean;
  channelAccessToken?: string;
  channelSecret?: string;
  homeChannel?: string;
  allowedUsers?: string[];
  allowedGroups?: string[];
  allowedRooms?: string[];
  allowAllUsers?: boolean;
  publicUrl?: string;
}

export interface SmsGatewayConfig {
  enabled?: boolean;
  accountSid?: string;
  authToken?: string;
  phoneNumber?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  allowAllUsers?: boolean;
  webhookUrl?: string;
  insecureNoSignature?: boolean;
}

export interface NtfyGatewayConfig {
  enabled?: boolean;
  serverUrl?: string;
  topic?: string;
  publishTopic?: string;
  token?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  allowAllUsers?: boolean;
  markdown?: boolean;
}

export interface SignalGatewayConfig {
  enabled?: boolean;
  httpUrl?: string;
  account?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  groupAllowedUsers?: string[];
  allowAllUsers?: boolean;
  requireMention?: boolean;
}

export interface WebhookRouteConfig {
  events?: string[];
  secret?: string;
  prompt?: string;
  deliver?: string;
  deliverOnly?: boolean;
  description?: string;
  rateLimitPerMinute?: number;
}

export interface WebhookGatewayConfig {
  enabled?: boolean;
  secret?: string;
  publicUrl?: string;
  routes?: Record<string, WebhookRouteConfig>;
  rateLimitPerMinute?: number;
}

export interface GatewayConfig {
  telegram?: TelegramGatewayConfig;
  discord?: DiscordGatewayConfig;
  slack?: SlackGatewayConfig;
  email?: EmailGatewayConfig;
  line?: LineGatewayConfig;
  sms?: SmsGatewayConfig;
  ntfy?: NtfyGatewayConfig;
  signal?: SignalGatewayConfig;
  webhooks?: WebhookGatewayConfig;
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
    const line = raw.line;
    const sms = raw.sms;
    const ntfy = raw.ntfy;
    const signal = raw.signal;
    const webhooks = raw.webhooks;
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
      line: line
        ? {
            enabled: line.enabled !== false,
            channelAccessToken: typeof line.channelAccessToken === 'string' ? line.channelAccessToken : undefined,
            channelSecret: typeof line.channelSecret === 'string' ? line.channelSecret : undefined,
            homeChannel: typeof line.homeChannel === 'string' ? line.homeChannel : undefined,
            allowedUsers: Array.isArray(line.allowedUsers)
              ? line.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowedGroups: Array.isArray(line.allowedGroups)
              ? line.allowedGroups.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowedRooms: Array.isArray(line.allowedRooms)
              ? line.allowedRooms.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: line.allowAllUsers === true,
            publicUrl: typeof line.publicUrl === 'string' ? line.publicUrl : undefined,
          }
        : undefined,
      sms: sms
        ? {
            enabled: sms.enabled !== false,
            accountSid: typeof sms.accountSid === 'string' ? sms.accountSid : undefined,
            authToken: typeof sms.authToken === 'string' ? sms.authToken : undefined,
            phoneNumber: typeof sms.phoneNumber === 'string' ? sms.phoneNumber : undefined,
            homeChannel: typeof sms.homeChannel === 'string' ? sms.homeChannel : undefined,
            homeChannelName: typeof sms.homeChannelName === 'string' ? sms.homeChannelName : undefined,
            allowedUsers: Array.isArray(sms.allowedUsers)
              ? sms.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: sms.allowAllUsers === true,
            webhookUrl: typeof sms.webhookUrl === 'string' ? sms.webhookUrl : undefined,
            insecureNoSignature: sms.insecureNoSignature === true,
          }
        : undefined,
      ntfy: ntfy
        ? {
            enabled: ntfy.enabled !== false,
            serverUrl: typeof ntfy.serverUrl === 'string' ? ntfy.serverUrl : undefined,
            topic: typeof ntfy.topic === 'string' ? ntfy.topic : undefined,
            publishTopic: typeof ntfy.publishTopic === 'string' ? ntfy.publishTopic : undefined,
            token: typeof ntfy.token === 'string' ? ntfy.token : undefined,
            homeChannel: typeof ntfy.homeChannel === 'string' ? ntfy.homeChannel : undefined,
            homeChannelName: typeof ntfy.homeChannelName === 'string' ? ntfy.homeChannelName : undefined,
            allowedUsers: Array.isArray(ntfy.allowedUsers)
              ? ntfy.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: ntfy.allowAllUsers === true,
            markdown: ntfy.markdown === true,
          }
        : undefined,
      signal: signal
        ? {
            enabled: signal.enabled !== false,
            httpUrl: typeof signal.httpUrl === 'string' ? signal.httpUrl : undefined,
            account: typeof signal.account === 'string' ? signal.account.trim() : undefined,
            homeChannel: typeof signal.homeChannel === 'string' ? signal.homeChannel.trim() : undefined,
            homeChannelName: typeof signal.homeChannelName === 'string' ? signal.homeChannelName : undefined,
            allowedUsers: Array.isArray(signal.allowedUsers)
              ? signal.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            groupAllowedUsers: Array.isArray(signal.groupAllowedUsers)
              ? signal.groupAllowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: signal.allowAllUsers === true,
            requireMention: signal.requireMention === true,
          }
        : undefined,
      webhooks: webhooks
        ? {
            enabled: webhooks.enabled !== false,
            secret: typeof webhooks.secret === 'string' ? webhooks.secret : undefined,
            publicUrl: typeof webhooks.publicUrl === 'string' ? webhooks.publicUrl : undefined,
            rateLimitPerMinute: Number.isInteger(webhooks.rateLimitPerMinute) ? webhooks.rateLimitPerMinute : undefined,
            routes:
              webhooks.routes && typeof webhooks.routes === 'object'
                ? Object.fromEntries(
                    Object.entries(webhooks.routes)
                      .filter(([name, route]) => typeof name === 'string' && Boolean(route) && typeof route === 'object')
                      .map(([name, route]) => {
                        const r = route as WebhookRouteConfig;
                        return [
                          name.trim(),
                          {
                            events: Array.isArray(r.events)
                              ? r.events.filter((event) => typeof event === 'string' && event.trim()).map((event) => event.trim())
                              : undefined,
                            secret: typeof r.secret === 'string' ? r.secret : undefined,
                            prompt: typeof r.prompt === 'string' ? r.prompt : undefined,
                            deliver: typeof r.deliver === 'string' ? r.deliver : undefined,
                            deliverOnly: r.deliverOnly === true,
                            description: typeof r.description === 'string' ? r.description : undefined,
                            rateLimitPerMinute: Number.isInteger(r.rateLimitPerMinute) ? r.rateLimitPerMinute : undefined,
                          },
                        ];
                      })
                      .filter(([name]) => Boolean(name)),
                  )
                : undefined,
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
    line: patch.line ? { ...current.line, ...patch.line } : current.line,
    sms: patch.sms ? { ...current.sms, ...patch.sms } : current.sms,
    ntfy: patch.ntfy ? { ...current.ntfy, ...patch.ntfy } : current.ntfy,
    signal: patch.signal ? { ...current.signal, ...patch.signal } : current.signal,
    webhooks: patch.webhooks
      ? {
          ...current.webhooks,
          ...patch.webhooks,
          routes: patch.webhooks.routes ? { ...current.webhooks?.routes, ...patch.webhooks.routes } : current.webhooks?.routes,
        }
      : current.webhooks,
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

function optionalTrim(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed || undefined;
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

export interface ResolvedLineConfig {
  channelAccessToken?: string;
  channelSecret?: string;
  homeChannel?: string;
  allowedUsers: string[];
  allowedGroups: string[];
  allowedRooms: string[];
  allowAllUsers: boolean;
  publicUrl?: string;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveLineConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedLineConfig {
  const cfg = config.line;
  const envToken = env.LINE_CHANNEL_ACCESS_TOKEN;
  const channelAccessToken = envToken || cfg?.channelAccessToken;
  return {
    channelAccessToken,
    channelSecret: env.LINE_CHANNEL_SECRET || cfg?.channelSecret,
    homeChannel: env.LINE_HOME_CHANNEL || cfg?.homeChannel,
    allowedUsers: env.LINE_ALLOWED_USERS ? parseStringList(env.LINE_ALLOWED_USERS) : (cfg?.allowedUsers ?? []),
    allowedGroups: env.LINE_ALLOWED_GROUPS ? parseStringList(env.LINE_ALLOWED_GROUPS) : (cfg?.allowedGroups ?? []),
    allowedRooms: env.LINE_ALLOWED_ROOMS ? parseStringList(env.LINE_ALLOWED_ROOMS) : (cfg?.allowedRooms ?? []),
    allowAllUsers: env.LINE_ALLOW_ALL_USERS === '1' || env.LINE_ALLOW_ALL_USERS === 'true' || cfg?.allowAllUsers === true,
    publicUrl: env.LINE_PUBLIC_URL || cfg?.publicUrl,
    enabled: cfg?.enabled !== false,
    source: envToken ? 'env' : channelAccessToken ? 'config' : 'none',
  };
}

export interface ResolvedSmsConfig {
  accountSid?: string;
  authToken?: string;
  phoneNumber?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers: string[];
  allowAllUsers: boolean;
  webhookUrl?: string;
  insecureNoSignature: boolean;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveSmsConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedSmsConfig {
  const cfg = config.sms;
  const envAccountSid = env.TWILIO_ACCOUNT_SID;
  const envAuthToken = env.TWILIO_AUTH_TOKEN;
  const envPhoneNumber = env.TWILIO_PHONE_NUMBER;
  const accountSid = envAccountSid || cfg?.accountSid;
  const authToken = envAuthToken || cfg?.authToken;
  const phoneNumber = envPhoneNumber || cfg?.phoneNumber;
  return {
    accountSid,
    authToken,
    phoneNumber,
    homeChannel: env.SMS_HOME_CHANNEL || cfg?.homeChannel,
    homeChannelName: env.SMS_HOME_CHANNEL_NAME || cfg?.homeChannelName,
    allowedUsers: env.SMS_ALLOWED_USERS ? parseStringList(env.SMS_ALLOWED_USERS) : (cfg?.allowedUsers ?? []),
    allowAllUsers: env.SMS_ALLOW_ALL_USERS === '1' || env.SMS_ALLOW_ALL_USERS === 'true' || cfg?.allowAllUsers === true,
    webhookUrl: env.SMS_WEBHOOK_URL || cfg?.webhookUrl,
    insecureNoSignature:
      env.SMS_INSECURE_NO_SIGNATURE === '1' || env.SMS_INSECURE_NO_SIGNATURE === 'true' || cfg?.insecureNoSignature === true,
    enabled: cfg?.enabled !== false,
    source: envAccountSid || envAuthToken || envPhoneNumber ? 'env' : accountSid || authToken || phoneNumber ? 'config' : 'none',
  };
}

export interface ResolvedNtfyConfig {
  serverUrl: string;
  topic?: string;
  publishTopic?: string;
  token?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers: string[];
  allowAllUsers: boolean;
  markdown: boolean;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveNtfyConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedNtfyConfig {
  const cfg = config.ntfy;
  const envServerUrl = optionalTrim(env.NTFY_SERVER_URL);
  const envTopic = optionalTrim(env.NTFY_TOPIC);
  const envToken = optionalTrim(env.NTFY_TOKEN);
  const topic = envTopic || optionalTrim(cfg?.topic);
  const token = envToken || optionalTrim(cfg?.token);
  const serverUrl = (envServerUrl || optionalTrim(cfg?.serverUrl) || 'https://ntfy.sh').replace(/\/+$/, '');
  return {
    serverUrl,
    topic,
    publishTopic: optionalTrim(env.NTFY_PUBLISH_TOPIC) || optionalTrim(cfg?.publishTopic),
    token,
    homeChannel: optionalTrim(env.NTFY_HOME_CHANNEL) || optionalTrim(cfg?.homeChannel),
    homeChannelName: optionalTrim(env.NTFY_HOME_CHANNEL_NAME) || optionalTrim(cfg?.homeChannelName),
    allowedUsers: env.NTFY_ALLOWED_USERS ? parseStringList(env.NTFY_ALLOWED_USERS) : (cfg?.allowedUsers ?? []),
    allowAllUsers: env.NTFY_ALLOW_ALL_USERS === '1' || env.NTFY_ALLOW_ALL_USERS === 'true' || cfg?.allowAllUsers === true,
    markdown: env.NTFY_MARKDOWN === '1' || env.NTFY_MARKDOWN === 'true' || cfg?.markdown === true,
    enabled: cfg?.enabled !== false,
    source: envTopic || envToken || envServerUrl ? 'env' : topic || token || optionalTrim(cfg?.serverUrl) ? 'config' : 'none',
  };
}

export interface ResolvedSignalConfig {
  httpUrl: string;
  account?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers: string[];
  groupAllowedUsers: string[];
  allowAllUsers: boolean;
  requireMention: boolean;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveSignalConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedSignalConfig {
  const cfg = config.signal;
  const envHttpUrl = env.SIGNAL_HTTP_URL;
  const envAccount = env.SIGNAL_ACCOUNT;
  const account = envAccount || cfg?.account;
  const httpUrl = (envHttpUrl || cfg?.httpUrl || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  return {
    httpUrl,
    account,
    homeChannel: env.SIGNAL_HOME_CHANNEL || cfg?.homeChannel,
    homeChannelName: env.SIGNAL_HOME_CHANNEL_NAME || cfg?.homeChannelName,
    allowedUsers: env.SIGNAL_ALLOWED_USERS ? parseStringList(env.SIGNAL_ALLOWED_USERS) : (cfg?.allowedUsers ?? []),
    groupAllowedUsers: env.SIGNAL_GROUP_ALLOWED_USERS ? parseStringList(env.SIGNAL_GROUP_ALLOWED_USERS) : (cfg?.groupAllowedUsers ?? []),
    allowAllUsers: env.SIGNAL_ALLOW_ALL_USERS === '1' || env.SIGNAL_ALLOW_ALL_USERS === 'true' || cfg?.allowAllUsers === true,
    requireMention: env.SIGNAL_REQUIRE_MENTION === '1' || env.SIGNAL_REQUIRE_MENTION === 'true' || cfg?.requireMention === true,
    enabled: cfg?.enabled !== false,
    source: envHttpUrl || envAccount ? 'env' : account || cfg?.httpUrl ? 'config' : 'none',
  };
}

export interface ResolvedWebhookRouteConfig {
  name: string;
  events: string[];
  secret?: string;
  prompt?: string;
  deliver: string;
  deliverOnly: boolean;
  description?: string;
  rateLimitPerMinute?: number;
}

export interface ResolvedWebhookConfig {
  enabled: boolean;
  secret?: string;
  publicUrl?: string;
  routes: Record<string, ResolvedWebhookRouteConfig>;
  rateLimitPerMinute: number;
  source: 'env' | 'config' | 'none';
}

export function resolveWebhookConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedWebhookConfig {
  const cfg = config.webhooks;
  const envSecret = env.WEBHOOK_SECRET;
  const secret = envSecret || cfg?.secret;
  const routes = Object.fromEntries(
    Object.entries(cfg?.routes ?? {}).map(([name, route]) => [
      name,
      {
        name,
        events: route.events ?? [],
        secret: route.secret,
        prompt: route.prompt,
        deliver: route.deliver?.trim() || 'log',
        deliverOnly: route.deliverOnly === true,
        description: route.description,
        rateLimitPerMinute: route.rateLimitPerMinute,
      },
    ]),
  );
  const envEnabled = env.WEBHOOK_ENABLED;
  return {
    enabled: envEnabled === '1' || envEnabled === 'true' || cfg?.enabled === true,
    secret,
    publicUrl: env.WEBHOOK_PUBLIC_URL || cfg?.publicUrl,
    routes,
    rateLimitPerMinute: parsePositiveInt(env.WEBHOOK_RATE_LIMIT_PER_MINUTE, cfg?.rateLimitPerMinute ?? 30),
    source: envSecret || envEnabled ? 'env' : cfg ? 'config' : 'none',
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
    line: config.line
      ? {
          ...config.line,
          channelAccessToken: config.line.channelAccessToken ? '<secret:LINE_CHANNEL_ACCESS_TOKEN>' : undefined,
          channelSecret: config.line.channelSecret ? '<secret:LINE_CHANNEL_SECRET>' : undefined,
        }
      : undefined,
    sms: config.sms
      ? {
          ...config.sms,
          authToken: config.sms.authToken ? '<secret:TWILIO_AUTH_TOKEN>' : undefined,
        }
      : undefined,
    ntfy: config.ntfy
      ? {
          ...config.ntfy,
          token: config.ntfy.token ? '<secret:NTFY_TOKEN>' : undefined,
        }
      : undefined,
    signal: config.signal
      ? {
          ...config.signal,
          account: redactSignalIdentifier(config.signal.account),
          homeChannel: redactSignalIdentifier(config.signal.homeChannel),
          allowedUsers: config.signal.allowedUsers?.map(redactSignalIdentifier).filter((id): id is string => Boolean(id)),
          groupAllowedUsers: config.signal.groupAllowedUsers?.map(redactSignalIdentifier).filter((id): id is string => Boolean(id)),
        }
      : undefined,
    webhooks: config.webhooks
      ? {
          ...config.webhooks,
          secret: config.webhooks.secret ? '<secret:WEBHOOK_SECRET>' : undefined,
          routes: config.webhooks.routes
            ? Object.fromEntries(
                Object.entries(config.webhooks.routes).map(([name, route]) => [
                  name,
                  { ...route, secret: route.secret ? '<secret:WEBHOOK_ROUTE_SECRET>' : undefined },
                ]),
              )
            : undefined,
        }
      : undefined,
  };
}

function redactSignalIdentifier(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed === '*') return '*';
  const [prefix, body] = trimmed.startsWith('group:') ? ['group:', trimmed.slice('group:'.length)] : ['', trimmed];
  const visible = body.replace(/\s+/g, '');
  if (visible.length <= 6) return `${prefix}<redacted>`;
  return `${prefix}${visible.slice(0, 4)}…${visible.slice(-4)}`;
}
