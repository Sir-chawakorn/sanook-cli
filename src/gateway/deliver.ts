import { BRAND } from '../brand.js';
import type { GatewayConfig } from './config.js';
import {
  readGatewayConfig,
  resolveDingTalkConfig,
  resolveDiscordConfig,
  resolveEmailConfig,
  resolveFeishuConfig,
  resolveGoogleChatConfig,
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
import { sendDiscordMessage } from './discord.js';
import { parseDingTalkTarget, sendDingTalkMessage } from './dingtalk.js';
import { sendEmailMessage } from './email.js';
import { sendFeishuMessage } from './feishu.js';
import { parseGoogleChatTarget, sendGoogleChatMessage } from './googlechat.js';
import { sendHomeAssistantNotification } from './homeassistant.js';
import { sendLineMessage } from './line.js';
import { sendMattermostMessage } from './mattermost.js';
import { sendMatrixMessage } from './matrix.js';
import { sendNtfyMessage } from './ntfy.js';
import { normalizeSignalId, sendSignalMessage } from './signal.js';
import { sendSlackMessage } from './slack.js';
import { normalizeSmsPhone, sendSmsMessage } from './sms.js';
import { formatTarget, parseSendTarget } from './targets.js';
import { sendTelegramMessage } from './telegram.js';
import { sendTeamsMessage } from './teams.js';
import { normalizeWhatsAppId, redactWhatsAppId, sendWhatsAppMessage } from './whatsapp.js';

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

  if (target.platform === 'mattermost') {
    const mattermost = resolveMattermostConfig(config, env);
    if (!mattermost.serverUrl || !mattermost.token) throw new Error(`ยังไม่ได้ตั้ง Mattermost — รัน: ${BRAND.cliName} gateway setup mattermost`);
    const channelId = target.address ?? mattermost.homeChannel;
    if (!channelId) throw new Error('ต้องระบุ Mattermost channel id หรือ home channel ใน gateway config');
    const allowed = new Set([mattermost.homeChannel, ...mattermost.allowedChannels].filter((v): v is string => Boolean(v?.trim())));
    if (!mattermost.allowAllUsers && !allowed.size) {
      throw new Error('ต้องตั้ง Mattermost home channel หรือ allowed channels เพื่อ fail-closed');
    }
    if (!mattermost.allowAllUsers && allowed.size && !allowed.has(channelId)) {
      throw new Error(`Mattermost channel ${channelId} ไม่อยู่ใน allowlist (${[...allowed].join(', ') || 'none'})`);
    }
    const result = await sendMattermostMessage(mattermost, channelId, text, target.thread);
    return {
      platform: 'mattermost',
      target: formatTarget({ platform: 'mattermost', address: result.channelId, thread: target.thread }),
      channelId: result.channelId,
      messageIds: result.postIds,
      messageCount: result.messageCount,
    };
  }

  if (target.platform === 'homeassistant') {
    const homeassistant = resolveHomeAssistantConfig(config, env);
    if (!homeassistant.token) throw new Error(`ยังไม่ได้ตั้ง Home Assistant — รัน: ${BRAND.cliName} gateway setup homeassistant`);
    const notificationId = target.address ?? homeassistant.homeChannel;
    const result = await sendHomeAssistantNotification(homeassistant, text, notificationId);
    return {
      platform: 'homeassistant',
      target: formatTarget({ platform: 'homeassistant', address: result.notificationId }),
      messageId: result.messageId,
      messageCount: result.messageCount,
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

  if (target.platform === 'whatsapp') {
    const whatsapp = resolveWhatsAppConfig(config, env);
    if (!whatsapp.phoneNumberId || !whatsapp.accessToken) {
      throw new Error(`ยังไม่ได้ตั้ง WhatsApp Cloud — รัน: ${BRAND.cliName} gateway setup whatsapp`);
    }
    const to = normalizeWhatsAppId(target.address ?? whatsapp.homeChannel);
    if (!to) throw new Error('ต้องระบุ WhatsApp wa_id หรือ home channel ใน gateway config');
    const allowed = new Set([whatsapp.homeChannel, ...whatsapp.allowedUsers].map(normalizeWhatsAppId).filter((v): v is string => Boolean(v)));
    if (!whatsapp.allowAllUsers && !allowed.has(to)) {
      throw new Error(`WhatsApp target ${redactWhatsAppId(to)} ไม่อยู่ใน allowlist (${[...allowed].map(redactWhatsAppId).join(', ') || 'none'})`);
    }
    const result = await sendWhatsAppMessage(whatsapp, to, text);
    return {
      platform: 'whatsapp',
      target: formatTarget({ platform: 'whatsapp', address: result.to }),
      to: result.to,
      messageIds: result.messageIds,
      messageCount: result.messageCount,
    };
  }

  if (target.platform === 'matrix') {
    const matrix = resolveMatrixConfig(config, env);
    if (!matrix.homeserver || (!matrix.accessToken && (!matrix.userId || !matrix.password))) {
      throw new Error(`ยังไม่ได้ตั้ง Matrix — รัน: ${BRAND.cliName} gateway setup matrix`);
    }
    const roomId = target.address ?? matrix.homeRoom;
    if (!roomId) throw new Error('ต้องระบุ Matrix room id หรือ home room ใน gateway config');
    const allowed = new Set([matrix.homeRoom, ...matrix.allowedRooms].filter((v): v is string => Boolean(v?.trim())));
    if (!matrix.allowAllUsers && !allowed.size) {
      throw new Error('ต้องตั้ง Matrix home room หรือ allowed rooms เพื่อ fail-closed');
    }
    if (!matrix.allowAllUsers && allowed.size && !allowed.has(roomId)) {
      throw new Error(`Matrix room ${roomId} ไม่อยู่ใน allowlist (${[...allowed].join(', ') || 'none'})`);
    }
    const result = await sendMatrixMessage(matrix, roomId, text);
    return {
      platform: 'matrix',
      target: formatTarget({ platform: 'matrix', address: result.roomId }),
      to: result.roomId,
      messageIds: result.eventIds,
      messageCount: result.messageCount,
    };
  }

  if (target.platform === 'feishu') {
    const feishu = resolveFeishuConfig(config, env);
    if (!feishu.appId || !feishu.appSecret) throw new Error(`ยังไม่ได้ตั้ง Feishu/Lark — รัน: ${BRAND.cliName} gateway setup feishu`);
    const chatId = target.address ?? feishu.homeChannel;
    if (!chatId) throw new Error('ต้องระบุ Feishu/Lark chat id หรือ home channel ใน gateway config');
    const allowed = new Set([feishu.homeChannel, ...feishu.allowedChats].filter((v): v is string => Boolean(v?.trim())));
    if (!feishu.allowAllChats && !allowed.size) {
      throw new Error('ต้องตั้ง Feishu/Lark home channel หรือ allowed chats เพื่อ fail-closed');
    }
    if (!feishu.allowAllChats && allowed.size && !allowed.has(chatId)) {
      throw new Error(`Feishu/Lark chat ${chatId} ไม่อยู่ใน allowlist (${[...allowed].join(', ') || 'none'})`);
    }
    const result = await sendFeishuMessage(feishu, chatId, text);
    return {
      platform: 'feishu',
      target: formatTarget({ platform: 'feishu', address: result.chatId }),
      to: result.chatId,
      messageIds: result.messageIds,
      messageCount: result.messageCount,
    };
  }

  if (target.platform === 'dingtalk') {
    const dingtalk = resolveDingTalkConfig(config, env);
    const parsedTarget = parseDingTalkTarget(dingtalk, target.address);
    const hasWebhook = parsedTarget.type === 'webhook' && (dingtalk.webhookUrl || /^https:\/\//i.test(target.address ?? ''));
    const hasOpenApi = dingtalk.clientId && dingtalk.clientSecret && dingtalk.robotCode;
    if (!hasWebhook && !hasOpenApi) throw new Error(`ยังไม่ได้ตั้ง DingTalk — รัน: ${BRAND.cliName} gateway setup dingtalk`);
    if (parsedTarget.type === 'user') {
      const allowedUsers = new Set(dingtalk.allowedUsers);
      if (!dingtalk.allowAllUsers && !allowedUsers.size) throw new Error('ต้องตั้ง DingTalk allowed users เพื่อ fail-closed');
      if (!dingtalk.allowAllUsers && !allowedUsers.has(parsedTarget.value)) {
        throw new Error(`DingTalk user ${parsedTarget.value} ไม่อยู่ใน allowlist (${[...allowedUsers].join(', ') || 'none'})`);
      }
    } else {
      const allowedChats = new Set(
        [dingtalk.homeChannel, dingtalk.webhookUrl, ...dingtalk.allowedChats].filter((v): v is string => Boolean(v?.trim())),
      );
      if (!dingtalk.allowAllChats && !allowedChats.size) throw new Error('ต้องตั้ง DingTalk home channel/webhook หรือ allowed chats เพื่อ fail-closed');
      if (!dingtalk.allowAllChats && !allowedChats.has(parsedTarget.value)) {
        throw new Error(`DingTalk target ${parsedTarget.type === 'webhook' ? 'webhook' : parsedTarget.value} ไม่อยู่ใน allowlist`);
      }
    }
    const result = await sendDingTalkMessage(dingtalk, text, target.address);
    return {
      platform: 'dingtalk',
      target: formatTarget({ platform: 'dingtalk', address: result.target === 'webhook' ? undefined : result.target }),
      to: result.target,
      messageIds: result.messageIds,
      messageCount: result.messageCount,
    };
  }

  if (target.platform === 'googlechat') {
    const googleChat = resolveGoogleChatConfig(config, env);
    const parsedTarget = parseGoogleChatTarget(googleChat, target.address);
    const hasWebhook = parsedTarget.type === 'webhook' && (googleChat.incomingWebhookUrl || /^https:\/\//i.test(target.address ?? ''));
    const hasChatApi = Boolean(googleChat.serviceAccountJson);
    if (!hasWebhook && !hasChatApi) throw new Error(`ยังไม่ได้ตั้ง Google Chat — รัน: ${BRAND.cliName} gateway setup googlechat`);
    if (parsedTarget.type === 'space') {
      const allowed = new Set(
        [googleChat.homeChannel, ...googleChat.allowedSpaces]
          .flatMap((id) => {
            const value = id?.trim();
            if (!value) return [];
            const space = /^spaces\/[^/\s]+/.exec(value)?.[0];
            return space && space !== value ? [value, space] : [value];
          })
          .filter(Boolean),
      );
      const targetAllowed = allowed.has(parsedTarget.value) || Boolean(parsedTarget.space && allowed.has(parsedTarget.space));
      if (!googleChat.allowAllSpaces && !allowed.size) {
        throw new Error('ต้องตั้ง Google Chat home channel หรือ allowed spaces เพื่อ fail-closed');
      }
      if (!googleChat.allowAllSpaces && allowed.size && !targetAllowed) {
        throw new Error(`Google Chat space ${parsedTarget.space ?? parsedTarget.value} ไม่อยู่ใน allowlist (${[...allowed].join(', ') || 'none'})`);
      }
    } else {
      const allowed = new Set([googleChat.incomingWebhookUrl, googleChat.homeChannel, ...googleChat.allowedSpaces].filter((v): v is string => Boolean(v?.trim())));
      if (!googleChat.allowAllSpaces && !allowed.size) throw new Error('ต้องตั้ง Google Chat webhook/home/allowed spaces เพื่อ fail-closed');
      if (!googleChat.allowAllSpaces && allowed.size && !allowed.has(parsedTarget.value)) {
        throw new Error('Google Chat webhook target ไม่อยู่ใน allowlist');
      }
    }
    const result = await sendGoogleChatMessage(googleChat, text, target.address);
    return {
      platform: 'googlechat',
      target: formatTarget({ platform: 'googlechat', address: result.target === 'webhook' ? undefined : result.target }),
      to: result.target,
      messageIds: result.messageIds,
      messageCount: result.messageCount,
    };
  }

  if (target.platform === 'teams') {
    const teams = resolveTeamsConfig(config, env);
    const graphReady = teams.graphAccessToken && (target.address || teams.chatId || teams.homeChannel || (teams.teamId && teams.channelId));
    const webhookReady = teams.incomingWebhookUrl || target.address?.startsWith('https://');
    if (!graphReady && !webhookReady) {
      throw new Error(`ยังไม่ได้ตั้ง Microsoft Teams delivery — รัน: ${BRAND.cliName} gateway setup teams`);
    }
    const result = await sendTeamsMessage(teams, text, target.address);
    return {
      platform: 'teams',
      target: formatTarget({ platform: 'teams', address: result.target === 'webhook' ? undefined : result.target }),
      to: result.target,
      messageId: result.messageId,
      messageCount: result.messageCount,
    };
  }

  throw new Error(
    `ยังไม่รองรับ platform "${target.platform}" — ตอนนี้รองรับ telegram / discord / slack / mattermost / homeassistant / email / line / sms / ntfy / signal / whatsapp / matrix / feishu / dingtalk / googlechat / teams`,
  );
}
