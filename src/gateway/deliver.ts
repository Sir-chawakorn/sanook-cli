import { BRAND } from '../brand.js';
import type { GatewayConfig } from './config.js';
import {
  readGatewayConfig,
  resolveDiscordConfig,
  resolveEmailConfig,
  resolveLineConfig,
  resolveNtfyConfig,
  resolveSignalConfig,
  resolveSlackConfig,
  resolveSmsConfig,
  resolveTelegramConfig,
} from './config.js';
import { sendDiscordMessage } from './discord.js';
import { sendEmailMessage } from './email.js';
import { sendLineMessage } from './line.js';
import { sendNtfyMessage } from './ntfy.js';
import { normalizeSignalId, sendSignalMessage } from './signal.js';
import { sendSlackMessage } from './slack.js';
import { normalizeSmsPhone, sendSmsMessage } from './sms.js';
import { formatTarget, parseSendTarget } from './targets.js';
import { sendTelegramMessage } from './telegram.js';

export interface DeliverOptions {
  config?: GatewayConfig;
  env?: NodeJS.ProcessEnv;
  subject?: string;
}

export interface DeliverResult {
  platform: string;
  target: string;
  chatId?: number;
  channelId?: string;
  messageId?: number | string;
  messageIds?: string[];
  messageTs?: string;
  to?: string;
  topic?: string;
  messageCount?: number;
}

function deliveryText(message: string): string {
  const trimmed = message.trim();
  return trimmed || '(ไม่มีผลลัพธ์)';
}

