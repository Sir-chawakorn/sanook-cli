import type { GatewayConfig } from './config.js';
import { resolveDiscordConfig, resolveEmailConfig, resolveSlackConfig, resolveTelegramConfig } from './config.js';

export interface SendTarget {
  platform: string;
  address?: string;
  thread?: string;
  chatId?: number;
  threadId?: number;
}

export interface DirectoryTarget extends SendTarget {
  target: string;
  label: string;
  configured: boolean;
}

export function parseNumericId(raw: string, label: string): number {
  if (!/^-?\d+$/.test(raw)) throw new Error(`${label} ต้องเป็น integer`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new Error(`${label} ใหญ่เกินไป`);
  return n;
}

export function parseSendTarget(raw: string): SendTarget {
  const [rawPlatform, rawAddress, rawThread, ...extra] = raw.trim().split(':');
  const platform = rawPlatform?.trim().toLowerCase();
  const address = rawAddress?.trim();
  const thread = rawThread?.trim();
  if (!platform || extra.length) {
    throw new Error('target ต้องเป็น platform, platform:chat_id, หรือ platform:chat_id:thread_id');
  }
  if (!['telegram', 'discord', 'slack', 'email'].includes(platform)) {
    throw new Error('platform ต้องเป็น telegram, discord, slack, หรือ email');
  }
  if (address === '' || thread === '') {
    throw new Error('target ต้องเป็น platform, platform:chat_id, หรือ platform:chat_id:thread_id');
  }
  const target: SendTarget = { platform, address, thread };
  if (platform === 'telegram') {
    if (address) target.chatId = parseNumericId(address, 'chat_id');
    if (thread) target.threadId = parseNumericId(thread, 'thread_id');
  }
  return target;
}

export function formatTarget(target: SendTarget): string {
  const address = target.address ?? (target.chatId == null ? undefined : String(target.chatId));
  const thread = target.thread ?? (target.threadId == null ? undefined : String(target.threadId));
  return `${target.platform}${address == null ? '' : `:${address}`}${thread == null ? '' : `:${thread}`}`;
}

export function listConfiguredTargets(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv = process.env,
): DirectoryTarget[] {
  const out: DirectoryTarget[] = [];
  const telegram = resolveTelegramConfig(config, env);
  if (telegram.token) {
    const chats = telegram.allowedChatIds;
    if (chats.length) {
      out.push({
        platform: 'telegram',
        chatId: chats[0],
        target: 'telegram',
        label: `Telegram home (${chats[0]})`,
        configured: true,
      });
      for (const chatId of chats) {
        out.push({
          platform: 'telegram',
          chatId,
          target: `telegram:${chatId}`,
          label: `Telegram chat ${chatId}`,
          configured: true,
        });
      }
    } else {
      out.push({
        platform: 'telegram',
        target: 'telegram',
        label: 'Telegram configured but no allowed chat (fail-closed)',
        configured: false,
      });
    }
  }
  const discord = resolveDiscordConfig(config, env);
  if (discord.token) {
    if (discord.defaultChannelId) {
      out.push({
        platform: 'discord',
        address: discord.defaultChannelId,
        target: 'discord',
        label: `Discord home (${discord.defaultChannelId})`,
        configured: true,
      });
    }
    for (const channelId of discord.allowedChannelIds) {
      out.push({
        platform: 'discord',
        address: channelId,
        target: `discord:${channelId}`,
        label: `Discord channel ${channelId}`,
        configured: true,
      });
    }
    if (!discord.defaultChannelId && !discord.allowedChannelIds.length) {
      out.push({
        platform: 'discord',
        target: 'discord',
        label: 'Discord configured but no default/allowed channel',
        configured: false,
      });
    }
  }
  const slack = resolveSlackConfig(config, env);
  if (slack.botToken) {
    if (slack.defaultChannelId) {
      out.push({
        platform: 'slack',
        address: slack.defaultChannelId,
        target: 'slack',
        label: `Slack home (${slack.defaultChannelId})`,
        configured: true,
      });
    }
    for (const channelId of slack.allowedChannelIds) {
      out.push({
        platform: 'slack',
        address: channelId,
        target: `slack:${channelId}`,
        label: `Slack channel ${channelId}`,
        configured: true,
      });
    }
    if (!slack.defaultChannelId && !slack.allowedChannelIds.length) {
      out.push({
        platform: 'slack',
        target: 'slack',
        label: 'Slack configured but no default/allowed channel',
        configured: false,
      });
    }
  }
  const email = resolveEmailConfig(config, env);
  if (email.address && email.smtpHost && email.password) {
    if (email.homeAddress) {
      out.push({
        platform: 'email',
        address: email.homeAddress,
        target: 'email',
        label: `Email home (${email.homeAddress})`,
        configured: true,
      });
    }
    for (const address of email.allowedUsers) {
      out.push({
        platform: 'email',
        address,
        target: `email:${address}`,
        label: `Email ${address}`,
        configured: true,
      });
    }
    if (!email.homeAddress && !email.allowedUsers.length) {
      out.push({
        platform: 'email',
        target: 'email',
        label: 'Email configured but no home/allowed address',
        configured: false,
      });
    }
  }
  return out;
}
