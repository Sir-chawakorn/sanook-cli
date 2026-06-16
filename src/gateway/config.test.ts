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

  it('persists and redacts Discord, Slack, Mattermost, Home Assistant, Email, LINE, SMS, ntfy, Signal, WhatsApp, Matrix, Feishu, DingTalk, Google Chat, Teams, and Webhooks gateway config', async () => {
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
      mattermost: {
        enabled: true,
        serverUrl: ' https://mm.example.com/ ',
        token: 'mattermost-token',
        homeChannel: ' chan-home ',
        homeChannelName: 'Owner Mattermost',
        allowedUsers: [' user-1 '],
        allowedChannels: [' chan-home ', ' chan-ops '],
        freeResponseChannels: [' chan-free '],
        replyMode: 'thread',
      },
      homeassistant: {
        enabled: true,
        url: ' http://ha.local:8123/ ',
        token: 'hass-token',
        homeChannel: ' sanook_agent ',
        homeChannelName: 'Home Assistant',
        watchDomains: [' light ', 'binary_sensor'],
        watchEntities: [' sensor.temp '],
        ignoreEntities: [' sensor.noisy '],
        watchAll: false,
        cooldownSeconds: 45,
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
      whatsapp: {
        enabled: true,
        phoneNumberId: '123456789012345',
        accessToken: 'EAA-whatsapp-token',
        appSecret: 'whatsapp-app-secret',
        verifyToken: 'whatsapp-verify-token',
        homeChannel: '+1 (555) 123-4567',
        homeChannelName: 'Owner WhatsApp',
        allowedUsers: [' +1 (555) 123-4567 '],
        publicUrl: 'https://wa.example.com',
        apiVersion: ' v20.0 ',
      },
      teams: {
        enabled: true,
        deliveryMode: 'graph',
        incomingWebhookUrl: ' https://example.webhook.office.com/webhookb2/id ',
        graphAccessToken: 'teams-graph-token',
        teamId: ' team-1 ',
        channelId: ' channel-1 ',
        chatId: ' 19:chat@thread.v2 ',
        homeChannel: ' 19:chat@thread.v2 ',
        homeChannelName: 'Owner Teams',
        clientId: ' client-id ',
        clientSecret: 'teams-client-secret',
        tenantId: ' tenant-id ',
        allowedUsers: [' user@example.com '],
        port: 3979,
      },
      feishu: {
        enabled: true,
        domain: 'lark',
        baseUrl: ' https://open.larksuite.com/ ',
        appId: ' cli_app ',
        appSecret: 'feishu-app-secret',
        verificationToken: 'feishu-verify-token',
        encryptKey: 'feishu-encrypt-key',
        homeChannel: ' oc_home ',
        homeChannelName: 'Owner Feishu',
        allowedChats: [' oc_home ', ' oc_ops '],
        allowedUsers: [' ou_user '],
      },
      dingtalk: {
        enabled: true,
        clientId: ' ding-app-key ',
        clientSecret: 'dingtalk-client-secret',
        robotCode: ' ding-robot ',
        apiBaseUrl: ' https://api.dingtalk.com/ ',
        webhookUrl: ' https://oapi.dingtalk.com/robot/send?access_token=secret-token ',
        webhookSecret: 'dingtalk-webhook-secret',
        homeChannel: ' cid-home ',
        homeChannelName: 'Owner DingTalk',
        allowedUsers: [' manager '],
        allowedChats: [' cid-home ', ' cid-ops '],
        freeResponseChats: [' cid-free '],
        requireMention: false,
        groupSessionsPerUser: false,
      },
      googleChat: {
        enabled: true,
        projectId: ' project-1 ',
        subscriptionName: ' projects/project-1/subscriptions/hermes-chat-events-sub ',
        serviceAccountJson: ' /home/you/.sanook/google-chat-sa.json ',
        apiBaseUrl: ' https://chat.googleapis.com/ ',
        incomingWebhookUrl: ' https://chat.googleapis.com/v1/spaces/AAAA/messages?key=secret&token=token ',
        homeChannel: ' spaces/AAAA ',
        homeChannelName: 'Owner Google Chat',
        allowedUsers: [' owner@example.com '],
        allowedSpaces: [' spaces/AAAA ', ' spaces/BBBB '],
        freeResponseSpaces: [' spaces/FREE '],
        maxMessages: 2,
        maxBytes: 1024,
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
    expect(cfg.mattermost?.serverUrl).toBe('https://mm.example.com/');
    expect(cfg.mattermost?.allowedUsers).toEqual(['user-1']);
    expect(cfg.mattermost?.allowedChannels).toEqual(['chan-home', 'chan-ops']);
    expect(cfg.mattermost?.freeResponseChannels).toEqual(['chan-free']);
    expect(cfg.mattermost?.replyMode).toBe('thread');
    expect(cfg.homeassistant?.url).toBe('http://ha.local:8123/');
    expect(cfg.homeassistant?.homeChannel).toBe('sanook_agent');
    expect(cfg.homeassistant?.watchDomains).toEqual(['light', 'binary_sensor']);
    expect(cfg.homeassistant?.watchEntities).toEqual(['sensor.temp']);
    expect(cfg.homeassistant?.ignoreEntities).toEqual(['sensor.noisy']);
    expect(cfg.email?.allowedUsers).toEqual(['owner@example.com']);
    expect(cfg.line?.allowedUsers).toEqual(['U1234567890abcdef']);
    expect(cfg.sms?.allowedUsers).toEqual(['+15557654321']);
    expect(cfg.ntfy?.allowedUsers).toEqual(['sanook-topic']);
    expect(cfg.ntfy?.markdown).toBe(true);
    expect(cfg.signal?.account).toBe('+15550000000');
    expect(cfg.signal?.allowedUsers).toEqual(['+1 (555) 765-4321']);
    expect(cfg.signal?.groupAllowedUsers).toEqual(['group:abcd1234']);
    expect(cfg.whatsapp?.phoneNumberId).toBe('123456789012345');
    expect(cfg.whatsapp?.allowedUsers).toEqual(['+1 (555) 123-4567']);
    expect(cfg.teams?.deliveryMode).toBe('graph');
    expect(cfg.teams?.incomingWebhookUrl).toBe('https://example.webhook.office.com/webhookb2/id');
    expect(cfg.teams?.chatId).toBe('19:chat@thread.v2');
    expect(cfg.teams?.allowedUsers).toEqual(['user@example.com']);
    expect(cfg.feishu?.domain).toBe('lark');
    expect(cfg.feishu?.baseUrl).toBe('https://open.larksuite.com/');
    expect(cfg.feishu?.appId).toBe('cli_app');
    expect(cfg.feishu?.homeChannel).toBe('oc_home');
    expect(cfg.feishu?.allowedChats).toEqual(['oc_home', 'oc_ops']);
    expect(cfg.feishu?.allowedUsers).toEqual(['ou_user']);
    expect(cfg.dingtalk?.clientId).toBe('ding-app-key');
    expect(cfg.dingtalk?.robotCode).toBe('ding-robot');
    expect(cfg.dingtalk?.apiBaseUrl).toBe('https://api.dingtalk.com/');
    expect(cfg.dingtalk?.webhookUrl).toBe('https://oapi.dingtalk.com/robot/send?access_token=secret-token');
    expect(cfg.dingtalk?.homeChannel).toBe('cid-home');
    expect(cfg.dingtalk?.allowedUsers).toEqual(['manager']);
    expect(cfg.dingtalk?.allowedChats).toEqual(['cid-home', 'cid-ops']);
    expect(cfg.dingtalk?.freeResponseChats).toEqual(['cid-free']);
    expect(cfg.dingtalk?.requireMention).toBe(false);
    expect(cfg.dingtalk?.groupSessionsPerUser).toBe(false);
    expect(cfg.googleChat?.projectId).toBe('project-1');
    expect(cfg.googleChat?.subscriptionName).toBe('projects/project-1/subscriptions/hermes-chat-events-sub');
    expect(cfg.googleChat?.serviceAccountJson).toBe('/home/you/.sanook/google-chat-sa.json');
    expect(cfg.googleChat?.apiBaseUrl).toBe('https://chat.googleapis.com/');
    expect(cfg.googleChat?.incomingWebhookUrl).toBe('https://chat.googleapis.com/v1/spaces/AAAA/messages?key=secret&token=token');
    expect(cfg.googleChat?.homeChannel).toBe('spaces/AAAA');
    expect(cfg.googleChat?.allowedUsers).toEqual(['owner@example.com']);
    expect(cfg.googleChat?.allowedSpaces).toEqual(['spaces/AAAA', 'spaces/BBBB']);
    expect(cfg.googleChat?.freeResponseSpaces).toEqual(['spaces/FREE']);
    expect(cfg.googleChat?.maxMessages).toBe(2);
    expect(cfg.googleChat?.maxBytes).toBe(1024);
    expect(cfg.webhooks?.routes?.issues.events).toEqual(['issues', 'push']);
    expect(C.redactGatewayConfig(cfg).discord?.botToken).toBe('<secret:DISCORD_BOT_TOKEN>');
    expect(C.redactGatewayConfig(cfg).slack?.botToken).toBe('<secret:SLACK_BOT_TOKEN>');
    expect(C.redactGatewayConfig(cfg).slack?.appToken).toBe('<secret:SLACK_APP_TOKEN>');
    expect(C.redactGatewayConfig(cfg).mattermost?.token).toBe('<secret:MATTERMOST_TOKEN>');
    expect(C.redactGatewayConfig(cfg).homeassistant?.token).toBe('<secret:HASS_TOKEN>');
    expect(C.redactGatewayConfig(cfg).email?.password).toBe('<secret:EMAIL_PASSWORD>');
    expect(C.redactGatewayConfig(cfg).line?.channelAccessToken).toBe('<secret:LINE_CHANNEL_ACCESS_TOKEN>');
    expect(C.redactGatewayConfig(cfg).line?.channelSecret).toBe('<secret:LINE_CHANNEL_SECRET>');
    expect(C.redactGatewayConfig(cfg).sms?.authToken).toBe('<secret:TWILIO_AUTH_TOKEN>');
    expect(C.redactGatewayConfig(cfg).ntfy?.token).toBe('<secret:NTFY_TOKEN>');
    expect(C.redactGatewayConfig(cfg).signal?.account).toBe('+155…0000');
    expect(C.redactGatewayConfig(cfg).signal?.homeChannel).toBe('+155…4321');
    expect(C.redactGatewayConfig(cfg).whatsapp?.accessToken).toBe('<secret:WHATSAPP_CLOUD_ACCESS_TOKEN>');
    expect(C.redactGatewayConfig(cfg).whatsapp?.appSecret).toBe('<secret:WHATSAPP_CLOUD_APP_SECRET>');
    expect(C.redactGatewayConfig(cfg).whatsapp?.verifyToken).toBe('<secret:WHATSAPP_CLOUD_VERIFY_TOKEN>');
    expect(C.redactGatewayConfig(cfg).whatsapp?.homeChannel).toBe('1555…4567');
    expect(C.redactGatewayConfig(cfg).teams?.incomingWebhookUrl).toBe('<secret:TEAMS_INCOMING_WEBHOOK_URL>');
    expect(C.redactGatewayConfig(cfg).teams?.graphAccessToken).toBe('<secret:TEAMS_GRAPH_ACCESS_TOKEN>');
    expect(C.redactGatewayConfig(cfg).teams?.clientSecret).toBe('<secret:TEAMS_CLIENT_SECRET>');
    expect(C.redactGatewayConfig(cfg).feishu?.appSecret).toBe('<secret:FEISHU_APP_SECRET>');
    expect(C.redactGatewayConfig(cfg).feishu?.verificationToken).toBe('<secret:FEISHU_VERIFICATION_TOKEN>');
    expect(C.redactGatewayConfig(cfg).feishu?.encryptKey).toBe('<secret:FEISHU_ENCRYPT_KEY>');
    expect(C.redactGatewayConfig(cfg).dingtalk?.clientSecret).toBe('<secret:DINGTALK_CLIENT_SECRET>');
    expect(C.redactGatewayConfig(cfg).dingtalk?.webhookUrl).toBe('<secret:DINGTALK_WEBHOOK_URL>');
    expect(C.redactGatewayConfig(cfg).dingtalk?.webhookSecret).toBe('<secret:DINGTALK_WEBHOOK_SECRET>');
    expect(C.redactGatewayConfig(cfg).googleChat?.serviceAccountJson).toBe('<secret:GOOGLE_CHAT_SERVICE_ACCOUNT_JSON>');
    expect(C.redactGatewayConfig(cfg).googleChat?.incomingWebhookUrl).toBe('<secret:GOOGLE_CHAT_INCOMING_WEBHOOK_URL>');
    expect(C.redactGatewayConfig(cfg).webhooks?.secret).toBe('<secret:WEBHOOK_SECRET>');
    expect(C.redactGatewayConfig(cfg).webhooks?.routes?.issues.secret).toBe('<secret:WEBHOOK_ROUTE_SECRET>');
  });

  it('env Discord, Slack, Mattermost, Home Assistant, Email, LINE, SMS, ntfy, Signal, WhatsApp, Feishu, DingTalk, Google Chat, Teams, and Webhooks settings override persisted messaging config', () => {
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
      mattermost: {
        serverUrl: 'https://old-mm.example.com',
        token: 'config-mattermost-token',
        homeChannel: 'old-mm',
        allowedUsers: ['old-user'],
        allowedChannels: ['old-mm'],
        freeResponseChannels: ['old-free'],
        requireMention: false,
        groupSessionsPerUser: false,
        replyMode: 'off' as const,
      },
      homeassistant: {
        url: 'http://old-ha.local:8123',
        token: 'config-hass-token',
        homeChannel: 'old_agent',
        watchDomains: ['sensor'],
        watchEntities: ['sensor.old'],
        ignoreEntities: ['sensor.noisy'],
        watchAll: false,
        cooldownSeconds: 10,
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
      whatsapp: {
        phoneNumberId: 'old-phone-id',
        accessToken: 'old-wa-token',
        appSecret: 'old-wa-secret',
        verifyToken: 'old-wa-verify',
        homeChannel: '15551111111',
        allowedUsers: ['15551111111'],
        publicUrl: 'https://old-wa.example.com',
        apiVersion: 'v19.0',
      },
      teams: {
        deliveryMode: 'incoming_webhook' as const,
        incomingWebhookUrl: 'https://old.webhook.office.com/webhook',
        graphAccessToken: 'config-graph-token',
        chatId: 'old-chat',
        allowedUsers: ['old-user'],
      },
      feishu: {
        domain: 'feishu' as const,
        baseUrl: 'https://old.feishu.example.com',
        appId: 'old-app',
        appSecret: 'old-secret',
        verificationToken: 'old-verify',
        encryptKey: 'old-encrypt',
        homeChannel: 'old-home',
        allowedChats: ['old-home'],
        allowedUsers: ['old-user'],
      },
      dingtalk: {
        clientId: 'old-ding-client',
        clientSecret: 'old-ding-secret',
        robotCode: 'old-ding-robot',
        apiBaseUrl: 'https://old-ding.example.com',
        webhookUrl: 'https://old-ding.example.com/webhook',
        webhookSecret: 'old-ding-webhook-secret',
        homeChannel: 'old-ding-home',
        allowedUsers: ['old-ding-user'],
        allowedChats: ['old-ding-home'],
        freeResponseChats: ['old-ding-free'],
        requireMention: false,
        groupSessionsPerUser: false,
      },
      googleChat: {
        projectId: 'old-project',
        subscriptionName: 'projects/old/subscriptions/old-sub',
        serviceAccountJson: '/old/google-chat-sa.json',
        apiBaseUrl: 'https://old-chat.example.com',
        incomingWebhookUrl: 'https://old-chat.example.com/webhook',
        homeChannel: 'spaces/OLD',
        allowedUsers: ['old@example.com'],
        allowedSpaces: ['spaces/OLD'],
        freeResponseSpaces: ['spaces/OLDFREE'],
        maxMessages: 1,
        maxBytes: 1024,
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
      C.resolveMattermostConfig(cfg, {
        MATTERMOST_URL: 'https://mm.example.com/',
        MATTERMOST_TOKEN: 'env-mattermost-token',
        MATTERMOST_HOME_CHANNEL: 'chan-home',
        MATTERMOST_HOME_CHANNEL_NAME: 'Owner Mattermost',
        MATTERMOST_ALLOWED_USERS: 'user-1,user-2',
        MATTERMOST_ALLOWED_CHANNELS: 'chan-home,chan-ops',
        MATTERMOST_FREE_RESPONSE_CHANNELS: 'chan-free',
        MATTERMOST_ALLOW_ALL_USERS: 'true',
        MATTERMOST_REQUIRE_MENTION: 'true',
        MATTERMOST_GROUP_SESSIONS_PER_USER: 'true',
        MATTERMOST_REPLY_MODE: 'thread',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      serverUrl: 'https://mm.example.com',
      token: 'env-mattermost-token',
      homeChannel: 'chan-home',
      homeChannelName: 'Owner Mattermost',
      allowedUsers: ['user-1', 'user-2'],
      allowedChannels: ['chan-home', 'chan-ops'],
      freeResponseChannels: ['chan-free'],
      allowAllUsers: true,
      requireMention: true,
      groupSessionsPerUser: true,
      replyMode: 'thread',
      source: 'env',
    });

    expect(
      C.resolveHomeAssistantConfig(cfg, {
        HASS_URL: 'http://ha.local:8123/',
        HASS_TOKEN: 'env-hass-token',
        HASS_HOME_CHANNEL: 'sanook_agent',
        HASS_HOME_CHANNEL_NAME: 'Owner HA',
        HASS_WATCH_DOMAINS: 'light,binary_sensor',
        HASS_WATCH_ENTITIES: 'sensor.temp',
        HASS_IGNORE_ENTITIES: 'sensor.noisy',
        HASS_WATCH_ALL: 'true',
        HASS_COOLDOWN_SECONDS: '60',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      url: 'http://ha.local:8123',
      token: 'env-hass-token',
      homeChannel: 'sanook_agent',
      homeChannelName: 'Owner HA',
      watchDomains: ['light', 'binary_sensor'],
      watchEntities: ['sensor.temp'],
      ignoreEntities: ['sensor.noisy'],
      watchAll: true,
      cooldownSeconds: 60,
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

    expect(
      C.resolveWhatsAppConfig(cfg, {
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: '123456789012345',
        WHATSAPP_CLOUD_ACCESS_TOKEN: 'EAA-env-wa-token',
        WHATSAPP_CLOUD_APP_SECRET: 'env-wa-secret',
        WHATSAPP_CLOUD_VERIFY_TOKEN: 'env-wa-verify',
        WHATSAPP_CLOUD_HOME_CHANNEL: '15553333333',
        WHATSAPP_CLOUD_HOME_CHANNEL_NAME: 'Owner WhatsApp',
        WHATSAPP_CLOUD_ALLOWED_USERS: '15553333333,15554444444',
        WHATSAPP_CLOUD_ALLOW_ALL_USERS: 'true',
        WHATSAPP_CLOUD_PUBLIC_URL: 'https://wa.example.com',
        WHATSAPP_CLOUD_API_VERSION: 'v20.0',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      phoneNumberId: '123456789012345',
      accessToken: 'EAA-env-wa-token',
      appSecret: 'env-wa-secret',
      verifyToken: 'env-wa-verify',
      homeChannel: '15553333333',
      homeChannelName: 'Owner WhatsApp',
      allowedUsers: ['15553333333', '15554444444'],
      allowAllUsers: true,
      publicUrl: 'https://wa.example.com',
      apiVersion: 'v20.0',
      source: 'env',
    });

    expect(
      C.resolveFeishuConfig(cfg, {
        FEISHU_DOMAIN: 'lark',
        FEISHU_BASE_URL: 'https://open.larksuite.com/',
        FEISHU_APP_ID: 'cli_env',
        FEISHU_APP_SECRET: 'env-feishu-secret',
        FEISHU_VERIFICATION_TOKEN: 'env-feishu-verify',
        FEISHU_ENCRYPT_KEY: 'env-feishu-encrypt',
        FEISHU_HOME_CHANNEL: 'oc_env',
        FEISHU_HOME_CHANNEL_NAME: 'Owner Feishu',
        FEISHU_ALLOWED_CHATS: 'oc_env,oc_ops',
        FEISHU_ALLOW_ALL_CHATS: 'true',
        FEISHU_ALLOWED_USERS: 'ou_env,ou_other',
        FEISHU_ALLOW_ALL_USERS: 'true',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      domain: 'lark',
      baseUrl: 'https://open.larksuite.com',
      appId: 'cli_env',
      appSecret: 'env-feishu-secret',
      verificationToken: 'env-feishu-verify',
      encryptKey: 'env-feishu-encrypt',
      homeChannel: 'oc_env',
      homeChannelName: 'Owner Feishu',
      allowedChats: ['oc_env', 'oc_ops'],
      allowAllChats: true,
      allowedUsers: ['ou_env', 'ou_other'],
      allowAllUsers: true,
      source: 'env',
    });

    expect(
      C.resolveDingTalkConfig(cfg, {
        DINGTALK_CLIENT_ID: 'env-ding-client',
        DINGTALK_CLIENT_SECRET: 'env-ding-secret',
        DINGTALK_ROBOT_CODE: 'env-ding-robot',
        DINGTALK_API_BASE_URL: 'https://api.dingtalk.com/',
        DINGTALK_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=env',
        DINGTALK_WEBHOOK_SECRET: 'env-ding-webhook-secret',
        DINGTALK_HOME_CHANNEL: 'env-ding-home',
        DINGTALK_HOME_CHANNEL_NAME: 'Owner DingTalk',
        DINGTALK_ALLOWED_USERS: 'manager,owner',
        DINGTALK_ALLOWED_CHATS: 'env-ding-home,env-ding-ops',
        DINGTALK_FREE_RESPONSE_CHATS: 'env-ding-free',
        DINGTALK_ALLOW_ALL_USERS: 'true',
        DINGTALK_ALLOW_ALL_CHATS: 'true',
        DINGTALK_REQUIRE_MENTION: 'true',
        DINGTALK_GROUP_SESSIONS_PER_USER: 'true',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      clientId: 'env-ding-client',
      clientSecret: 'env-ding-secret',
      robotCode: 'env-ding-robot',
      apiBaseUrl: 'https://api.dingtalk.com',
      webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=env',
      webhookSecret: 'env-ding-webhook-secret',
      homeChannel: 'env-ding-home',
      homeChannelName: 'Owner DingTalk',
      allowedUsers: ['manager', 'owner'],
      allowedChats: ['env-ding-home', 'env-ding-ops'],
      freeResponseChats: ['env-ding-free'],
      allowAllUsers: true,
      allowAllChats: true,
      requireMention: true,
      groupSessionsPerUser: true,
      source: 'env',
    });

    expect(
      C.resolveGoogleChatConfig(cfg, {
        GOOGLE_CHAT_PROJECT_ID: 'project-env',
        GOOGLE_CHAT_SUBSCRIPTION_NAME: 'projects/project-env/subscriptions/hermes-chat-events-sub',
        GOOGLE_CHAT_SERVICE_ACCOUNT_JSON: '/env/google-chat-sa.json',
        GOOGLE_CHAT_API_BASE_URL: 'https://chat.googleapis.com/',
        GOOGLE_CHAT_INCOMING_WEBHOOK_URL: 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=env&token=env',
        GOOGLE_CHAT_HOME_CHANNEL: 'spaces/AAAA',
        GOOGLE_CHAT_HOME_CHANNEL_NAME: 'Owner Google Chat',
        GOOGLE_CHAT_ALLOWED_USERS: 'owner@example.com,teammate@example.com',
        GOOGLE_CHAT_ALLOWED_SPACES: 'spaces/AAAA,spaces/BBBB',
        GOOGLE_CHAT_FREE_RESPONSE_SPACES: 'spaces/FREE',
        GOOGLE_CHAT_ALLOW_ALL_USERS: 'true',
        GOOGLE_CHAT_ALLOW_ALL_SPACES: 'true',
        GOOGLE_CHAT_MAX_MESSAGES: '3',
        GOOGLE_CHAT_MAX_BYTES: '2048',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      projectId: 'project-env',
      subscriptionName: 'projects/project-env/subscriptions/hermes-chat-events-sub',
      serviceAccountJson: '/env/google-chat-sa.json',
      apiBaseUrl: 'https://chat.googleapis.com',
      incomingWebhookUrl: 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=env&token=env',
      homeChannel: 'spaces/AAAA',
      homeChannelName: 'Owner Google Chat',
      allowedUsers: ['owner@example.com', 'teammate@example.com'],
      allowedSpaces: ['spaces/AAAA', 'spaces/BBBB'],
      freeResponseSpaces: ['spaces/FREE'],
      allowAllUsers: true,
      allowAllSpaces: true,
      maxMessages: 3,
      maxBytes: 2048,
      source: 'env',
    });

    expect(
      C.resolveTeamsConfig(cfg, {
        TEAMS_DELIVERY_MODE: 'graph',
        TEAMS_INCOMING_WEBHOOK_URL: 'https://teams.example.com/webhook',
        TEAMS_GRAPH_ACCESS_TOKEN: 'env-graph-token',
        TEAMS_TEAM_ID: 'team-1',
        TEAMS_CHANNEL_ID: 'channel-1',
        TEAMS_CHAT_ID: '19:newchat@thread.v2',
        TEAMS_HOME_CHANNEL: '19:home@thread.v2',
        TEAMS_HOME_CHANNEL_NAME: 'Owner Teams',
        TEAMS_CLIENT_ID: 'client-id',
        TEAMS_CLIENT_SECRET: 'client-secret',
        TEAMS_TENANT_ID: 'tenant-id',
        TEAMS_ALLOWED_USERS: 'alice@example.com,bob@example.com',
        TEAMS_ALLOW_ALL_USERS: 'true',
        TEAMS_PORT: '3979',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      deliveryMode: 'graph',
      incomingWebhookUrl: 'https://teams.example.com/webhook',
      graphAccessToken: 'env-graph-token',
      teamId: 'team-1',
      channelId: 'channel-1',
      chatId: '19:newchat@thread.v2',
      homeChannel: '19:home@thread.v2',
      homeChannelName: 'Owner Teams',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tenantId: 'tenant-id',
      allowedUsers: ['alice@example.com', 'bob@example.com'],
      allowAllUsers: true,
      port: 3979,
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

  it('persists, resolves, and redacts WhatsApp Cloud gateway config', async () => {
    await C.patchGatewayConfig({
      whatsapp: {
        enabled: true,
        phoneNumberId: ' 1234567890 ',
        accessToken: 'whatsapp-token',
        appSecret: 'whatsapp-secret',
        verifyToken: 'whatsapp-verify',
        homeChannel: ' 15551234567 ',
        homeChannelName: 'Owner WhatsApp',
        allowedUsers: [' 15557654321 '],
        publicUrl: ' https://wa.example.com ',
        apiVersion: ' v21.0 ',
      },
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.whatsapp).toMatchObject({
      phoneNumberId: '1234567890',
      accessToken: 'whatsapp-token',
      appSecret: 'whatsapp-secret',
      verifyToken: 'whatsapp-verify',
      homeChannel: '15551234567',
      homeChannelName: 'Owner WhatsApp',
      allowedUsers: ['15557654321'],
      publicUrl: ' https://wa.example.com ',
      apiVersion: 'v21.0',
    });

    expect(C.resolveWhatsAppConfig(cfg, {} as NodeJS.ProcessEnv)).toMatchObject({
      phoneNumberId: '1234567890',
      accessToken: 'whatsapp-token',
      appSecret: 'whatsapp-secret',
      verifyToken: 'whatsapp-verify',
      homeChannel: '15551234567',
      homeChannelName: 'Owner WhatsApp',
      allowedUsers: ['15557654321'],
      publicUrl: 'https://wa.example.com',
      apiVersion: 'v21.0',
      source: 'config',
    });

    expect(
      C.resolveWhatsAppConfig(cfg, {
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: '9876543210',
        WHATSAPP_CLOUD_ACCESS_TOKEN: 'env-whatsapp-token',
        WHATSAPP_CLOUD_APP_SECRET: 'env-whatsapp-secret',
        WHATSAPP_CLOUD_VERIFY_TOKEN: 'env-whatsapp-verify',
        WHATSAPP_CLOUD_HOME_CHANNEL: '15550001111',
        WHATSAPP_CLOUD_HOME_CHANNEL_NAME: 'Env Owner',
        WHATSAPP_CLOUD_ALLOWED_USERS: '15550001111,15550002222',
        WHATSAPP_CLOUD_ALLOW_ALL_USERS: 'true',
        WHATSAPP_CLOUD_PUBLIC_URL: 'https://env-wa.example.com',
        WHATSAPP_CLOUD_API_VERSION: 'v22.0',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      phoneNumberId: '9876543210',
      accessToken: 'env-whatsapp-token',
      appSecret: 'env-whatsapp-secret',
      verifyToken: 'env-whatsapp-verify',
      homeChannel: '15550001111',
      homeChannelName: 'Env Owner',
      allowedUsers: ['15550001111', '15550002222'],
      allowAllUsers: true,
      publicUrl: 'https://env-wa.example.com',
      apiVersion: 'v22.0',
      source: 'env',
    });

    expect(C.redactGatewayConfig(cfg).whatsapp).toMatchObject({
      accessToken: '<secret:WHATSAPP_CLOUD_ACCESS_TOKEN>',
      appSecret: '<secret:WHATSAPP_CLOUD_APP_SECRET>',
      verifyToken: '<secret:WHATSAPP_CLOUD_VERIFY_TOKEN>',
      homeChannel: '1555…4567',
      allowedUsers: ['1555…4321'],
    });
  });

  it('persists, resolves, and redacts BlueBubbles gateway config', async () => {
    await C.patchGatewayConfig({
      bluebubbles: {
        enabled: true,
        serverUrl: ' http://mac.local:1234 ',
        password: 'bluebubbles-password',
        webhookHost: ' 0.0.0.0 ',
        webhookPort: 8765,
        webhookPath: ' /imessage-events ',
        homeChannel: ' chat;home-guid ',
        homeChannelName: 'Owner iMessage',
        allowedUsers: [' user@example.com ', '', ' +15551234567 '],
        allowAllUsers: false,
        requireMention: true,
        mentionPatterns: [' sanook ', ' @agent '],
        sendReadReceipts: false,
      },
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.bluebubbles).toMatchObject({
      serverUrl: 'http://mac.local:1234',
      password: 'bluebubbles-password',
      webhookHost: '0.0.0.0',
      webhookPort: 8765,
      webhookPath: '/imessage-events',
      homeChannel: 'chat;home-guid',
      homeChannelName: 'Owner iMessage',
      allowedUsers: ['user@example.com', '+15551234567'],
      allowAllUsers: false,
      requireMention: true,
      mentionPatterns: ['sanook', '@agent'],
      sendReadReceipts: false,
    });

    expect(C.resolveBlueBubblesConfig(cfg, {} as NodeJS.ProcessEnv)).toMatchObject({
      serverUrl: 'http://mac.local:1234',
      password: 'bluebubbles-password',
      webhookHost: '0.0.0.0',
      webhookPort: 8765,
      webhookPath: '/imessage-events',
      homeChannel: 'chat;home-guid',
      homeChannelName: 'Owner iMessage',
      allowedUsers: ['user@example.com', '+15551234567'],
      allowAllUsers: false,
      requireMention: true,
      mentionPatterns: ['sanook', '@agent'],
      sendReadReceipts: false,
      source: 'config',
    });

    expect(
      C.resolveBlueBubblesConfig(cfg, {
        BLUEBUBBLES_SERVER_URL: 'http://env-mac.local:1234',
        BLUEBUBBLES_PASSWORD: 'env-bluebubbles-password',
        BLUEBUBBLES_WEBHOOK_HOST: '127.0.0.1',
        BLUEBUBBLES_WEBHOOK_PORT: '9876',
        BLUEBUBBLES_WEBHOOK_PATH: '/env-imessage-events',
        BLUEBUBBLES_HOME_CHANNEL: 'env@example.com',
        BLUEBUBBLES_HOME_CHANNEL_NAME: 'Env iMessage',
        BLUEBUBBLES_ALLOWED_USERS: 'env@example.com,+15557654321',
        BLUEBUBBLES_ALLOW_ALL_USERS: 'true',
        BLUEBUBBLES_REQUIRE_MENTION: 'false',
        BLUEBUBBLES_MENTION_PATTERNS: '["sanook","@env-agent"]',
        BLUEBUBBLES_SEND_READ_RECEIPTS: 'true',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      serverUrl: 'http://env-mac.local:1234',
      password: 'env-bluebubbles-password',
      webhookHost: '127.0.0.1',
      webhookPort: 9876,
      webhookPath: '/env-imessage-events',
      homeChannel: 'env@example.com',
      homeChannelName: 'Env iMessage',
      allowedUsers: ['env@example.com', '+15557654321'],
      allowAllUsers: true,
      requireMention: false,
      mentionPatterns: ['sanook', '@env-agent'],
      sendReadReceipts: true,
      source: 'env',
    });

    expect(C.redactGatewayConfig(cfg).bluebubbles).toMatchObject({
      password: '<secret:BLUEBUBBLES_PASSWORD>',
    });
  });

  it('persists, resolves, and redacts WeCom gateway config', async () => {
    await C.patchGatewayConfig({
      wecom: {
        enabled: true,
        botId: ' bot-1 ',
        secret: 'wecom-secret',
        websocketUrl: ' wss://openws.work.weixin.qq.com/ ',
        homeChannel: ' user-1 ',
        homeChannelName: 'Owner WeCom',
        allowedUsers: [' user-1 ', '', ' user-2 '],
        allowedGroups: [' group-1 '],
        dmPolicy: 'allowlist',
        groupPolicy: 'allowlist',
      },
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.wecom).toMatchObject({
      botId: 'bot-1',
      secret: 'wecom-secret',
      websocketUrl: 'wss://openws.work.weixin.qq.com/',
      homeChannel: 'user-1',
      homeChannelName: 'Owner WeCom',
      allowedUsers: ['user-1', 'user-2'],
      allowedGroups: ['group-1'],
      dmPolicy: 'allowlist',
      groupPolicy: 'allowlist',
    });

    expect(C.resolveWeComConfig(cfg, {} as NodeJS.ProcessEnv)).toMatchObject({
      botId: 'bot-1',
      secret: 'wecom-secret',
      websocketUrl: 'wss://openws.work.weixin.qq.com/',
      homeChannel: 'user-1',
      homeChannelName: 'Owner WeCom',
      allowedUsers: ['user-1', 'user-2'],
      allowedGroups: ['group-1'],
      dmPolicy: 'allowlist',
      groupPolicy: 'allowlist',
      source: 'config',
    });

    expect(
      C.resolveWeComConfig(cfg, {
        WECOM_BOT_ID: 'env-bot',
        WECOM_SECRET: 'env-secret',
        WECOM_WEBSOCKET_URL: 'ws://127.0.0.1:8765/ws',
        WECOM_HOME_CHANNEL: 'env-user',
        WECOM_HOME_CHANNEL_NAME: 'Env WeCom',
        WECOM_ALLOWED_USERS: 'env-user,env-user-2',
        WECOM_GROUP_ALLOW_FROM: 'env-group',
        WECOM_DM_POLICY: 'open',
        WECOM_GROUP_POLICY: 'disabled',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      botId: 'env-bot',
      secret: 'env-secret',
      websocketUrl: 'ws://127.0.0.1:8765/ws',
      homeChannel: 'env-user',
      homeChannelName: 'Env WeCom',
      allowedUsers: ['env-user', 'env-user-2'],
      allowedGroups: ['env-group'],
      dmPolicy: 'open',
      groupPolicy: 'disabled',
      source: 'env',
    });

    expect(C.redactGatewayConfig(cfg).wecom).toMatchObject({
      secret: '<secret:WECOM_SECRET>',
    });
  });

  it('persists, resolves, and redacts Weixin gateway config', async () => {
    await C.patchGatewayConfig({
      weixin: {
        enabled: true,
        accountId: ' wx-account-1 ',
        token: 'weixin-token',
        baseUrl: ' https://ilinkai.weixin.qq.com/ ',
        cdnBaseUrl: ' https://novac2c.cdn.weixin.qq.com/c2c/ ',
        homeChannel: ' user/user-1 ',
        homeChannelName: 'Owner Weixin',
        allowedUsers: [' user-1 ', '', ' user-2 '],
        groupAllowedUsers: [' group-1@chatroom '],
        allowAllUsers: false,
        dmPolicy: 'allowlist',
        groupPolicy: 'allowlist',
        splitMultilineMessages: true,
      },
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.weixin).toMatchObject({
      accountId: 'wx-account-1',
      token: 'weixin-token',
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      cdnBaseUrl: 'https://novac2c.cdn.weixin.qq.com/c2c/',
      homeChannel: 'user/user-1',
      homeChannelName: 'Owner Weixin',
      allowedUsers: ['user-1', 'user-2'],
      groupAllowedUsers: ['group-1@chatroom'],
      dmPolicy: 'allowlist',
      groupPolicy: 'allowlist',
      splitMultilineMessages: true,
    });

    expect(C.resolveWeixinConfig(cfg, {} as NodeJS.ProcessEnv)).toMatchObject({
      accountId: 'wx-account-1',
      token: 'weixin-token',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      cdnBaseUrl: 'https://novac2c.cdn.weixin.qq.com/c2c',
      homeChannel: 'user/user-1',
      homeChannelName: 'Owner Weixin',
      allowedUsers: ['user-1', 'user-2'],
      groupAllowedUsers: ['group-1@chatroom'],
      dmPolicy: 'allowlist',
      groupPolicy: 'allowlist',
      splitMultilineMessages: true,
      source: 'config',
    });

    expect(
      C.resolveWeixinConfig(cfg, {
        WEIXIN_ACCOUNT_ID: 'env-account',
        WEIXIN_TOKEN: 'env-token',
        WEIXIN_BASE_URL: 'https://env.weixin.example.com/',
        WEIXIN_CDN_BASE_URL: 'https://env-cdn.weixin.example.com/c2c/',
        WEIXIN_HOME_CHANNEL: 'group/env-group@chatroom',
        WEIXIN_HOME_CHANNEL_NAME: 'Env Weixin',
        WEIXIN_ALLOWED_USERS: 'env-user,env-user-2',
        WEIXIN_GROUP_ALLOWED_USERS: 'env-group@chatroom',
        WEIXIN_ALLOW_ALL_USERS: 'true',
        WEIXIN_DM_POLICY: 'open',
        WEIXIN_GROUP_POLICY: 'disabled',
        WEIXIN_SPLIT_MULTILINE_MESSAGES: 'true',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      accountId: 'env-account',
      token: 'env-token',
      baseUrl: 'https://env.weixin.example.com',
      cdnBaseUrl: 'https://env-cdn.weixin.example.com/c2c',
      homeChannel: 'group/env-group@chatroom',
      homeChannelName: 'Env Weixin',
      allowedUsers: ['env-user', 'env-user-2'],
      groupAllowedUsers: ['env-group@chatroom'],
      allowAllUsers: true,
      dmPolicy: 'open',
      groupPolicy: 'disabled',
      splitMultilineMessages: true,
      source: 'env',
    });

    expect(C.redactGatewayConfig(cfg).weixin).toMatchObject({
      token: '<secret:WEIXIN_TOKEN>',
    });
  });

  it('persists, resolves, and redacts Yuanbao gateway config', async () => {
    await C.patchGatewayConfig({
      yuanbao: {
        enabled: true,
        appId: ' yb-app-1 ',
        appSecret: 'yuanbao-secret',
        botId: ' yb-bot-1 ',
        wsUrl: ' wss://bot-wss.yuanbao.tencent.com/wss/connection/ ',
        apiDomain: ' https://bot.yuanbao.tencent.com/ ',
        routeEnv: ' staging ',
        homeChannel: ' direct:user-1 ',
        homeChannelName: 'Owner Yuanbao',
        allowedUsers: [' user-1 ', '', ' user-2 '],
        groupAllowedUsers: [' group-1 '],
        allowAllUsers: false,
        dmPolicy: 'allowlist',
        groupPolicy: 'allowlist',
      },
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.yuanbao).toMatchObject({
      appId: 'yb-app-1',
      appSecret: 'yuanbao-secret',
      botId: 'yb-bot-1',
      wsUrl: 'wss://bot-wss.yuanbao.tencent.com/wss/connection/',
      apiDomain: 'https://bot.yuanbao.tencent.com/',
      routeEnv: 'staging',
      homeChannel: 'direct:user-1',
      homeChannelName: 'Owner Yuanbao',
      allowedUsers: ['user-1', 'user-2'],
      groupAllowedUsers: ['group-1'],
      dmPolicy: 'allowlist',
      groupPolicy: 'allowlist',
    });

    expect(C.resolveYuanbaoConfig(cfg, {} as NodeJS.ProcessEnv)).toMatchObject({
      appId: 'yb-app-1',
      appSecret: 'yuanbao-secret',
      botId: 'yb-bot-1',
      wsUrl: 'wss://bot-wss.yuanbao.tencent.com/wss/connection/',
      apiDomain: 'https://bot.yuanbao.tencent.com',
      routeEnv: 'staging',
      homeChannel: 'direct:user-1',
      homeChannelName: 'Owner Yuanbao',
      allowedUsers: ['user-1', 'user-2'],
      groupAllowedUsers: ['group-1'],
      dmPolicy: 'allowlist',
      groupPolicy: 'allowlist',
      source: 'config',
    });

    expect(
      C.resolveYuanbaoConfig(cfg, {
        YUANBAO_APP_ID: 'env-yb-app',
        YUANBAO_APP_SECRET: 'env-yb-secret',
        YUANBAO_BOT_ID: 'env-yb-bot',
        YUANBAO_WS_URL: 'wss://env-yuanbao.example.com/wss',
        YUANBAO_API_DOMAIN: 'https://env-yuanbao.example.com/',
        YUANBAO_ROUTE_ENV: 'sandbox',
        YUANBAO_HOME_CHANNEL: 'group:env-group',
        YUANBAO_HOME_CHANNEL_NAME: 'Env Yuanbao',
        YUANBAO_DM_ALLOW_FROM: 'env-user,env-user-2',
        YUANBAO_GROUP_ALLOW_FROM: 'env-group',
        YUANBAO_ALLOW_ALL_USERS: 'true',
        YUANBAO_DM_POLICY: 'open',
        YUANBAO_GROUP_POLICY: 'disabled',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      appId: 'env-yb-app',
      appSecret: 'env-yb-secret',
      botId: 'env-yb-bot',
      wsUrl: 'wss://env-yuanbao.example.com/wss',
      apiDomain: 'https://env-yuanbao.example.com',
      routeEnv: 'sandbox',
      homeChannel: 'group:env-group',
      homeChannelName: 'Env Yuanbao',
      allowedUsers: ['env-user', 'env-user-2'],
      groupAllowedUsers: ['env-group'],
      allowAllUsers: true,
      dmPolicy: 'open',
      groupPolicy: 'disabled',
      source: 'env',
    });

    expect(C.redactGatewayConfig(cfg).yuanbao).toMatchObject({
      appSecret: '<secret:YUANBAO_APP_SECRET>',
    });
  });

  it('persists, resolves, and redacts QQBot gateway config', async () => {
    await C.patchGatewayConfig({
      qqbot: {
        enabled: true,
        appId: ' app-1 ',
        clientSecret: 'qq-secret',
        apiBaseUrl: ' https://api.sgroup.qq.com/ ',
        tokenUrl: ' https://bots.qq.com/app/getAppAccessToken ',
        portalHost: ' q.qq.com ',
        homeChannel: ' user/openid-1 ',
        homeChannelName: 'Owner QQ',
        allowedUsers: [' openid-1 ', '', ' openid-2 '],
        groupAllowedUsers: [' group-1 '],
        allowedChannels: [' channel-1 '],
        allowAllUsers: false,
        dmPolicy: 'allowlist',
        groupPolicy: 'allowlist',
        markdownSupport: true,
      },
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.qqbot).toMatchObject({
      appId: 'app-1',
      clientSecret: 'qq-secret',
      apiBaseUrl: 'https://api.sgroup.qq.com/',
      tokenUrl: 'https://bots.qq.com/app/getAppAccessToken',
      portalHost: 'q.qq.com',
      homeChannel: 'user/openid-1',
      homeChannelName: 'Owner QQ',
      allowedUsers: ['openid-1', 'openid-2'],
      groupAllowedUsers: ['group-1'],
      allowedChannels: ['channel-1'],
      dmPolicy: 'allowlist',
      groupPolicy: 'allowlist',
      markdownSupport: true,
    });

    expect(C.resolveQQBotConfig(cfg, {} as NodeJS.ProcessEnv)).toMatchObject({
      appId: 'app-1',
      clientSecret: 'qq-secret',
      apiBaseUrl: 'https://api.sgroup.qq.com/',
      tokenUrl: 'https://bots.qq.com/app/getAppAccessToken',
      portalHost: 'q.qq.com',
      homeChannel: 'user/openid-1',
      homeChannelName: 'Owner QQ',
      allowedUsers: ['openid-1', 'openid-2'],
      groupAllowedUsers: ['group-1'],
      allowedChannels: ['channel-1'],
      dmPolicy: 'allowlist',
      groupPolicy: 'allowlist',
      markdownSupport: true,
      source: 'config',
    });

    expect(
      C.resolveQQBotConfig(cfg, {
        QQ_APP_ID: 'env-app',
        QQ_CLIENT_SECRET: 'env-secret',
        QQBOT_API_BASE_URL: 'https://env-api.example.com',
        QQBOT_TOKEN_URL: 'https://env-token.example.com/token',
        QQ_PORTAL_HOST: 'sandbox.q.qq.com',
        QQBOT_HOME_CHANNEL: 'group/env-group',
        QQBOT_HOME_CHANNEL_NAME: 'Env QQ',
        QQ_ALLOWED_USERS: 'env-user,env-user-2',
        QQ_GROUP_ALLOWED_USERS: 'env-group',
        QQBOT_ALLOWED_CHANNELS: 'env-channel',
        QQ_ALLOW_ALL_USERS: 'true',
        QQ_DM_POLICY: 'open',
        QQ_GROUP_POLICY: 'disabled',
        QQBOT_MARKDOWN_SUPPORT: 'true',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      appId: 'env-app',
      clientSecret: 'env-secret',
      apiBaseUrl: 'https://env-api.example.com',
      tokenUrl: 'https://env-token.example.com/token',
      portalHost: 'sandbox.q.qq.com',
      homeChannel: 'group/env-group',
      homeChannelName: 'Env QQ',
      allowedUsers: ['env-user', 'env-user-2'],
      groupAllowedUsers: ['env-group'],
      allowedChannels: ['env-channel'],
      allowAllUsers: true,
      dmPolicy: 'open',
      groupPolicy: 'disabled',
      markdownSupport: true,
      source: 'env',
    });

    expect(C.redactGatewayConfig(cfg).qqbot).toMatchObject({
      clientSecret: '<secret:QQ_CLIENT_SECRET>',
    });
  });

  it('persists, resolves, and redacts Matrix gateway config', async () => {
    await C.patchGatewayConfig({
      matrix: {
        enabled: true,
        homeserver: ' https://matrix.example.org/ ',
        accessToken: 'matrix-token',
        userId: ' @sanook:matrix.example.org ',
        password: 'matrix-password',
        homeRoom: ' !home:matrix.example.org ',
        homeRoomName: 'Owner Matrix',
        allowedUsers: [' @alice:matrix.org '],
        allowedRooms: [' !ops:matrix.example.org '],
        freeResponseRooms: [' !free:matrix.example.org '],
        requireMention: false,
        groupSessionsPerUser: false,
        autoJoin: false,
        pollTimeoutMs: 12345,
      },
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.matrix).toMatchObject({
      homeserver: 'https://matrix.example.org/',
      accessToken: 'matrix-token',
      userId: '@sanook:matrix.example.org',
      password: 'matrix-password',
      homeRoom: '!home:matrix.example.org',
      homeRoomName: 'Owner Matrix',
      allowedUsers: ['@alice:matrix.org'],
      allowedRooms: ['!ops:matrix.example.org'],
      freeResponseRooms: ['!free:matrix.example.org'],
      requireMention: false,
      groupSessionsPerUser: false,
      autoJoin: false,
      pollTimeoutMs: 12345,
    });

    expect(C.resolveMatrixConfig(cfg, {} as NodeJS.ProcessEnv)).toMatchObject({
      homeserver: 'https://matrix.example.org',
      accessToken: 'matrix-token',
      userId: '@sanook:matrix.example.org',
      password: 'matrix-password',
      homeRoom: '!home:matrix.example.org',
      homeRoomName: 'Owner Matrix',
      allowedUsers: ['@alice:matrix.org'],
      allowedRooms: ['!ops:matrix.example.org'],
      freeResponseRooms: ['!free:matrix.example.org'],
      requireMention: false,
      groupSessionsPerUser: false,
      autoJoin: false,
      pollTimeoutMs: 12345,
      source: 'config',
    });

    expect(
      C.resolveMatrixConfig(cfg, {
        MATRIX_HOMESERVER: 'https://env-matrix.example.org/',
        MATRIX_ACCESS_TOKEN: 'env-matrix-token',
        MATRIX_USER_ID: '@envbot:matrix.org',
        MATRIX_PASSWORD: 'env-password',
        MATRIX_HOME_ROOM: '!envhome:matrix.org',
        MATRIX_HOME_ROOM_NAME: 'Env Matrix',
        MATRIX_ALLOWED_USERS: '@alice:matrix.org,@bob:matrix.org',
        MATRIX_ALLOWED_ROOMS: '!ops:matrix.org,!alerts:matrix.org',
        MATRIX_FREE_RESPONSE_ROOMS: '!free:matrix.org',
        MATRIX_ALLOW_ALL_USERS: 'true',
        MATRIX_REQUIRE_MENTION: 'true',
        MATRIX_GROUP_SESSIONS_PER_USER: 'true',
        MATRIX_AUTO_JOIN: 'true',
        MATRIX_POLL_TIMEOUT_MS: '45000',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      homeserver: 'https://env-matrix.example.org',
      accessToken: 'env-matrix-token',
      userId: '@envbot:matrix.org',
      password: 'env-password',
      homeRoom: '!envhome:matrix.org',
      homeRoomName: 'Env Matrix',
      allowedUsers: ['@alice:matrix.org', '@bob:matrix.org'],
      allowedRooms: ['!ops:matrix.org', '!alerts:matrix.org'],
      freeResponseRooms: ['!free:matrix.org'],
      allowAllUsers: true,
      requireMention: true,
      groupSessionsPerUser: true,
      autoJoin: true,
      pollTimeoutMs: 45000,
      source: 'env',
    });

    expect(C.redactGatewayConfig(cfg).matrix).toMatchObject({
      accessToken: '<secret:MATRIX_ACCESS_TOKEN>',
      password: '<secret:MATRIX_PASSWORD>',
    });
  });

  it('persists, resolves, and redacts Feishu/Lark gateway config', async () => {
    await C.patchGatewayConfig({
      feishu: {
        enabled: true,
        domain: 'lark',
        baseUrl: ' https://open.larksuite.com/ ',
        appId: ' cli_lark ',
        appSecret: 'lark-secret',
        verificationToken: 'lark-verify',
        encryptKey: 'lark-encrypt',
        homeChannel: ' oc_home ',
        homeChannelName: 'Owner Lark',
        allowedChats: [' oc_ops '],
        allowAllChats: false,
        allowedUsers: [' ou_user '],
        allowAllUsers: false,
      },
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.feishu).toMatchObject({
      domain: 'lark',
      baseUrl: 'https://open.larksuite.com/',
      appId: 'cli_lark',
      appSecret: 'lark-secret',
      verificationToken: 'lark-verify',
      encryptKey: 'lark-encrypt',
      homeChannel: 'oc_home',
      homeChannelName: 'Owner Lark',
      allowedChats: ['oc_ops'],
      allowedUsers: ['ou_user'],
    });

    expect(C.resolveFeishuConfig(cfg, {} as NodeJS.ProcessEnv)).toMatchObject({
      domain: 'lark',
      baseUrl: 'https://open.larksuite.com',
      appId: 'cli_lark',
      appSecret: 'lark-secret',
      verificationToken: 'lark-verify',
      encryptKey: 'lark-encrypt',
      homeChannel: 'oc_home',
      homeChannelName: 'Owner Lark',
      allowedChats: ['oc_ops'],
      allowedUsers: ['ou_user'],
      source: 'config',
    });

    expect(C.redactGatewayConfig(cfg).feishu).toMatchObject({
      appSecret: '<secret:FEISHU_APP_SECRET>',
      verificationToken: '<secret:FEISHU_VERIFICATION_TOKEN>',
      encryptKey: '<secret:FEISHU_ENCRYPT_KEY>',
    });
  });

  it('persists, resolves, and redacts BlueBubbles gateway config', async () => {
    await C.patchGatewayConfig({
      bluebubbles: {
        enabled: true,
        serverUrl: ' http://localhost:1234/ ',
        password: 'bluebubbles-secret',
        webhookHost: ' 127.0.0.1 ',
        webhookPort: 8645,
        webhookPath: ' bluebubbles-webhook ',
        homeChannel: ' user@example.com ',
        homeChannelName: 'Owner iMessage',
        allowedUsers: [' user@example.com ', '+15551234567'],
        requireMention: true,
        mentionPatterns: ['(?i)^amos\\b'],
        sendReadReceipts: false,
      },
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.bluebubbles).toMatchObject({
      serverUrl: 'http://localhost:1234/',
      password: 'bluebubbles-secret',
      webhookHost: '127.0.0.1',
      webhookPort: 8645,
      webhookPath: 'bluebubbles-webhook',
      homeChannel: 'user@example.com',
      allowedUsers: ['user@example.com', '+15551234567'],
      mentionPatterns: ['(?i)^amos\\b'],
      sendReadReceipts: false,
    });

    expect(C.resolveBlueBubblesConfig(cfg, {} as NodeJS.ProcessEnv)).toMatchObject({
      serverUrl: 'http://localhost:1234/',
      password: 'bluebubbles-secret',
      webhookHost: '127.0.0.1',
      webhookPort: 8645,
      webhookPath: 'bluebubbles-webhook',
      homeChannel: 'user@example.com',
      homeChannelName: 'Owner iMessage',
      allowedUsers: ['user@example.com', '+15551234567'],
      requireMention: true,
      mentionPatterns: ['(?i)^amos\\b'],
      sendReadReceipts: false,
      source: 'config',
    });

    expect(
      C.resolveBlueBubblesConfig(cfg, {
        BLUEBUBBLES_SERVER_URL: 'http://env.local:1234',
        BLUEBUBBLES_PASSWORD: 'env-secret',
        BLUEBUBBLES_WEBHOOK_HOST: '0.0.0.0',
        BLUEBUBBLES_WEBHOOK_PORT: '9999',
        BLUEBUBBLES_WEBHOOK_PATH: '/env-hook',
        BLUEBUBBLES_HOME_CHANNEL: '+15550000000',
        BLUEBUBBLES_HOME_CHANNEL_NAME: 'Env iMessage',
        BLUEBUBBLES_ALLOWED_USERS: 'user@example.com,+15550000000',
        BLUEBUBBLES_ALLOW_ALL_USERS: 'true',
        BLUEBUBBLES_REQUIRE_MENTION: 'true',
        BLUEBUBBLES_MENTION_PATTERNS: '["(?i)^sanook\\\\b"]',
        BLUEBUBBLES_SEND_READ_RECEIPTS: 'true',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      serverUrl: 'http://env.local:1234',
      password: 'env-secret',
      webhookHost: '0.0.0.0',
      webhookPort: 9999,
      webhookPath: '/env-hook',
      homeChannel: '+15550000000',
      homeChannelName: 'Env iMessage',
      allowedUsers: ['user@example.com', '+15550000000'],
      allowAllUsers: true,
      requireMention: true,
      mentionPatterns: ['(?i)^sanook\\b'],
      sendReadReceipts: true,
      source: 'env',
    });

    expect(C.redactGatewayConfig(cfg).bluebubbles).toMatchObject({
      password: '<secret:BLUEBUBBLES_PASSWORD>',
    });
  });
});
