import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireSingleton } from './lock.js';
import { loadOrCreateToken } from './auth.js';
import { startServer } from './server.js';
import { startScheduler } from './scheduler.js';
import { appHomePath, BRAND, BRAND_ENV, envFlag } from '../brand.js';
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
  resolveWebhookConfig,
} from './config.js';

const GATEWAY_DIR = appHomePath('gateway');
const SERVE_LOCK = join(GATEWAY_DIR, 'serve.lock');

export interface GatewayOpts {
  port: number;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  tickMs?: number;
  onLog?: (msg: string) => void;
}

/**
 * จุดเดียวที่ start ทั้ง gateway: HTTP server (รับ request 24/7) + scheduler (cron tick)
 * ทั้งคู่เรียก runAgent() core เดียวกัน — "platform differences live in the entry point, not the agent"
 * single-instance: ถ้ามี gateway อื่นรันอยู่ (serve.lock) → throw (กัน 2 scheduler แย่ง task กัน)
 * คืน stop() เพื่อปิดทั้งหมด (server + scheduler + ปล่อย lock)
 */
export async function startGateway(opts: GatewayOpts): Promise<() => void> {
  const log = opts.onLog ?? ((m: string) => console.log(`[gateway] ${m}`));
  await mkdir(GATEWAY_DIR, { recursive: true });

  const release = await acquireSingleton(SERVE_LOCK);
  if (!release) {
    throw new Error(
      `มี ${BRAND.cliName} gateway รันอยู่แล้ว (เจอ serve.lock) — ปิดตัวเดิมก่อน หรือถ้าค้างให้ลบ ${appHomePath('gateway', 'serve.lock')}`,
    );
  }

  const token = await loadOrCreateToken();
  const stopServer = startServer({
    port: opts.port,
    token,
    defaultModel: opts.model,
    budgetUsd: opts.budgetUsd,
    permissionMode: opts.permissionMode ?? (envFlag(BRAND_ENV.gatewayAllowWrite) ? 'auto' : 'ask'),
    onLog: log,
  });
  const stopScheduler = startScheduler({
    defaultModel: opts.model,
    budgetUsd: opts.budgetUsd,
    permissionMode: opts.permissionMode ?? (envFlag(BRAND_ENV.gatewayAllowWrite) ? 'auto' : 'ask'),
    tickMs: opts.tickMs,
    onLog: log,
    deliver: async (task, output) => {
      if (!task.deliver) return;
      const { deliverToTarget } = await import('./deliver.js');
      const result = await deliverToTarget(task.deliver, output, { subject: `${BRAND.productName} task ${task.id}` });
      log(`delivered ${task.id} → ${result.target}`);
    },
  });

  // Telegram channel (env หรือ ~/.sanook/gateway/config.json) — long-polling, ไม่ต้อง public URL
  let stopTelegram: (() => void) | undefined;
  let stopDiscord: (() => void) | undefined;
  let stopSlack: (() => void) | undefined;
  let stopEmail: (() => void) | undefined;
  let stopNtfy: (() => void) | undefined;
  let stopSignal: (() => void) | undefined;
  const gatewayConfig = await readGatewayConfig();
  const telegram = resolveTelegramConfig(gatewayConfig);
  if (telegram.enabled && telegram.token) {
    const { startTelegram, parseAllowedChats } = await import('./telegram.js');
    stopTelegram = startTelegram({
      token: telegram.token,
      model: opts.model,
      budgetUsd: opts.budgetUsd,
      allowedChatIds: process.env.TELEGRAM_ALLOWED_CHATS ? parseAllowedChats(process.env.TELEGRAM_ALLOWED_CHATS) : telegram.allowedChatIds,
      allowWrite: telegram.allowWrite,
      onLog: log,
    });
    // หมายเหตุ: log "เริ่มแล้ว" อยู่ใน startTelegram (success path) — ถ้า fail-closed จะ log "ไม่เริ่ม" แทน
  }

  const discord = resolveDiscordConfig(gatewayConfig);
  if (discord.enabled && discord.token) {
    const { startDiscord } = await import('./discord.js');
    try {
      stopDiscord = startDiscord({
        token: discord.token,
        model: opts.model,
        budgetUsd: opts.budgetUsd,
        allowedChannelIds: discord.allowedChannelIds,
        defaultChannelId: discord.defaultChannelId,
        allowWrite: discord.allowWrite,
        onLog: log,
      });
    } catch (e) {
      log(`Discord ไม่เริ่ม: ${(e as Error).message}`);
    }
  }

  const slack = resolveSlackConfig(gatewayConfig);
  if (slack.enabled && slack.botToken) {
    if (!slack.appToken) {
      log('Slack ไม่เริ่ม: ต้องตั้ง SLACK_APP_TOKEN หรือ gateway setup slack --app-token สำหรับ Socket Mode');
    } else {
      const { startSlack } = await import('./slack.js');
      try {
        stopSlack = await startSlack({
          botToken: slack.botToken,
          appToken: slack.appToken,
          model: opts.model,
          budgetUsd: opts.budgetUsd,
          allowedChannelIds: slack.allowedChannelIds,
          defaultChannelId: slack.defaultChannelId,
          allowWrite: slack.allowWrite,
          onLog: log,
        });
      } catch (e) {
        log(`Slack ไม่เริ่ม: ${(e as Error).message}`);
      }
    }
  }

  const email = resolveEmailConfig(gatewayConfig);
  if (email.enabled && email.address) {
    if (!email.password || !email.imapHost || !email.smtpHost) {
      log('Email ไม่เริ่ม: ต้องตั้ง password, imapHost และ smtpHost ให้ครบ');
    } else {
      const { startEmail } = await import('./email.js');
      stopEmail = startEmail({
        address: email.address,
        password: email.password,
        imapHost: email.imapHost,
        imapPort: email.imapPort,
        smtpHost: email.smtpHost,
        smtpPort: email.smtpPort,
        homeAddress: email.homeAddress,
        allowedUsers: email.allowedUsers,
        allowAllUsers: email.allowAllUsers,
        pollIntervalSeconds: email.pollIntervalSeconds,
        model: opts.model,
        budgetUsd: opts.budgetUsd,
        allowWrite: false,
        onLog: log,
      });
    }
  }

  const line = resolveLineConfig(gatewayConfig);
  if (line.enabled && line.channelAccessToken) {
    if (!line.channelSecret) {
      log('LINE webhook ไม่เริ่ม: ต้องตั้ง LINE_CHANNEL_SECRET หรือ gateway setup line --channel-secret');
    } else if (!line.homeChannel && !line.allowedUsers.length && !line.allowedGroups.length && !line.allowedRooms.length && !line.allowAllUsers) {
      log('LINE webhook ไม่เริ่ม: ต้องตั้ง home channel หรือ allowlist เพื่อ fail-closed');
    } else {
      const publicBase = line.publicUrl ? `${line.publicUrl.replace(/\/+$/, '')}/line/webhook` : `http://127.0.0.1:${opts.port}/line/webhook`;
      log(`LINE: webhook ready at ${publicBase}`);
    }
  }

  const sms = resolveSmsConfig(gatewayConfig);
  if (sms.enabled && (sms.accountSid || sms.authToken || sms.phoneNumber)) {
    if (!sms.accountSid || !sms.authToken || !sms.phoneNumber) {
      log('SMS webhook ไม่เริ่ม: ต้องตั้ง TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN และ TWILIO_PHONE_NUMBER ให้ครบ');
    } else if (!sms.insecureNoSignature && !sms.webhookUrl) {
      log('SMS webhook ไม่เริ่ม: ต้องตั้ง SMS_WEBHOOK_URL ให้ตรงกับ Twilio Console เพื่อ verify signature');
    } else if (!sms.homeChannel && !sms.allowedUsers.length && !sms.allowAllUsers) {
      log('SMS webhook ไม่เริ่ม: ต้องตั้ง home channel หรือ allowlist เพื่อ fail-closed');
    } else {
      const publicBase = sms.webhookUrl || `http://127.0.0.1:${opts.port}/sms/webhook`;
      log(`SMS: Twilio webhook ready at ${publicBase}`);
    }
  }

  const ntfy = resolveNtfyConfig(gatewayConfig);
  if (ntfy.enabled && (ntfy.topic || ntfy.publishTopic || ntfy.homeChannel || ntfy.token)) {
    if (!ntfy.topic) {
      log('ntfy ไม่เริ่ม: ต้องตั้ง NTFY_TOPIC หรือ gateway setup ntfy --topic สำหรับ inbound subscribe');
    } else if (!ntfy.allowAllUsers && ![ntfy.topic, ntfy.homeChannel, ...ntfy.allowedUsers].filter(Boolean).includes(ntfy.topic)) {
      log('ntfy ไม่เริ่ม: ต้องตั้ง NTFY_ALLOWED_USERS ให้รวม topic หรือระบุ --allow-all-users เพื่อ fail-closed');
    } else {
      const { startNtfy } = await import('./ntfy.js');
      stopNtfy = startNtfy({
        config: ntfy,
        model: opts.model,
        budgetUsd: opts.budgetUsd,
        permissionMode: opts.permissionMode ?? (envFlag(BRAND_ENV.gatewayAllowWrite) ? 'auto' : 'ask'),
        onLog: log,
      });
    }
  }

  const signal = resolveSignalConfig(gatewayConfig);
  if (signal.enabled && (signal.account || signal.homeChannel || signal.allowedUsers.length || signal.groupAllowedUsers.length)) {
    if (!signal.account) {
      log('Signal ไม่เริ่ม: ต้องตั้ง SIGNAL_ACCOUNT หรือ gateway setup signal --account <+E.164>');
    } else if (!signal.allowAllUsers && !signal.homeChannel && !signal.allowedUsers.length && !signal.groupAllowedUsers.length) {
      log('Signal ไม่เริ่ม: ต้องตั้ง home channel หรือ allowlist เพื่อ fail-closed');
    } else {
      const { startSignal } = await import('./signal.js');
      stopSignal = startSignal({
        config: signal,
        model: opts.model,
        budgetUsd: opts.budgetUsd,
        permissionMode: opts.permissionMode ?? (envFlag(BRAND_ENV.gatewayAllowWrite) ? 'auto' : 'ask'),
        onLog: log,
      });
    }
  }

  const webhooks = resolveWebhookConfig(gatewayConfig);
  if (webhooks.enabled) {
    const routes = Object.keys(webhooks.routes);
    if (!routes.length) {
      log('Webhooks เปิดอยู่ แต่ยังไม่มี route — เพิ่มด้วย sanook webhook subscribe <name>');
    } else {
      const base = webhooks.publicUrl ? `${webhooks.publicUrl.replace(/\/+$/, '')}/webhooks` : `http://127.0.0.1:${opts.port}/webhooks`;
      log(`Webhooks: ${routes.length} route(s) ready at ${base}/<route>`);
    }
  }

  log(`scheduler tick ทุก ${(opts.tickMs ?? 60_000) / 1000}s · token: ${appHomePath('gateway', 'token')} (chmod 600)`);

  return () => {
    stopServer();
    stopScheduler();
    stopTelegram?.();
    stopDiscord?.();
    stopSlack?.();
    stopEmail?.();
    stopNtfy?.();
    stopSignal?.();
    release(); // ปล่อย single-instance lock (sync — ทันก่อน process.exit ตัด event loop)
  };
}
