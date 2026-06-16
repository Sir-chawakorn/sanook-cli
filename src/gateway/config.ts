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

export interface MattermostGatewayConfig {
  enabled?: boolean;
  serverUrl?: string;
  token?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  allowedChannels?: string[];
  freeResponseChannels?: string[];
  allowAllUsers?: boolean;
  requireMention?: boolean;
  groupSessionsPerUser?: boolean;
  replyMode?: 'off' | 'thread';
}

export interface HomeAssistantGatewayConfig {
  enabled?: boolean;
  url?: string;
  token?: string;
  homeChannel?: string;
  homeChannelName?: string;
  watchDomains?: string[];
  watchEntities?: string[];
  ignoreEntities?: string[];
  watchAll?: boolean;
  cooldownSeconds?: number;
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

export interface WhatsAppGatewayConfig {
  enabled?: boolean;
  phoneNumberId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  allowAllUsers?: boolean;
  publicUrl?: string;
  apiVersion?: string;
}

export interface MatrixGatewayConfig {
  enabled?: boolean;
  homeserver?: string;
  accessToken?: string;
  userId?: string;
  password?: string;
  homeRoom?: string;
  homeRoomName?: string;
  allowedUsers?: string[];
  allowedRooms?: string[];
  freeResponseRooms?: string[];
  allowAllUsers?: boolean;
  requireMention?: boolean;
  groupSessionsPerUser?: boolean;
  autoJoin?: boolean;
  pollTimeoutMs?: number;
}

export interface FeishuGatewayConfig {
  enabled?: boolean;
  domain?: 'feishu' | 'lark';
  baseUrl?: string;
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedChats?: string[];
  allowAllChats?: boolean;
  allowedUsers?: string[];
  allowAllUsers?: boolean;
}

export interface DingTalkGatewayConfig {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
  robotCode?: string;
  apiBaseUrl?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  allowedChats?: string[];
  freeResponseChats?: string[];
  allowAllUsers?: boolean;
  allowAllChats?: boolean;
  requireMention?: boolean;
  groupSessionsPerUser?: boolean;
}

export interface GoogleChatGatewayConfig {
  enabled?: boolean;
  projectId?: string;
  subscriptionName?: string;
  serviceAccountJson?: string;
  apiBaseUrl?: string;
  incomingWebhookUrl?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  allowedSpaces?: string[];
  freeResponseSpaces?: string[];
  allowAllUsers?: boolean;
  allowAllSpaces?: boolean;
  maxMessages?: number;
  maxBytes?: number;
}

export interface BlueBubblesGatewayConfig {
  enabled?: boolean;
  serverUrl?: string;
  password?: string;
  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  allowAllUsers?: boolean;
  requireMention?: boolean;
  mentionPatterns?: string[];
  sendReadReceipts?: boolean;
}

export type WeComDmPolicy = 'open' | 'allowlist' | 'disabled' | 'pairing';
export type WeComGroupPolicy = 'open' | 'allowlist' | 'disabled';

export interface WeComGatewayConfig {
  enabled?: boolean;
  botId?: string;
  secret?: string;
  websocketUrl?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  allowedGroups?: string[];
  dmPolicy?: WeComDmPolicy;
  groupPolicy?: WeComGroupPolicy;
}

export type WeixinDmPolicy = 'open' | 'allowlist' | 'disabled' | 'pairing';
export type WeixinGroupPolicy = 'open' | 'allowlist' | 'disabled';

export interface WeixinGatewayConfig {
  enabled?: boolean;
  accountId?: string;
  token?: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  groupAllowedUsers?: string[];
  allowAllUsers?: boolean;
  dmPolicy?: WeixinDmPolicy;
  groupPolicy?: WeixinGroupPolicy;
  splitMultilineMessages?: boolean;
}

export type YuanbaoPolicy = 'open' | 'allowlist' | 'disabled';

export interface YuanbaoGatewayConfig {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  botId?: string;
  wsUrl?: string;
  apiDomain?: string;
  routeEnv?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  groupAllowedUsers?: string[];
  allowAllUsers?: boolean;
  dmPolicy?: YuanbaoPolicy;
  groupPolicy?: YuanbaoPolicy;
}

export type QQBotDmPolicy = 'open' | 'allowlist' | 'disabled' | 'pairing';
export type QQBotGroupPolicy = 'open' | 'allowlist' | 'disabled';

export interface QQBotGatewayConfig {
  enabled?: boolean;
  appId?: string;
  clientSecret?: string;
  apiBaseUrl?: string;
  tokenUrl?: string;
  portalHost?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers?: string[];
  groupAllowedUsers?: string[];
  allowedChannels?: string[];
  allowAllUsers?: boolean;
  dmPolicy?: QQBotDmPolicy;
  groupPolicy?: QQBotGroupPolicy;
  markdownSupport?: boolean;
}

export interface TeamsGatewayConfig {
  enabled?: boolean;
  deliveryMode?: 'incoming_webhook' | 'graph';
  incomingWebhookUrl?: string;
  graphAccessToken?: string;
  teamId?: string;
  channelId?: string;
  chatId?: string;
  homeChannel?: string;
  homeChannelName?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  allowedUsers?: string[];
  allowAllUsers?: boolean;
  port?: number;
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
  mattermost?: MattermostGatewayConfig;
  homeassistant?: HomeAssistantGatewayConfig;
  email?: EmailGatewayConfig;
  line?: LineGatewayConfig;
  sms?: SmsGatewayConfig;
  ntfy?: NtfyGatewayConfig;
  signal?: SignalGatewayConfig;
  whatsapp?: WhatsAppGatewayConfig;
  matrix?: MatrixGatewayConfig;
  feishu?: FeishuGatewayConfig;
  dingtalk?: DingTalkGatewayConfig;
  googleChat?: GoogleChatGatewayConfig;
  bluebubbles?: BlueBubblesGatewayConfig;
  wecom?: WeComGatewayConfig;
  weixin?: WeixinGatewayConfig;
  yuanbao?: YuanbaoGatewayConfig;
  qqbot?: QQBotGatewayConfig;
  teams?: TeamsGatewayConfig;
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
    const mattermost = raw.mattermost;
    const homeassistant = raw.homeassistant;
    const email = raw.email;
    const line = raw.line;
    const sms = raw.sms;
    const ntfy = raw.ntfy;
    const signal = raw.signal;
    const whatsapp = raw.whatsapp;
    const matrix = raw.matrix;
    const feishu = raw.feishu;
    const dingtalk = raw.dingtalk;
    const googleChat = raw.googleChat;
    const bluebubbles = raw.bluebubbles;
    const wecom = raw.wecom;
    const weixin = raw.weixin;
    const yuanbao = raw.yuanbao;
    const qqbot = raw.qqbot;
    const teams = raw.teams;
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
      mattermost: mattermost
        ? {
            enabled: mattermost.enabled !== false,
            serverUrl: typeof mattermost.serverUrl === 'string' ? mattermost.serverUrl.trim() : undefined,
            token: typeof mattermost.token === 'string' ? mattermost.token : undefined,
            homeChannel: typeof mattermost.homeChannel === 'string' ? mattermost.homeChannel.trim() : undefined,
            homeChannelName: typeof mattermost.homeChannelName === 'string' ? mattermost.homeChannelName : undefined,
            allowedUsers: Array.isArray(mattermost.allowedUsers)
              ? mattermost.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowedChannels: Array.isArray(mattermost.allowedChannels)
              ? mattermost.allowedChannels.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            freeResponseChannels: Array.isArray(mattermost.freeResponseChannels)
              ? mattermost.freeResponseChannels.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: mattermost.allowAllUsers === true,
            requireMention: mattermost.requireMention !== false,
            groupSessionsPerUser: mattermost.groupSessionsPerUser !== false,
            replyMode: mattermost.replyMode === 'thread' ? 'thread' : 'off',
          }
        : undefined,
      homeassistant: homeassistant
        ? {
            enabled: homeassistant.enabled !== false,
            url: typeof homeassistant.url === 'string' ? homeassistant.url.trim() : undefined,
            token: typeof homeassistant.token === 'string' ? homeassistant.token : undefined,
            homeChannel: typeof homeassistant.homeChannel === 'string' ? homeassistant.homeChannel.trim() : undefined,
            homeChannelName: typeof homeassistant.homeChannelName === 'string' ? homeassistant.homeChannelName : undefined,
            watchDomains: Array.isArray(homeassistant.watchDomains)
              ? homeassistant.watchDomains.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            watchEntities: Array.isArray(homeassistant.watchEntities)
              ? homeassistant.watchEntities.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            ignoreEntities: Array.isArray(homeassistant.ignoreEntities)
              ? homeassistant.ignoreEntities.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            watchAll: homeassistant.watchAll === true,
            cooldownSeconds: Number.isInteger(homeassistant.cooldownSeconds) ? homeassistant.cooldownSeconds : undefined,
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
      whatsapp: whatsapp
        ? {
            enabled: whatsapp.enabled !== false,
            phoneNumberId: typeof whatsapp.phoneNumberId === 'string' ? whatsapp.phoneNumberId.trim() : undefined,
            accessToken: typeof whatsapp.accessToken === 'string' ? whatsapp.accessToken : undefined,
            appSecret: typeof whatsapp.appSecret === 'string' ? whatsapp.appSecret : undefined,
            verifyToken: typeof whatsapp.verifyToken === 'string' ? whatsapp.verifyToken : undefined,
            homeChannel: typeof whatsapp.homeChannel === 'string' ? whatsapp.homeChannel.trim() : undefined,
            homeChannelName: typeof whatsapp.homeChannelName === 'string' ? whatsapp.homeChannelName : undefined,
            allowedUsers: Array.isArray(whatsapp.allowedUsers)
              ? whatsapp.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: whatsapp.allowAllUsers === true,
            publicUrl: typeof whatsapp.publicUrl === 'string' ? whatsapp.publicUrl : undefined,
            apiVersion: typeof whatsapp.apiVersion === 'string' ? whatsapp.apiVersion.trim() : undefined,
          }
        : undefined,
      matrix: matrix
        ? {
            enabled: matrix.enabled !== false,
            homeserver: typeof matrix.homeserver === 'string' ? matrix.homeserver.trim() : undefined,
            accessToken: typeof matrix.accessToken === 'string' ? matrix.accessToken : undefined,
            userId: typeof matrix.userId === 'string' ? matrix.userId.trim() : undefined,
            password: typeof matrix.password === 'string' ? matrix.password : undefined,
            homeRoom: typeof matrix.homeRoom === 'string' ? matrix.homeRoom.trim() : undefined,
            homeRoomName: typeof matrix.homeRoomName === 'string' ? matrix.homeRoomName : undefined,
            allowedUsers: Array.isArray(matrix.allowedUsers)
              ? matrix.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowedRooms: Array.isArray(matrix.allowedRooms)
              ? matrix.allowedRooms.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            freeResponseRooms: Array.isArray(matrix.freeResponseRooms)
              ? matrix.freeResponseRooms.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: matrix.allowAllUsers === true,
            requireMention: matrix.requireMention !== false,
            groupSessionsPerUser: matrix.groupSessionsPerUser !== false,
            autoJoin: matrix.autoJoin !== false,
            pollTimeoutMs: Number.isInteger(matrix.pollTimeoutMs) ? matrix.pollTimeoutMs : undefined,
          }
        : undefined,
      feishu: feishu
        ? {
            enabled: feishu.enabled !== false,
            domain: feishu.domain === 'lark' ? 'lark' : 'feishu',
            baseUrl: typeof feishu.baseUrl === 'string' ? feishu.baseUrl.trim() : undefined,
            appId: typeof feishu.appId === 'string' ? feishu.appId.trim() : undefined,
            appSecret: typeof feishu.appSecret === 'string' ? feishu.appSecret : undefined,
            verificationToken: typeof feishu.verificationToken === 'string' ? feishu.verificationToken : undefined,
            encryptKey: typeof feishu.encryptKey === 'string' ? feishu.encryptKey : undefined,
            homeChannel: typeof feishu.homeChannel === 'string' ? feishu.homeChannel.trim() : undefined,
            homeChannelName: typeof feishu.homeChannelName === 'string' ? feishu.homeChannelName : undefined,
            allowedChats: Array.isArray(feishu.allowedChats)
              ? feishu.allowedChats.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllChats: feishu.allowAllChats === true,
            allowedUsers: Array.isArray(feishu.allowedUsers)
              ? feishu.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: feishu.allowAllUsers === true,
          }
        : undefined,
      dingtalk: dingtalk
        ? {
            enabled: dingtalk.enabled !== false,
            clientId: typeof dingtalk.clientId === 'string' ? dingtalk.clientId.trim() : undefined,
            clientSecret: typeof dingtalk.clientSecret === 'string' ? dingtalk.clientSecret : undefined,
            robotCode: typeof dingtalk.robotCode === 'string' ? dingtalk.robotCode.trim() : undefined,
            apiBaseUrl: typeof dingtalk.apiBaseUrl === 'string' ? dingtalk.apiBaseUrl.trim() : undefined,
            webhookUrl: typeof dingtalk.webhookUrl === 'string' ? dingtalk.webhookUrl.trim() : undefined,
            webhookSecret: typeof dingtalk.webhookSecret === 'string' ? dingtalk.webhookSecret : undefined,
            homeChannel: typeof dingtalk.homeChannel === 'string' ? dingtalk.homeChannel.trim() : undefined,
            homeChannelName: typeof dingtalk.homeChannelName === 'string' ? dingtalk.homeChannelName : undefined,
            allowedUsers: Array.isArray(dingtalk.allowedUsers)
              ? dingtalk.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowedChats: Array.isArray(dingtalk.allowedChats)
              ? dingtalk.allowedChats.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            freeResponseChats: Array.isArray(dingtalk.freeResponseChats)
              ? dingtalk.freeResponseChats.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: dingtalk.allowAllUsers === true,
            allowAllChats: dingtalk.allowAllChats === true,
            requireMention: dingtalk.requireMention !== false,
            groupSessionsPerUser: dingtalk.groupSessionsPerUser !== false,
          }
        : undefined,
      googleChat: googleChat
        ? {
            enabled: googleChat.enabled !== false,
            projectId: typeof googleChat.projectId === 'string' ? googleChat.projectId.trim() : undefined,
            subscriptionName: typeof googleChat.subscriptionName === 'string' ? googleChat.subscriptionName.trim() : undefined,
            serviceAccountJson: typeof googleChat.serviceAccountJson === 'string' ? googleChat.serviceAccountJson.trim() : undefined,
            apiBaseUrl: typeof googleChat.apiBaseUrl === 'string' ? googleChat.apiBaseUrl.trim() : undefined,
            incomingWebhookUrl: typeof googleChat.incomingWebhookUrl === 'string' ? googleChat.incomingWebhookUrl.trim() : undefined,
            homeChannel: typeof googleChat.homeChannel === 'string' ? googleChat.homeChannel.trim() : undefined,
            homeChannelName: typeof googleChat.homeChannelName === 'string' ? googleChat.homeChannelName : undefined,
            allowedUsers: Array.isArray(googleChat.allowedUsers)
              ? googleChat.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowedSpaces: Array.isArray(googleChat.allowedSpaces)
              ? googleChat.allowedSpaces.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            freeResponseSpaces: Array.isArray(googleChat.freeResponseSpaces)
              ? googleChat.freeResponseSpaces.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: googleChat.allowAllUsers === true,
            allowAllSpaces: googleChat.allowAllSpaces === true,
            maxMessages: Number.isInteger(googleChat.maxMessages) ? googleChat.maxMessages : undefined,
            maxBytes: Number.isInteger(googleChat.maxBytes) ? googleChat.maxBytes : undefined,
          }
        : undefined,
      bluebubbles: bluebubbles
        ? {
            enabled: bluebubbles.enabled !== false,
            serverUrl: typeof bluebubbles.serverUrl === 'string' ? bluebubbles.serverUrl.trim() : undefined,
            password: typeof bluebubbles.password === 'string' ? bluebubbles.password : undefined,
            webhookHost: typeof bluebubbles.webhookHost === 'string' ? bluebubbles.webhookHost.trim() : undefined,
            webhookPort: Number.isInteger(bluebubbles.webhookPort) ? bluebubbles.webhookPort : undefined,
            webhookPath: typeof bluebubbles.webhookPath === 'string' ? bluebubbles.webhookPath.trim() : undefined,
            homeChannel: typeof bluebubbles.homeChannel === 'string' ? bluebubbles.homeChannel.trim() : undefined,
            homeChannelName: typeof bluebubbles.homeChannelName === 'string' ? bluebubbles.homeChannelName : undefined,
            allowedUsers: Array.isArray(bluebubbles.allowedUsers)
              ? bluebubbles.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: bluebubbles.allowAllUsers === true,
            requireMention: bluebubbles.requireMention === true,
            mentionPatterns: Array.isArray(bluebubbles.mentionPatterns)
              ? bluebubbles.mentionPatterns.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            sendReadReceipts: bluebubbles.sendReadReceipts !== false,
          }
        : undefined,
      teams: teams
        ? {
            enabled: teams.enabled !== false,
            deliveryMode: teams.deliveryMode === 'graph' ? 'graph' : 'incoming_webhook',
            incomingWebhookUrl: typeof teams.incomingWebhookUrl === 'string' ? teams.incomingWebhookUrl.trim() : undefined,
            graphAccessToken: typeof teams.graphAccessToken === 'string' ? teams.graphAccessToken : undefined,
            teamId: typeof teams.teamId === 'string' ? teams.teamId.trim() : undefined,
            channelId: typeof teams.channelId === 'string' ? teams.channelId.trim() : undefined,
            chatId: typeof teams.chatId === 'string' ? teams.chatId.trim() : undefined,
            homeChannel: typeof teams.homeChannel === 'string' ? teams.homeChannel.trim() : undefined,
            homeChannelName: typeof teams.homeChannelName === 'string' ? teams.homeChannelName : undefined,
            clientId: typeof teams.clientId === 'string' ? teams.clientId.trim() : undefined,
            clientSecret: typeof teams.clientSecret === 'string' ? teams.clientSecret : undefined,
            tenantId: typeof teams.tenantId === 'string' ? teams.tenantId.trim() : undefined,
            allowedUsers: Array.isArray(teams.allowedUsers)
              ? teams.allowedUsers.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
              : undefined,
            allowAllUsers: teams.allowAllUsers === true,
            port: Number.isInteger(teams.port) ? teams.port : undefined,
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
    mattermost: patch.mattermost ? { ...current.mattermost, ...patch.mattermost } : current.mattermost,
    homeassistant: patch.homeassistant ? { ...current.homeassistant, ...patch.homeassistant } : current.homeassistant,
    email: patch.email ? { ...current.email, ...patch.email } : current.email,
    line: patch.line ? { ...current.line, ...patch.line } : current.line,
    sms: patch.sms ? { ...current.sms, ...patch.sms } : current.sms,
    ntfy: patch.ntfy ? { ...current.ntfy, ...patch.ntfy } : current.ntfy,
    signal: patch.signal ? { ...current.signal, ...patch.signal } : current.signal,
    whatsapp: patch.whatsapp ? { ...current.whatsapp, ...patch.whatsapp } : current.whatsapp,
    matrix: patch.matrix ? { ...current.matrix, ...patch.matrix } : current.matrix,
    googleChat: patch.googleChat ? { ...current.googleChat, ...patch.googleChat } : current.googleChat,
    bluebubbles: patch.bluebubbles ? { ...current.bluebubbles, ...patch.bluebubbles } : current.bluebubbles,
    teams: patch.teams ? { ...current.teams, ...patch.teams } : current.teams,
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

function parseFlexibleStringList(raw: string | undefined): string[] {
  const text = raw?.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
    } catch {
      // Fall back to CSV/newline parsing below.
    }
  }
  return text
    .split(/\r?\n|,/)
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

export interface ResolvedMattermostConfig {
  serverUrl?: string;
  token?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers: string[];
  allowedChannels: string[];
  freeResponseChannels: string[];
  allowAllUsers: boolean;
  requireMention: boolean;
  groupSessionsPerUser: boolean;
  replyMode: 'off' | 'thread';
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveMattermostConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedMattermostConfig {
  const cfg = config.mattermost;
  const envServerUrl = optionalTrim(env.MATTERMOST_URL) || optionalTrim(env.MATTERMOST_SERVER_URL);
  const envToken = optionalTrim(env.MATTERMOST_TOKEN);
  const serverUrl = (envServerUrl || optionalTrim(cfg?.serverUrl))?.replace(/\/+$/, '');
  const token = envToken || optionalTrim(cfg?.token);
  const requireMentionEnv = env.MATTERMOST_REQUIRE_MENTION;
  const groupSessionsEnv = env.MATTERMOST_GROUP_SESSIONS_PER_USER;
  const replyModeRaw = optionalTrim(env.MATTERMOST_REPLY_MODE) || optionalTrim(cfg?.replyMode);
  const replyMode = replyModeRaw === 'thread' ? 'thread' : 'off';
  return {
    serverUrl,
    token,
    homeChannel: optionalTrim(env.MATTERMOST_HOME_CHANNEL) || optionalTrim(cfg?.homeChannel),
    homeChannelName: optionalTrim(env.MATTERMOST_HOME_CHANNEL_NAME) || optionalTrim(cfg?.homeChannelName),
    allowedUsers: env.MATTERMOST_ALLOWED_USERS ? parseStringList(env.MATTERMOST_ALLOWED_USERS) : (cfg?.allowedUsers ?? []),
    allowedChannels: env.MATTERMOST_ALLOWED_CHANNELS ? parseStringList(env.MATTERMOST_ALLOWED_CHANNELS) : (cfg?.allowedChannels ?? []),
    freeResponseChannels: env.MATTERMOST_FREE_RESPONSE_CHANNELS
      ? parseStringList(env.MATTERMOST_FREE_RESPONSE_CHANNELS)
      : (cfg?.freeResponseChannels ?? []),
    allowAllUsers:
      env.MATTERMOST_ALLOW_ALL_USERS === '1' || env.MATTERMOST_ALLOW_ALL_USERS === 'true' || cfg?.allowAllUsers === true,
    requireMention:
      requireMentionEnv == null ? cfg?.requireMention !== false : requireMentionEnv === '1' || requireMentionEnv === 'true',
    groupSessionsPerUser:
      groupSessionsEnv == null ? cfg?.groupSessionsPerUser !== false : groupSessionsEnv === '1' || groupSessionsEnv === 'true',
    replyMode,
    enabled: cfg?.enabled !== false,
    source: envServerUrl || envToken ? 'env' : serverUrl || token ? 'config' : 'none',
  };
}

export interface ResolvedHomeAssistantConfig {
  url: string;
  token?: string;
  homeChannel?: string;
  homeChannelName?: string;
  watchDomains: string[];
  watchEntities: string[];
  ignoreEntities: string[];
  watchAll: boolean;
  cooldownSeconds: number;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveHomeAssistantConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedHomeAssistantConfig {
  const cfg = config.homeassistant;
  const envToken = optionalTrim(env.HASS_TOKEN);
  const envUrl = optionalTrim(env.HASS_URL);
  const url = (envUrl || optionalTrim(cfg?.url) || 'http://homeassistant.local:8123').replace(/\/+$/, '');
  const watchAllEnv = env.HASS_WATCH_ALL;
  return {
    url,
    token: envToken || optionalTrim(cfg?.token),
    homeChannel: optionalTrim(env.HASS_HOME_CHANNEL) || optionalTrim(cfg?.homeChannel),
    homeChannelName: optionalTrim(env.HASS_HOME_CHANNEL_NAME) || optionalTrim(cfg?.homeChannelName),
    watchDomains: env.HASS_WATCH_DOMAINS ? parseStringList(env.HASS_WATCH_DOMAINS) : (cfg?.watchDomains ?? []),
    watchEntities: env.HASS_WATCH_ENTITIES ? parseStringList(env.HASS_WATCH_ENTITIES) : (cfg?.watchEntities ?? []),
    ignoreEntities: env.HASS_IGNORE_ENTITIES ? parseStringList(env.HASS_IGNORE_ENTITIES) : (cfg?.ignoreEntities ?? []),
    watchAll: watchAllEnv == null ? cfg?.watchAll === true : watchAllEnv === '1' || watchAllEnv === 'true',
    cooldownSeconds: parsePositiveInt(env.HASS_COOLDOWN_SECONDS, cfg?.cooldownSeconds ?? 30),
    enabled: cfg?.enabled !== false,
    source: envToken || envUrl ? 'env' : cfg?.token || cfg?.url ? 'config' : 'none',
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

export interface ResolvedWhatsAppConfig {
  phoneNumberId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers: string[];
  allowAllUsers: boolean;
  publicUrl?: string;
  apiVersion: string;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveWhatsAppConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedWhatsAppConfig {
  const cfg = config.whatsapp;
  const envPhoneNumberId = optionalTrim(env.WHATSAPP_CLOUD_PHONE_NUMBER_ID);
  const envAccessToken = optionalTrim(env.WHATSAPP_CLOUD_ACCESS_TOKEN);
  const envAppSecret = optionalTrim(env.WHATSAPP_CLOUD_APP_SECRET);
  const phoneNumberId = envPhoneNumberId || optionalTrim(cfg?.phoneNumberId);
  const accessToken = envAccessToken || optionalTrim(cfg?.accessToken);
  const appSecret = envAppSecret || optionalTrim(cfg?.appSecret);
  return {
    phoneNumberId,
    accessToken,
    appSecret,
    verifyToken: optionalTrim(env.WHATSAPP_CLOUD_VERIFY_TOKEN) || optionalTrim(cfg?.verifyToken),
    homeChannel: optionalTrim(env.WHATSAPP_CLOUD_HOME_CHANNEL) || optionalTrim(cfg?.homeChannel),
    homeChannelName: optionalTrim(env.WHATSAPP_CLOUD_HOME_CHANNEL_NAME) || optionalTrim(cfg?.homeChannelName),
    allowedUsers: env.WHATSAPP_CLOUD_ALLOWED_USERS ? parseStringList(env.WHATSAPP_CLOUD_ALLOWED_USERS) : (cfg?.allowedUsers ?? []),
    allowAllUsers:
      env.WHATSAPP_CLOUD_ALLOW_ALL_USERS === '1' || env.WHATSAPP_CLOUD_ALLOW_ALL_USERS === 'true' || cfg?.allowAllUsers === true,
    publicUrl: optionalTrim(env.WHATSAPP_CLOUD_PUBLIC_URL) || optionalTrim(cfg?.publicUrl),
    apiVersion: optionalTrim(env.WHATSAPP_CLOUD_API_VERSION) || optionalTrim(cfg?.apiVersion) || 'v20.0',
    enabled: cfg?.enabled !== false,
    source: envPhoneNumberId || envAccessToken || envAppSecret ? 'env' : phoneNumberId || accessToken || appSecret ? 'config' : 'none',
  };
}

export interface ResolvedMatrixConfig {
  homeserver?: string;
  accessToken?: string;
  userId?: string;
  password?: string;
  homeRoom?: string;
  homeRoomName?: string;
  allowedUsers: string[];
  allowedRooms: string[];
  freeResponseRooms: string[];
  allowAllUsers: boolean;
  requireMention: boolean;
  groupSessionsPerUser: boolean;
  autoJoin: boolean;
  pollTimeoutMs: number;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveMatrixConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedMatrixConfig {
  const cfg = config.matrix;
  const envHomeserver = optionalTrim(env.MATRIX_HOMESERVER);
  const envAccessToken = optionalTrim(env.MATRIX_ACCESS_TOKEN);
  const envUserId = optionalTrim(env.MATRIX_USER_ID);
  const envPassword = optionalTrim(env.MATRIX_PASSWORD);
  const homeserver = (envHomeserver || optionalTrim(cfg?.homeserver))?.replace(/\/+$/, '');
  const accessToken = envAccessToken || optionalTrim(cfg?.accessToken);
  const userId = envUserId || optionalTrim(cfg?.userId);
  const password = envPassword || optionalTrim(cfg?.password);
  const requireMentionEnv = env.MATRIX_REQUIRE_MENTION;
  const groupSessionsEnv = env.MATRIX_GROUP_SESSIONS_PER_USER;
  const autoJoinEnv = env.MATRIX_AUTO_JOIN;
  return {
    homeserver,
    accessToken,
    userId,
    password,
    homeRoom: optionalTrim(env.MATRIX_HOME_ROOM) || optionalTrim(cfg?.homeRoom),
    homeRoomName: optionalTrim(env.MATRIX_HOME_ROOM_NAME) || optionalTrim(cfg?.homeRoomName),
    allowedUsers: env.MATRIX_ALLOWED_USERS ? parseStringList(env.MATRIX_ALLOWED_USERS) : (cfg?.allowedUsers ?? []),
    allowedRooms: env.MATRIX_ALLOWED_ROOMS ? parseStringList(env.MATRIX_ALLOWED_ROOMS) : (cfg?.allowedRooms ?? []),
    freeResponseRooms: env.MATRIX_FREE_RESPONSE_ROOMS ? parseStringList(env.MATRIX_FREE_RESPONSE_ROOMS) : (cfg?.freeResponseRooms ?? []),
    allowAllUsers: env.MATRIX_ALLOW_ALL_USERS === '1' || env.MATRIX_ALLOW_ALL_USERS === 'true' || cfg?.allowAllUsers === true,
    requireMention: requireMentionEnv == null ? cfg?.requireMention !== false : requireMentionEnv === '1' || requireMentionEnv === 'true',
    groupSessionsPerUser: groupSessionsEnv == null ? cfg?.groupSessionsPerUser !== false : groupSessionsEnv === '1' || groupSessionsEnv === 'true',
    autoJoin: autoJoinEnv == null ? cfg?.autoJoin !== false : autoJoinEnv === '1' || autoJoinEnv === 'true',
    pollTimeoutMs: parsePositiveInt(env.MATRIX_POLL_TIMEOUT_MS, cfg?.pollTimeoutMs ?? 30_000),
    enabled: cfg?.enabled !== false,
    source:
      envHomeserver || envAccessToken || envUserId || envPassword
        ? 'env'
        : homeserver || accessToken || userId || password
          ? 'config'
          : 'none',
  };
}

export interface ResolvedGoogleChatConfig {
  projectId?: string;
  subscriptionName?: string;
  serviceAccountJson?: string;
  apiBaseUrl: string;
  incomingWebhookUrl?: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers: string[];
  allowedSpaces: string[];
  freeResponseSpaces: string[];
  allowAllUsers: boolean;
  allowAllSpaces: boolean;
  maxMessages: number;
  maxBytes: number;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveGoogleChatConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedGoogleChatConfig {
  const cfg = config.googleChat;
  const envProjectId = optionalTrim(env.GOOGLE_CHAT_PROJECT_ID) || optionalTrim(env.GOOGLE_CLOUD_PROJECT);
  const envSubscriptionName = optionalTrim(env.GOOGLE_CHAT_SUBSCRIPTION_NAME);
  const envServiceAccountJson = optionalTrim(env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON) || optionalTrim(env.GOOGLE_APPLICATION_CREDENTIALS);
  const envApiBaseUrl = optionalTrim(env.GOOGLE_CHAT_API_BASE_URL);
  const envIncomingWebhookUrl = optionalTrim(env.GOOGLE_CHAT_INCOMING_WEBHOOK_URL) || optionalTrim(env.GOOGLE_CHAT_WEBHOOK_URL);
  return {
    projectId: envProjectId || optionalTrim(cfg?.projectId),
    subscriptionName: envSubscriptionName || optionalTrim(cfg?.subscriptionName),
    serviceAccountJson: envServiceAccountJson || optionalTrim(cfg?.serviceAccountJson),
    apiBaseUrl: (envApiBaseUrl || optionalTrim(cfg?.apiBaseUrl) || 'https://chat.googleapis.com').replace(/\/+$/, ''),
    incomingWebhookUrl: envIncomingWebhookUrl || optionalTrim(cfg?.incomingWebhookUrl),
    homeChannel: optionalTrim(env.GOOGLE_CHAT_HOME_CHANNEL) || optionalTrim(cfg?.homeChannel),
    homeChannelName: optionalTrim(env.GOOGLE_CHAT_HOME_CHANNEL_NAME) || optionalTrim(cfg?.homeChannelName),
    allowedUsers: env.GOOGLE_CHAT_ALLOWED_USERS ? parseStringList(env.GOOGLE_CHAT_ALLOWED_USERS) : (cfg?.allowedUsers ?? []),
    allowedSpaces: env.GOOGLE_CHAT_ALLOWED_SPACES ? parseStringList(env.GOOGLE_CHAT_ALLOWED_SPACES) : (cfg?.allowedSpaces ?? []),
    freeResponseSpaces: env.GOOGLE_CHAT_FREE_RESPONSE_SPACES
      ? parseStringList(env.GOOGLE_CHAT_FREE_RESPONSE_SPACES)
      : (cfg?.freeResponseSpaces ?? []),
    allowAllUsers: env.GOOGLE_CHAT_ALLOW_ALL_USERS === '1' || env.GOOGLE_CHAT_ALLOW_ALL_USERS === 'true' || cfg?.allowAllUsers === true,
    allowAllSpaces: env.GOOGLE_CHAT_ALLOW_ALL_SPACES === '1' || env.GOOGLE_CHAT_ALLOW_ALL_SPACES === 'true' || cfg?.allowAllSpaces === true,
    maxMessages: parsePositiveInt(env.GOOGLE_CHAT_MAX_MESSAGES, cfg?.maxMessages ?? 1),
    maxBytes: parsePositiveInt(env.GOOGLE_CHAT_MAX_BYTES, cfg?.maxBytes ?? 16_777_216),
    enabled: cfg?.enabled !== false,
    source:
      envProjectId || envSubscriptionName || envServiceAccountJson || envApiBaseUrl || envIncomingWebhookUrl
        ? 'env'
        : cfg?.projectId || cfg?.subscriptionName || cfg?.serviceAccountJson || cfg?.apiBaseUrl || cfg?.incomingWebhookUrl
          ? 'config'
          : 'none',
  };
}

export interface ResolvedBlueBubblesConfig {
  serverUrl?: string;
  password?: string;
  webhookHost: string;
  webhookPort: number;
  webhookPath: string;
  homeChannel?: string;
  homeChannelName?: string;
  allowedUsers: string[];
  allowAllUsers: boolean;
  requireMention: boolean;
  mentionPatterns: string[];
  sendReadReceipts: boolean;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveBlueBubblesConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedBlueBubblesConfig {
  const cfg = config.bluebubbles;
  const envServerUrl = optionalTrim(env.BLUEBUBBLES_SERVER_URL);
  const envPassword = optionalTrim(env.BLUEBUBBLES_PASSWORD);
  const envWebhookHost = optionalTrim(env.BLUEBUBBLES_WEBHOOK_HOST);
  const envWebhookPath = optionalTrim(env.BLUEBUBBLES_WEBHOOK_PATH);
  const envRequireMention = env.BLUEBUBBLES_REQUIRE_MENTION;
  const envSendReadReceipts = env.BLUEBUBBLES_SEND_READ_RECEIPTS;
  return {
    serverUrl: envServerUrl || optionalTrim(cfg?.serverUrl),
    password: envPassword || optionalTrim(cfg?.password),
    webhookHost: envWebhookHost || optionalTrim(cfg?.webhookHost) || '127.0.0.1',
    webhookPort: parsePositiveInt(env.BLUEBUBBLES_WEBHOOK_PORT, cfg?.webhookPort ?? 8645),
    webhookPath: envWebhookPath || optionalTrim(cfg?.webhookPath) || '/bluebubbles-webhook',
    homeChannel: optionalTrim(env.BLUEBUBBLES_HOME_CHANNEL) || optionalTrim(cfg?.homeChannel),
    homeChannelName: optionalTrim(env.BLUEBUBBLES_HOME_CHANNEL_NAME) || optionalTrim(cfg?.homeChannelName),
    allowedUsers: env.BLUEBUBBLES_ALLOWED_USERS ? parseStringList(env.BLUEBUBBLES_ALLOWED_USERS) : (cfg?.allowedUsers ?? []),
    allowAllUsers:
      env.BLUEBUBBLES_ALLOW_ALL_USERS === '1' || env.BLUEBUBBLES_ALLOW_ALL_USERS === 'true' || cfg?.allowAllUsers === true,
    requireMention:
      envRequireMention == null ? cfg?.requireMention === true : envRequireMention === '1' || envRequireMention === 'true',
    mentionPatterns: env.BLUEBUBBLES_MENTION_PATTERNS
      ? parseFlexibleStringList(env.BLUEBUBBLES_MENTION_PATTERNS)
      : (cfg?.mentionPatterns ?? []),
    sendReadReceipts:
      envSendReadReceipts == null
        ? cfg?.sendReadReceipts !== false
        : envSendReadReceipts === '1' || envSendReadReceipts === 'true',
    enabled: cfg?.enabled !== false,
    source: envServerUrl || envPassword ? 'env' : cfg?.serverUrl || cfg?.password ? 'config' : 'none',
  };
}

export interface ResolvedTeamsConfig {
  deliveryMode: 'incoming_webhook' | 'graph';
  incomingWebhookUrl?: string;
  graphAccessToken?: string;
  teamId?: string;
  channelId?: string;
  chatId?: string;
  homeChannel?: string;
  homeChannelName?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  allowedUsers: string[];
  allowAllUsers: boolean;
  port: number;
  enabled: boolean;
  source: 'env' | 'config' | 'none';
}

export function resolveTeamsConfig(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): ResolvedTeamsConfig {
  const cfg = config.teams;
  const envIncomingWebhookUrl = optionalTrim(env.TEAMS_INCOMING_WEBHOOK_URL);
  const envGraphAccessToken = optionalTrim(env.TEAMS_GRAPH_ACCESS_TOKEN);
  const envClientId = optionalTrim(env.TEAMS_CLIENT_ID);
  const envClientSecret = optionalTrim(env.TEAMS_CLIENT_SECRET);
  const envTenantId = optionalTrim(env.TEAMS_TENANT_ID);
  const deliveryModeRaw = optionalTrim(env.TEAMS_DELIVERY_MODE) || optionalTrim(cfg?.deliveryMode);
  const deliveryMode = deliveryModeRaw === 'graph' ? 'graph' : 'incoming_webhook';
  const incomingWebhookUrl = envIncomingWebhookUrl || optionalTrim(cfg?.incomingWebhookUrl);
  const graphAccessToken = envGraphAccessToken || optionalTrim(cfg?.graphAccessToken);
  const teamId = optionalTrim(env.TEAMS_TEAM_ID) || optionalTrim(cfg?.teamId);
  const channelId = optionalTrim(env.TEAMS_CHANNEL_ID) || optionalTrim(cfg?.channelId);
  const chatId = optionalTrim(env.TEAMS_CHAT_ID) || optionalTrim(cfg?.chatId);
  const clientId = envClientId || optionalTrim(cfg?.clientId);
  const clientSecret = envClientSecret || optionalTrim(cfg?.clientSecret);
  const tenantId = envTenantId || optionalTrim(cfg?.tenantId);
  return {
    deliveryMode,
    incomingWebhookUrl,
    graphAccessToken,
    teamId,
    channelId,
    chatId,
    homeChannel: optionalTrim(env.TEAMS_HOME_CHANNEL) || optionalTrim(cfg?.homeChannel),
    homeChannelName: optionalTrim(env.TEAMS_HOME_CHANNEL_NAME) || optionalTrim(cfg?.homeChannelName),
    clientId,
    clientSecret,
    tenantId,
    allowedUsers: env.TEAMS_ALLOWED_USERS ? parseStringList(env.TEAMS_ALLOWED_USERS) : (cfg?.allowedUsers ?? []),
    allowAllUsers: env.TEAMS_ALLOW_ALL_USERS === '1' || env.TEAMS_ALLOW_ALL_USERS === 'true' || cfg?.allowAllUsers === true,
    port: parsePositiveInt(env.TEAMS_PORT, cfg?.port ?? 3978),
    enabled: cfg?.enabled !== false,
    source:
      envIncomingWebhookUrl || envGraphAccessToken || envClientId || envClientSecret || envTenantId
        ? 'env'
        : incomingWebhookUrl || graphAccessToken || clientId || clientSecret || tenantId
          ? 'config'
          : 'none',
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
    mattermost: config.mattermost
      ? {
          ...config.mattermost,
          token: config.mattermost.token ? '<secret:MATTERMOST_TOKEN>' : undefined,
        }
      : undefined,
    homeassistant: config.homeassistant
      ? {
          ...config.homeassistant,
          token: config.homeassistant.token ? '<secret:HASS_TOKEN>' : undefined,
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
    whatsapp: config.whatsapp
      ? {
          ...config.whatsapp,
          accessToken: config.whatsapp.accessToken ? '<secret:WHATSAPP_CLOUD_ACCESS_TOKEN>' : undefined,
          appSecret: config.whatsapp.appSecret ? '<secret:WHATSAPP_CLOUD_APP_SECRET>' : undefined,
          verifyToken: config.whatsapp.verifyToken ? '<secret:WHATSAPP_CLOUD_VERIFY_TOKEN>' : undefined,
          homeChannel: redactPhoneLike(config.whatsapp.homeChannel),
          allowedUsers: config.whatsapp.allowedUsers?.map(redactPhoneLike).filter((id): id is string => Boolean(id)),
        }
      : undefined,
    matrix: config.matrix
      ? {
          ...config.matrix,
          accessToken: config.matrix.accessToken ? '<secret:MATRIX_ACCESS_TOKEN>' : undefined,
          password: config.matrix.password ? '<secret:MATRIX_PASSWORD>' : undefined,
        }
      : undefined,
    googleChat: config.googleChat
      ? {
          ...config.googleChat,
          serviceAccountJson: config.googleChat.serviceAccountJson ? '<secret:GOOGLE_CHAT_SERVICE_ACCOUNT_JSON>' : undefined,
          incomingWebhookUrl: config.googleChat.incomingWebhookUrl ? '<secret:GOOGLE_CHAT_INCOMING_WEBHOOK_URL>' : undefined,
        }
      : undefined,
    bluebubbles: config.bluebubbles
      ? {
          ...config.bluebubbles,
          password: config.bluebubbles.password ? '<secret:BLUEBUBBLES_PASSWORD>' : undefined,
        }
      : undefined,
    teams: config.teams
      ? {
          ...config.teams,
          incomingWebhookUrl: config.teams.incomingWebhookUrl ? '<secret:TEAMS_INCOMING_WEBHOOK_URL>' : undefined,
          graphAccessToken: config.teams.graphAccessToken ? '<secret:TEAMS_GRAPH_ACCESS_TOKEN>' : undefined,
          clientSecret: config.teams.clientSecret ? '<secret:TEAMS_CLIENT_SECRET>' : undefined,
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

function redactPhoneLike(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const visible = trimmed.replace(/[\s()+.-]+/g, '');
  if (visible.length <= 6) return '<redacted>';
  return `${visible.slice(0, 4)}…${visible.slice(-4)}`;
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
