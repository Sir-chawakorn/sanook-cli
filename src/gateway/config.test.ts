import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'sanook-gateway-config-'));
type GatewayConfigModule = typeof import('./config.js');

describe('gateway config', () => {
  let C: GatewayConfigModule;

  beforeAll(async () => {
    vi.stubEnv('HOME', TMP);
    C = await import('./config.js');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('persists telegram setup under ~/.sanook/gateway/config.json', async () => {
    await C.patchGatewayConfig({
      telegram: {
        enabled: true,
        botToken: '123:abc',
        allowedChatIds: [111, 222],
        allowWrite: false,
      },
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.telegram?.botToken).toBe('123:abc');
    expect(cfg.telegram?.allowedChatIds).toEqual([111, 222]);
    expect(await readFile(C.gatewayConfigPath(), 'utf8')).toContain('"telegram"');
    expect(C.redactGatewayConfig(cfg).telegram?.botToken).toBe('<secret:TELEGRAM_BOT_TOKEN>');
  });

  it('env telegram settings override persisted token and allowlist', () => {
    const resolved = C.resolveTelegramConfig(
      {
        telegram: {
          botToken: 'config-token',
          allowedChatIds: [1],
          allowWrite: false,
        },
      },
      {
        TELEGRAM_BOT_TOKEN: 'env-token',
        TELEGRAM_ALLOWED_CHATS: '7, 8',
        TELEGRAM_ALLOW_WRITE: '1',
      } as NodeJS.ProcessEnv,
    );

    expect(resolved).toMatchObject({
      token: 'env-token',
      allowedChatIds: [7, 8],
      allowWrite: true,
      source: 'env',
    });
  });

  it('persists and redacts Discord, Slack, Email, LINE, SMS, ntfy, Signal, and Webhooks gateway config', async () => {
    await C.patchGatewayConfig({
      discord: {
        enabled: true,
        botToken: 'discord-token',
        defaultChannelId: '111111111111111111',
        allowedChannelIds: ['111111111111111111', '222222222222222222'],
      },
      slack: {
        enabled: true,
        botToken: 'xoxb-token',
        appToken: 'xapp-token',
        defaultChannelId: 'C01ABC',
        allowedChannelIds: ['C01ABC'],
      },
      email: {
        enabled: true,
        address: 'bot@example.com',
        password: 'email-password',
        imapHost: 'imap.example.com',
        smtpHost: 'smtp.example.com',
        homeAddress: 'owner@example.com',
        allowedUsers: ['OWNER@EXAMPLE.COM'],
      },
      line: {
        enabled: true,
        channelAccessToken: 'line-token',
        channelSecret: 'line-secret',
        homeChannel: 'U1234567890abcdef',
        allowedUsers: ['U1234567890abcdef'],
        allowedGroups: ['C1234567890abcdef'],
        allowedRooms: ['R1234567890abcdef'],
      },
      sms: {
        enabled: true,
        accountSid: 'AC123',
        authToken: 'twilio-token',
        phoneNumber: '+15551234567',
        homeChannel: '+15557654321',
        allowedUsers: [' +15557654321 '],
      },
      ntfy: {
        enabled: true,
        serverUrl: 'https://ntfy.example.com/',
        topic: 'sanook-topic',
        publishTopic: 'sanook-replies',
        token: 'ntfy-token',
        homeChannel: 'sanook-topic',
        homeChannelName: 'Owner phone',
        allowedUsers: [' sanook-topic '],
        markdown: true,
      },
      signal: {
        enabled: true,
        httpUrl: 'http://127.0.0.1:8080/',
        account: '+15550000000',
        homeChannel: '+15557654321',
        homeChannelName: 'Owner Signal',
        allowedUsers: [' +1 (555) 765-4321 '],
        groupAllowedUsers: [' group:abcd1234 '],
        requireMention: true,
      },
      webhooks: {
        enabled: true,
        secret: 'global-webhook-secret',
        publicUrl: 'https://hooks.example.com',
        routes: {
          issues: {
            events: [' issues ', 'push'],
            secret: 'route-secret',
            prompt: 'Issue: {issue.title}',
            deliver: 'telegram:111',
            deliverOnly: true,
          },
        },
      },
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.discord?.defaultChannelId).toBe('111111111111111111');
    expect(cfg.slack?.defaultChannelId).toBe('C01ABC');
    expect(cfg.email?.allowedUsers).toEqual(['owner@example.com']);
    expect(cfg.line?.allowedUsers).toEqual(['U1234567890abcdef']);
    expect(cfg.sms?.allowedUsers).toEqual(['+15557654321']);
    expect(cfg.ntfy?.allowedUsers).toEqual(['sanook-topic']);
    expect(cfg.ntfy?.markdown).toBe(true);
    expect(cfg.signal?.account).toBe('+15550000000');
    expect(cfg.signal?.allowedUsers).toEqual(['+1 (555) 765-4321']);
    expect(cfg.signal?.groupAllowedUsers).toEqual(['group:abcd1234']);
    expect(cfg.webhooks?.routes?.issues.events).toEqual(['issues', 'push']);
    expect(C.redactGatewayConfig(cfg).discord?.botToken).toBe('<secret:DISCORD_BOT_TOKEN>');
    expect(C.redactGatewayConfig(cfg).slack?.botToken).toBe('<secret:SLACK_BOT_TOKEN>');
    expect(C.redactGatewayConfig(cfg).slack?.appToken).toBe('<secret:SLACK_APP_TOKEN>');
    expect(C.redactGatewayConfig(cfg).email?.password).toBe('<secret:EMAIL_PASSWORD>');
    expect(C.redactGatewayConfig(cfg).line?.channelAccessToken).toBe('<secret:LINE_CHANNEL_ACCESS_TOKEN>');
    expect(C.redactGatewayConfig(cfg).line?.channelSecret).toBe('<secret:LINE_CHANNEL_SECRET>');
    expect(C.redactGatewayConfig(cfg).sms?.authToken).toBe('<secret:TWILIO_AUTH_TOKEN>');
    expect(C.redactGatewayConfig(cfg).ntfy?.token).toBe('<secret:NTFY_TOKEN>');
    expect(C.redactGatewayConfig(cfg).signal?.account).toBe('+155…0000');
    expect(C.redactGatewayConfig(cfg).signal?.homeChannel).toBe('+155…4321');
    expect(C.redactGatewayConfig(cfg).webhooks?.secret).toBe('<secret:WEBHOOK_SECRET>');
    expect(C.redactGatewayConfig(cfg).webhooks?.routes?.issues.secret).toBe('<secret:WEBHOOK_ROUTE_SECRET>');
  });

  it('env Discord, Slack, Email, LINE, SMS, ntfy, Signal, and Webhooks settings override persisted messaging config', () => {
    const cfg = {
      discord: {
        botToken: 'config-discord',
        defaultChannelId: 'old-discord',
        allowedChannelIds: ['old-discord'],
      },
      slack: {
        botToken: 'config-slack',
        appToken: 'config-app',
        defaultChannelId: 'old-slack',
        allowedChannelIds: ['old-slack'],
      },
      email: {
        address: 'config@example.com',
        password: 'config-password',
        smtpHost: 'old-smtp',
        imapHost: 'old-imap',
        homeAddress: 'old@example.com',
        allowedUsers: ['old@example.com'],
      },
      line: {
        channelAccessToken: 'config-line',
        channelSecret: 'config-secret',
        homeChannel: 'Uold',
        allowedUsers: ['Uold'],
        allowedGroups: ['Cold'],
        allowedRooms: ['Rold'],
      },
      sms: {
        accountSid: 'ACold',
        authToken: 'config-twilio-token',
        phoneNumber: '+15550000000',
        homeChannel: '+15551111111',
        allowedUsers: ['+15551111111'],
      },
      ntfy: {
        serverUrl: 'https://old-ntfy.example.com',
        topic: 'old-topic',
        publishTopic: 'old-replies',
        token: 'config-ntfy-token',
        homeChannel: 'old-topic',
        allowedUsers: ['old-topic'],
      },
      signal: {
        httpUrl: 'http://127.0.0.1:8080',
        account: '+15550000000',
        homeChannel: '+15551111111',
        allowedUsers: ['+15551111111'],
        groupAllowedUsers: ['group:oldgroup'],
      },
      webhooks: {
        enabled: true,
        secret: 'config-webhook-secret',
        publicUrl: 'https://old-hooks.example.com',
        routes: {
          issues: {
            events: ['issues'],
            secret: 'route-secret',
            deliver: 'log',
          },
        },
      },
    };

    expect(
      C.resolveDiscordConfig(cfg, {
        DISCORD_BOT_TOKEN: 'env-discord',
        DISCORD_DEFAULT_CHANNEL: 'new-discord',
        DISCORD_ALLOWED_CHANNELS: 'new-discord,other-discord',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      token: 'env-discord',
      defaultChannelId: 'new-discord',
      allowedChannelIds: ['new-discord', 'other-discord'],
      source: 'env',
    });

    expect(
      C.resolveSlackConfig(cfg, {
        SLACK_BOT_TOKEN: 'env-slack',
        SLACK_APP_TOKEN: 'env-app',
        SLACK_DEFAULT_CHANNEL: 'new-slack',
        SLACK_ALLOWED_CHANNELS: 'new-slack,other-slack',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      botToken: 'env-slack',
      appToken: 'env-app',
      defaultChannelId: 'new-slack',
      allowedChannelIds: ['new-slack', 'other-slack'],
      source: 'env',
    });

    expect(
      C.resolveEmailConfig(cfg, {
        EMAIL_ADDRESS: 'bot@example.com',
        EMAIL_PASSWORD: 'email-password',
        EMAIL_SMTP_HOST: 'smtp.example.com',
        EMAIL_IMAP_HOST: 'imap.example.com',
        EMAIL_HOME_ADDRESS: 'owner@example.com',
        EMAIL_ALLOWED_USERS: 'owner@example.com, teammate@example.com',
        EMAIL_SMTP_PORT: '465',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      address: 'bot@example.com',
      password: 'email-password',
      smtpHost: 'smtp.example.com',
      imapHost: 'imap.example.com',
      homeAddress: 'owner@example.com',
      allowedUsers: ['owner@example.com', 'teammate@example.com'],
      smtpPort: 465,
      source: 'env',
    });

    expect(
      C.resolveLineConfig(cfg, {
        LINE_CHANNEL_ACCESS_TOKEN: 'env-line',
        LINE_CHANNEL_SECRET: 'env-secret',
        LINE_HOME_CHANNEL: 'Unew',
        LINE_ALLOWED_USERS: 'Unew,Uother',
        LINE_ALLOWED_GROUPS: 'Cnew',
        LINE_ALLOWED_ROOMS: 'Rnew',
        LINE_ALLOW_ALL_USERS: 'true',
        LINE_PUBLIC_URL: 'https://line.example.com',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      channelAccessToken: 'env-line',
      channelSecret: 'env-secret',
      homeChannel: 'Unew',
      allowedUsers: ['Unew', 'Uother'],
      allowedGroups: ['Cnew'],
      allowedRooms: ['Rnew'],
      allowAllUsers: true,
      publicUrl: 'https://line.example.com',
      source: 'env',
    });

    expect(
      C.resolveSmsConfig(cfg, {
        TWILIO_ACCOUNT_SID: 'ACnew',
        TWILIO_AUTH_TOKEN: 'env-twilio-token',
        TWILIO_PHONE_NUMBER: '+15552222222',
        SMS_HOME_CHANNEL: '+15553333333',
        SMS_HOME_CHANNEL_NAME: 'Owner phone',
        SMS_ALLOWED_USERS: '+15553333333,+15554444444',
        SMS_ALLOW_ALL_USERS: 'true',
        SMS_WEBHOOK_URL: 'https://sms.example.com/webhook',
        SMS_INSECURE_NO_SIGNATURE: 'true',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      accountSid: 'ACnew',
      authToken: 'env-twilio-token',
      phoneNumber: '+15552222222',
      homeChannel: '+15553333333',
      homeChannelName: 'Owner phone',
      allowedUsers: ['+15553333333', '+15554444444'],
      allowAllUsers: true,
      webhookUrl: 'https://sms.example.com/webhook',
      insecureNoSignature: true,
      source: 'env',
    });

    expect(
      C.resolveWebhookConfig(cfg, {
        WEBHOOK_ENABLED: 'true',
        WEBHOOK_SECRET: 'env-webhook-secret',
        WEBHOOK_PUBLIC_URL: 'https://hooks.example.com',
        WEBHOOK_RATE_LIMIT_PER_MINUTE: '45',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      enabled: true,
      secret: 'env-webhook-secret',
      publicUrl: 'https://hooks.example.com',
      rateLimitPerMinute: 45,
      source: 'env',
      routes: {
        issues: expect.objectContaining({
          events: ['issues'],
          secret: 'route-secret',
          deliver: 'log',
        }),
      },
    });

    expect(
      C.resolveNtfyConfig(cfg, {
        NTFY_SERVER_URL: 'https://ntfy.example.com',
        NTFY_TOPIC: 'new-topic',
        NTFY_PUBLISH_TOPIC: 'new-replies',
        NTFY_TOKEN: 'env-ntfy-token',
        NTFY_HOME_CHANNEL: 'new-topic',
        NTFY_HOME_CHANNEL_NAME: 'Owner phone',
        NTFY_ALLOWED_USERS: 'new-topic,other-topic',
        NTFY_ALLOW_ALL_USERS: 'true',
        NTFY_MARKDOWN: 'true',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      serverUrl: 'https://ntfy.example.com',
      topic: 'new-topic',
      publishTopic: 'new-replies',
      token: 'env-ntfy-token',
      homeChannel: 'new-topic',
      homeChannelName: 'Owner phone',
      allowedUsers: ['new-topic', 'other-topic'],
      allowAllUsers: true,
      markdown: true,
      source: 'env',
    });

    expect(
      C.resolveSignalConfig(cfg, {
        SIGNAL_HTTP_URL: 'http://127.0.0.1:9090/',
        SIGNAL_ACCOUNT: '+15552222222',
        SIGNAL_HOME_CHANNEL: '+15553333333',
        SIGNAL_HOME_CHANNEL_NAME: 'Owner Signal',
        SIGNAL_ALLOWED_USERS: '+15553333333,+15554444444',
        SIGNAL_GROUP_ALLOWED_USERS: 'group:newgroup,*',
        SIGNAL_ALLOW_ALL_USERS: 'true',
        SIGNAL_REQUIRE_MENTION: 'true',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      httpUrl: 'http://127.0.0.1:9090',
      account: '+15552222222',
      homeChannel: '+15553333333',
      homeChannelName: 'Owner Signal',
      allowedUsers: ['+15553333333', '+15554444444'],
      groupAllowedUsers: ['group:newgroup', '*'],
      allowAllUsers: true,
      requireMention: true,
      source: 'env',
    });
  });

  it('trims ntfy scalar settings before resolving topics and URLs', () => {
    expect(
      C.resolveNtfyConfig(
        {
          ntfy: {
            serverUrl: ' https://config-ntfy.example.com/ ',
            topic: ' config-topic ',
            publishTopic: ' config-replies ',
            token: ' config-token ',
            homeChannel: ' config-home ',
            homeChannelName: ' Owner phone ',
          },
        },
        {
          NTFY_SERVER_URL: ' https://ntfy.example.com/ ',
          NTFY_TOPIC: ' new-topic ',
          NTFY_PUBLISH_TOPIC: ' new-replies ',
          NTFY_TOKEN: ' env-ntfy-token ',
          NTFY_HOME_CHANNEL: ' new-home ',
          NTFY_HOME_CHANNEL_NAME: ' New owner ',
        } as NodeJS.ProcessEnv,
      ),
    ).toMatchObject({
      serverUrl: 'https://ntfy.example.com',
      topic: 'new-topic',
      publishTopic: 'new-replies',
      token: 'env-ntfy-token',
      homeChannel: 'new-home',
      homeChannelName: 'New owner',
      source: 'env',
    });
  });
});