export async function deliverToTarget(rawTarget: string, message: string, options: DeliverOptions = {}): Promise<DeliverResult> {
  const target = parseSendTarget(rawTarget);
  const config = options.config ?? (await readGatewayConfig());
  const env = options.env ?? process.env;
  const text = deliveryText(message);

  if (target.platform === 'telegram') {
    const telegram = resolveTelegramConfig(config, env);
    if (!telegram.token) throw new Error(`ยังไม่ได้ตั้ง Telegram — รัน: ${BRAND.cliName} gateway setup telegram`);
    const chatId = target.chatId ?? telegram.allowedChatIds[0];
    if (!Number.isInteger(chatId)) throw new Error('ต้องระบุ chat id หรือมี allowed chat อย่างน้อย 1 ค่าใน gateway config');
    if (telegram.allowedChatIds.length && !telegram.allowedChatIds.includes(chatId)) {
      throw new Error(`chat ${chatId} ไม่อยู่ใน allowlist (${telegram.allowedChatIds.join(', ')})`);
    }
    const result = await sendTelegramMessage(telegram.token, chatId, text, target.threadId);
    return {
      platform: 'telegram',
      target: formatTarget({ platform: 'telegram', chatId, threadId: target.threadId }),
      ...result,
    };
  }

  if (target.platform === 'discord') {
    const discord = resolveDiscordConfig(config, env);
    if (!discord.token) throw new Error(`ยังไม่ได้ตั้ง Discord — รัน: ${BRAND.cliName} gateway setup discord`);
    const channelId = target.thread ?? target.address ?? discord.defaultChannelId;
    if (!channelId) throw new Error('ต้องระบุ Discord channel id หรือ default channel ใน gateway config');
    const baseChannel = target.address ?? channelId;
    if (discord.allowedChannelIds.length && !discord.allowedChannelIds.includes(baseChannel) && !discord.allowedChannelIds.includes(channelId)) {
      throw new Error(`channel ${baseChannel} ไม่อยู่ใน allowlist (${discord.allowedChannelIds.join(', ')})`);
    }
    const result = await sendDiscordMessage(discord.token, channelId, text);
    return {
      platform: 'discord',
      target: formatTarget({ platform: 'discord', address: target.address ?? channelId, thread: target.thread }),
      ...result,
    };
  }

  if (target.platform === 'slack') {
    const slack = resolveSlackConfig(config, env);
    if (!slack.botToken) throw new Error(`ยังไม่ได้ตั้ง Slack — รัน: ${BRAND.cliName} gateway setup slack`);
    const channelId = target.address ?? slack.defaultChannelId;
    if (!channelId) throw new Error('ต้องระบุ Slack channel id หรือ default channel ใน gateway config');
    if (slack.allowedChannelIds.length && !slack.allowedChannelIds.includes(channelId)) {
      throw new Error(`channel ${channelId} ไม่อยู่ใน allowlist (${slack.allowedChannelIds.join(', ')})`);
    }
    const result = await sendSlackMessage(slack.botToken, channelId, text, target.thread);
    return {
      platform: 'slack',
      target: formatTarget({ platform: 'slack', address: channelId, thread: target.thread }),
      ...result,
    };
  }

  if (target.platform === 'email') {
    const email = resolveEmailConfig(config, env);
    if (!email.address || !email.password || !email.smtpHost) {
      throw new Error(`ยังไม่ได้ตั้ง Email — รัน: ${BRAND.cliName} gateway setup email`);
    }
    const toAddress = target.address ?? email.homeAddress;
    if (!toAddress) throw new Error('ต้องระบุ email recipient หรือ home address ใน gateway config');
    const lower = toAddress.toLowerCase();
    if (!email.allowAllUsers && email.allowedUsers.length && !email.allowedUsers.includes(lower)) {
      throw new Error(`email ${toAddress} ไม่อยู่ใน allowlist (${email.allowedUsers.join(', ')})`);
    }
    const result = await sendEmailMessage(
      { address: email.address, password: email.password, smtpHost: email.smtpHost, smtpPort: email.smtpPort, fromName: BRAND.productName },
      toAddress,
      text,
      { subject: options.subject?.trim() || BRAND.productName },
    );
    return {
      platform: 'email',
      target: formatTarget({ platform: 'email', address: result.to }),
      ...result,
    };
  }

  if (target.platform === 'line') {
    const line = resolveLineConfig(config, env);
    if (!line.channelAccessToken) throw new Error(`ยังไม่ได้ตั้ง LINE — รัน: ${BRAND.cliName} gateway setup line`);
    const to = target.address ?? line.homeChannel;
    if (!to) throw new Error('ต้องระบุ LINE user/group/room id หรือ home channel ใน gateway config');
    const allowed = new Set([line.homeChannel, ...line.allowedUsers, ...line.allowedGroups, ...line.allowedRooms].filter(Boolean));
    if (!line.allowAllUsers && !allowed.has(to)) {
      throw new Error(`LINE target ${to} ไม่อยู่ใน allowlist (${[...allowed].join(', ') || 'none'})`);
    }
    const result = await sendLineMessage(line.channelAccessToken, to, text);
    return {
      platform: 'line',
      target: formatTarget({ platform: 'line', address: result.to }),
      ...result,
    };
  }

  if (target.platform === 'sms') {
    const sms = resolveSmsConfig(config, env);
    if (!sms.accountSid || !sms.authToken || !sms.phoneNumber) throw new Error(`ยังไม่ได้ตั้ง SMS — รัน: ${BRAND.cliName} gateway setup sms`);
    const to = normalizeSmsPhone(target.address ?? sms.homeChannel);
    if (!to) throw new Error('ต้องระบุ SMS phone number หรือ home channel ใน gateway config');
    const allowed = new Set([sms.homeChannel, ...sms.allowedUsers].map(normalizeSmsPhone).filter(Boolean));
    if (!sms.allowAllUsers && !allowed.has(to)) {
      throw new Error(`SMS target ${to} ไม่อยู่ใน allowlist (${[...allowed].join(', ') || 'none'})`);
    }
    const result = await sendSmsMessage({ accountSid: sms.accountSid, authToken: sms.authToken, phoneNumber: sms.phoneNumber }, to, text);
    return {
      platform: 'sms',
      target: formatTarget({ platform: 'sms', address: result.to }),
      ...result,
    };
  }

  if (target.platform === 'ntfy') {
    const ntfy = resolveNtfyConfig(config, env);
    const topic = target.address ?? ntfy.homeChannel ?? ntfy.publishTopic ?? ntfy.topic;
    if (!topic) throw new Error(`ยังไม่ได้ตั้ง ntfy topic — รัน: ${BRAND.cliName} gateway setup ntfy --topic <topic>`);
    const allowed = new Set([ntfy.topic, ntfy.homeChannel, ntfy.publishTopic, ...ntfy.allowedUsers].filter((v): v is string => Boolean(v?.trim())));
    if (!ntfy.allowAllUsers && !allowed.has(topic)) {
      throw new Error(`ntfy topic ${topic} ไม่อยู่ใน allowlist (${[...allowed].join(', ') || 'none'})`);
    }
    const result = await sendNtfyMessage(ntfy, topic, text, { title: options.subject?.trim() || BRAND.productName });
    return {
      platform: 'ntfy',
      target: formatTarget({ platform: 'ntfy', address: result.topic }),
      topic: result.topic,
      messageId: result.messageId,
      messageCount: result.messageCount,
    };
  }

  if (target.platform === 'signal') {
    const signal = resolveSignalConfig(config, env);
    if (!signal.account) throw new Error(`ยังไม่ได้ตั้ง Signal — รัน: ${BRAND.cliName} gateway setup signal`);
    const to = normalizeSignalId(target.address ?? signal.homeChannel);
    if (!to) throw new Error('ต้องระบุ Signal recipient/group หรือ home channel ใน gateway config');
    const allowedUsers = new Set([signal.homeChannel, ...signal.allowedUsers].map(normalizeSignalId).filter((v): v is string => Boolean(v)));
    const allowedGroups = new Set(
      signal.groupAllowedUsers
        .map((id) => (id.trim() === '*' ? '*' : normalizeSignalId(id)?.replace(/^group:/, '') ?? id.trim()))
        .filter(Boolean),
    );
    const isGroup = to.startsWith('group:');
    const groupId = isGroup ? to.slice('group:'.length) : undefined;
    const allowed =
      isGroup && groupId
        ? allowedGroups.has('*') || allowedGroups.has(groupId) || allowedGroups.has(`group:${groupId}`)
        : signal.allowAllUsers || allowedUsers.has(to);
    if (!allowed) {
      const allowedList = isGroup ? [...allowedGroups].join(', ') : [...allowedUsers].join(', ');
      throw new Error(`Signal target ${to} ไม่อยู่ใน allowlist (${allowedList || 'none'})`);
    }
    const result = await sendSignalMessage(signal, to, text);
    return {
      platform: 'signal',
      target: formatTarget({ platform: 'signal', address: result.to }),
      to: result.to,
      messageIds: result.messageIds,
      messageCount: result.messageCount,
    };
  }

  throw new Error(`ยังไม่รองรับ platform "${target.platform}" — ตอนนี้รองรับ telegram / discord / slack / email / line / sms / ntfy / signal`);
}
