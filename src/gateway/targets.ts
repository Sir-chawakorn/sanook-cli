import type { GatewayConfig } from './config.js';
import {
  resolveDiscordConfig,
  resolveEmailConfig,
  resolveLineConfig,
  resolveNtfyConfig,
  resolveSignalConfig,
  resolveSlackConfig,
  resolveSmsConfig,
  resolveTelegramConfig,
} from './config.js';
import { normalizeSignalId, redactSignalId } from './signal.js';

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
  let address: string | undefined = rawAddress?.trim();
  let thread: string | undefined = rawThread?.trim();
  if (!platform || extra.length) {
    throw new Error('target ต้องเป็น platform, platform:chat_id, หรือ platform:chat_id:thread_id');
  }
  if (platform === 'signal' && address === 'group' && thread) {
    address = `group:${thread}`;
    thread = undefined;
  }
  if (!['telegram', 'discord', 'slack', 'email', 'line', 'sms', 'ntfy', 'signal'].includes(platform)) {
    throw new Error('platform ต้องเป็น telegram, discord, slack, email, line, sms, ntfy, หรือ signal');
  }
  if (address === '' || thread === '') {
    throw new Error('target ต้องเป็น platform, platform:chat_id, หรือ platform:chat_id:thread_id');
  }
  if (thread && !['telegram', 'discord', 'slack'].includes(platform)) {
    throw new Error(`${platform} target ไม่รองรับ thread segment`);
  }
  const target: SendTarget = { platform, address, thread };
  if (platform === 'telegram') {
    if (address) target.chatId = parseNumericId(address, 'chat_id');
    if (thread) target.threadId = parseNumericId(thread, 'thread_id');
  }
  if (platform === 'signal' && address) target.address = normalizeSignalId(address);
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
  const line = resolveLineConfig(config, env);
  if (line.channelAccessToken) {
    if (line.homeChannel) {
      out.push({
        platform: 'line',
        address: line.homeChannel,
        target: 'line',
        label: `LINE home (${line.homeChannel})`,
        configured: true,
      });
    }
    for (const id of [...line.allowedUsers, ...line.allowedGroups, ...line.allowedRooms]) {
      out.push({
        platform: 'line',
        address: id,
        target: `line:${id}`,
        label: `LINE ${id}`,
        configured: true,
      });
    }
    if (!line.homeChannel && !line.allowedUsers.length && !line.allowedGroups.length && !line.allowedRooms.length) {
      out.push({
        platform: 'line',
        target: 'line',
        label: 'LINE configured but no home/allowed channel',
        configured: false,
      });
    }
  }
  const sms = resolveSmsConfig(config, env);
  if (sms.accountSid && sms.authToken && sms.phoneNumber) {
    if (sms.homeChannel) {
      out.push({
        platform: 'sms',
        address: sms.homeChannel,
        target: 'sms',
        label: `SMS ${sms.homeChannelName ?? 'home'} (${sms.homeChannel})`,
        configured: true,
      });
    }
    for (const phone of sms.allowedUsers) {
      out.push({
        platform: 'sms',
        address: phone,
        target: `sms:${phone}`,
        label: `SMS ${phone}`,
        configured: true,
      });
    }
    if (!sms.homeChannel && !sms.allowedUsers.length) {
      out.push({
        platform: 'sms',
        target: 'sms',
        label: 'SMS configured but no home/allowed phone',
        configured: false,
      });
    }
  }
  const ntfy = resolveNtfyConfig(config, env);
  if (ntfy.topic || ntfy.publishTopic || ntfy.token || ntfy.homeChannel) {
    if (ntfy.homeChannel) {
      out.push({
        platform: 'ntfy',
        address: ntfy.homeChannel,
        target: 'ntfy',
        label: `ntfy ${ntfy.homeChannelName ?? 'home'} (${ntfy.homeChannel})`,
        configured: true,
      });
    }
    const seen = new Set<string>([ntfy.homeChannel].filter((v): v is string => Boolean(v)));
    for (const topic of [ntfy.topic, ntfy.publishTopic, ...ntfy.allowedUsers].filter((v): v is string => Boolean(v?.trim()))) {
      if (seen.has(topic)) continue;
      seen.add(topic);
      out.push({
        platform: 'ntfy',
        address: topic,
        target: `ntfy:${topic}`,
        label: `ntfy topic ${topic}`,
        configured: true,
      });
    }
    if (!ntfy.homeChannel && !ntfy.topic && !ntfy.publishTopic && !ntfy.allowedUsers.length) {
      out.push({
        platform: 'ntfy',
        target: 'ntfy',
        label: 'ntfy configured but no topic/home channel',
        configured: false,
      });
    }
  }
  const signal = resolveSignalConfig(config, env);
  if (signal.account || signal.httpUrl !== 'http://127.0.0.1:8080' || signal.homeChannel || signal.allowedUsers.length || signal.groupAllowedUsers.length) {
    if (signal.homeChannel) {
      const home = normalizeSignalId(signal.homeChannel) ?? signal.homeChannel;
      out.push({
        platform: 'signal',
        address: home,
        target: 'signal',
        label: `Signal ${signal.homeChannelName ?? 'home'} (${redactSignalId(home)})`,
        configured: Boolean(signal.account),
      });
    }
    const seen = new Set<string>([normalizeSignalId(signal.homeChannel)].filter((v): v is string => Boolean(v)));
    for (const id of signal.allowedUsers.map(normalizeSignalId).filter((v): v is string => Boolean(v))) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        platform: 'signal',
        address: id,
        target: `signal:${id}`,
        label: `Signal ${redactSignalId(id)}`,
        configured: Boolean(signal.account),
      });
    }
    for (const id of signal.groupAllowedUsers) {
      const targetId = id === '*' ? '*' : (normalizeSignalId(id)?.startsWith('group:') ? normalizeSignalId(id) : `group:${id.trim()}`);
      if (!targetId || targetId === '*' || seen.has(targetId)) continue;
      seen.add(targetId);
      out.push({
        platform: 'signal',
        address: targetId,
        target: `signal:${targetId}`,
        label: `Signal group ${redactSignalId(targetId)}`,
        configured: Boolean(signal.account),
      });
    }
    if (!signal.homeChannel && !signal.allowedUsers.length && !signal.groupAllowedUsers.length) {
      out.push({
        platform: 'signal',
        target: 'signal',
        label: 'Signal configured but no home/allowed user',
        configured: false,
      });
    }
  }
  return out;
}
