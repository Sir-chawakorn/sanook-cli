import type { GatewayConfig } from './config.js';
import {
  resolveDiscordConfig,
  resolveEmailConfig,
  resolveHomeAssistantConfig,
  resolveLineConfig,
  resolveMattermostConfig,
  resolveMatrixConfig,
  resolveNtfyConfig,
  resolveSignalConfig,
  resolveSlackConfig,
  resolveSmsConfig,
  resolveTelegramConfig,
  resolveTeamsConfig,
  resolveWhatsAppConfig,
} from './config.js';
import { normalizeSignalId, redactSignalId } from './signal.js';
import { normalizeWhatsAppId, redactWhatsAppId } from './whatsapp.js';

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
  const trimmed = raw.trim();
  const firstColon = trimmed.indexOf(':');
  const rawPlatform = firstColon === -1 ? trimmed : trimmed.slice(0, firstColon);
  const platform = rawPlatform?.trim().toLowerCase();
  const remainder = firstColon === -1 ? undefined : trimmed.slice(firstColon + 1);
  let address: string | undefined;
  let thread: string | undefined;
  let extra: string[] = [];
  if (platform === 'matrix' || platform === 'teams') {
    address = remainder?.trim();
  } else if (remainder != null) {
    const parts = remainder.split(':');
    address = parts[0]?.trim();
    thread = parts[1]?.trim();
    extra = parts.slice(2);
  }
  if (!platform || extra.length) {
    throw new Error('target ต้องเป็น platform, platform:chat_id, หรือ platform:chat_id:thread_id');
  }
  if (platform === 'signal' && address === 'group' && thread) {
    address = `group:${thread}`;
    thread = undefined;
  }
  if (
    ![
      'telegram',
      'discord',
      'slack',
      'mattermost',
      'homeassistant',
      'email',
      'line',
      'sms',
      'ntfy',
      'signal',
      'whatsapp',
      'matrix',
      'teams',
    ].includes(
      platform,
    )
  ) {
    throw new Error(
      'platform ต้องเป็น telegram, discord, slack, mattermost, homeassistant, email, line, sms, ntfy, signal, whatsapp, matrix, หรือ teams',
    );
  }
  if (address === '' || thread === '') {
    throw new Error('target ต้องเป็น platform, platform:chat_id, หรือ platform:chat_id:thread_id');
  }
  if (thread && !['telegram', 'discord', 'slack', 'mattermost'].includes(platform)) {
    throw new Error(`${platform} target ไม่รองรับ thread segment`);
  }
  const target: SendTarget = { platform, address, thread };
  if (platform === 'telegram') {
    if (address) target.chatId = parseNumericId(address, 'chat_id');
    if (thread) target.threadId = parseNumericId(thread, 'thread_id');
  }
  if (platform === 'signal' && address) target.address = normalizeSignalId(address);
  if (platform === 'whatsapp' && address) {
    const waId = normalizeWhatsAppId(address);
    if (!waId) throw new Error('WhatsApp target ต้องเป็น wa_id ตัวเลขพร้อม country code เช่น whatsapp:15551234567');
    target.address = waId;
  }
  if (platform === 'matrix' && address && !/^[!#][^:\s]+:[^:\s]+(?::\d+)?$/.test(address)) {
    throw new Error('Matrix target ต้องเป็น room id/alias เช่น matrix:!abc123:matrix.org');
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
  const mattermost = resolveMattermostConfig(config, env);
  if (mattermost.serverUrl || mattermost.token || mattermost.homeChannel || mattermost.allowedChannels.length) {
    if (mattermost.homeChannel) {
      out.push({
        platform: 'mattermost',
        address: mattermost.homeChannel,
        target: 'mattermost',
        label: `Mattermost ${mattermost.homeChannelName ?? 'home'} (${mattermost.homeChannel})`,
        configured: Boolean(mattermost.serverUrl && mattermost.token),
      });
    }
    const seen = new Set<string>([mattermost.homeChannel].filter((v): v is string => Boolean(v)));
    for (const channel of mattermost.allowedChannels) {
      if (seen.has(channel)) continue;
      seen.add(channel);
      out.push({
        platform: 'mattermost',
        address: channel,
        target: `mattermost:${channel}`,
        label: `Mattermost channel ${channel}`,
        configured: Boolean(mattermost.serverUrl && mattermost.token),
      });
    }
    if (!mattermost.homeChannel && !mattermost.allowedChannels.length) {
      out.push({
        platform: 'mattermost',
        target: 'mattermost',
        label: 'Mattermost configured but no home/allowed channel',
        configured: false,
      });
    }
  }
  const homeassistant = resolveHomeAssistantConfig(config, env);
  if (homeassistant.token || homeassistant.homeChannel || homeassistant.url !== 'http://homeassistant.local:8123') {
    if (homeassistant.homeChannel) {
      out.push({
        platform: 'homeassistant',
        address: homeassistant.homeChannel,
        target: 'homeassistant',
        label: `Home Assistant ${homeassistant.homeChannelName ?? 'notification'} (${homeassistant.homeChannel})`,
        configured: Boolean(homeassistant.token),
      });
    } else {
      out.push({
        platform: 'homeassistant',
        target: 'homeassistant',
        label: 'Home Assistant configured but no home notification id',
        configured: Boolean(homeassistant.token),
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
  const whatsapp = resolveWhatsAppConfig(config, env);
  if (whatsapp.phoneNumberId || whatsapp.accessToken || whatsapp.homeChannel || whatsapp.allowedUsers.length) {
    if (whatsapp.homeChannel) {
      const home = normalizeWhatsAppId(whatsapp.homeChannel) ?? whatsapp.homeChannel;
      out.push({
        platform: 'whatsapp',
        address: home,
        target: 'whatsapp',
        label: `WhatsApp ${whatsapp.homeChannelName ?? 'home'} (${redactWhatsAppId(home)})`,
        configured: Boolean(whatsapp.phoneNumberId && whatsapp.accessToken),
      });
    }
    const seen = new Set<string>([normalizeWhatsAppId(whatsapp.homeChannel)].filter((v): v is string => Boolean(v)));
    for (const id of whatsapp.allowedUsers.map(normalizeWhatsAppId).filter((v): v is string => Boolean(v))) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        platform: 'whatsapp',
        address: id,
        target: `whatsapp:${id}`,
        label: `WhatsApp ${redactWhatsAppId(id)}`,
        configured: Boolean(whatsapp.phoneNumberId && whatsapp.accessToken),
      });
    }
    if (!whatsapp.homeChannel && !whatsapp.allowedUsers.length) {
      out.push({
        platform: 'whatsapp',
        target: 'whatsapp',
        label: 'WhatsApp configured but no home/allowed user',
        configured: false,
      });
    }
  }
  const matrix = resolveMatrixConfig(config, env);
  if (matrix.homeserver || matrix.accessToken || matrix.userId || matrix.homeRoom || matrix.allowedRooms.length) {
    if (matrix.homeRoom) {
      out.push({
        platform: 'matrix',
        address: matrix.homeRoom,
        target: 'matrix',
        label: `Matrix ${matrix.homeRoomName ?? 'home'} (${matrix.homeRoom})`,
        configured: Boolean(matrix.homeserver && (matrix.accessToken || (matrix.userId && matrix.password))),
      });
    }
    const seen = new Set<string>([matrix.homeRoom].filter((v): v is string => Boolean(v)));
    for (const room of matrix.allowedRooms) {
      if (seen.has(room)) continue;
      seen.add(room);
      out.push({
        platform: 'matrix',
        address: room,
        target: `matrix:${room}`,
        label: `Matrix room ${room}`,
        configured: Boolean(matrix.homeserver && (matrix.accessToken || (matrix.userId && matrix.password))),
      });
    }
    if (!matrix.homeRoom && !matrix.allowedRooms.length) {
      out.push({
        platform: 'matrix',
        target: 'matrix',
        label: 'Matrix configured but no home/allowed room',
        configured: false,
      });
    }
  }
  const teams = resolveTeamsConfig(config, env);
  if (
    teams.incomingWebhookUrl ||
    teams.graphAccessToken ||
    teams.chatId ||
    teams.homeChannel ||
    (teams.teamId && teams.channelId) ||
    teams.clientId
  ) {
    const configured =
      teams.deliveryMode === 'graph'
        ? Boolean(teams.graphAccessToken && (teams.chatId || teams.homeChannel || (teams.teamId && teams.channelId)))
        : Boolean(teams.incomingWebhookUrl);
    const address =
      teams.homeChannel ||
      teams.chatId ||
      (teams.teamId && teams.channelId ? `team/${teams.teamId}/channel/${teams.channelId}` : undefined);
    out.push({
      platform: 'teams',
      address,
      target: 'teams',
      label: `Microsoft Teams ${teams.homeChannelName ?? (address ? `target (${address})` : 'configured')}`,
      configured,
    });
  }
  return out;
}
