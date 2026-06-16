import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('support dump', () => {
  let home: string;
  let realHome: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    realHome = process.env.HOME;
    home = await mkdtemp(join(tmpdir(), 'sanook-dump-'));
    process.env.HOME = home;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(async () => {
    vi.resetModules();
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    delete process.env.OPENAI_API_KEY;
    await rm(home, { recursive: true, force: true });
  });

  it('summarizes runtime state without printing raw secrets', async () => {
    const rawKey = 'sk-test1234567890abcdef';
    const rawTelegram = '1234567890:ABCsecret-token';
    const rawLineToken = 'line-token-secret-1234567890';
    const rawTwilioToken = 'twilio-token-secret-1234567890';
    const rawNtfyToken = 'ntfy-token-secret-1234567890';
    const rawMattermostToken = 'mattermost-token-secret-1234567890';
    const rawHassToken = 'hass-token-secret-1234567890';
    const rawWebhookSecret = 'webhook-secret-1234567890';
    const rawSignalAccount = '+16660000000';
    const rawSignalHome = '+16661234567';
    const rawWhatsAppToken = 'EAA-whatsapp-token-secret-1234567890';
    const rawWhatsAppSecret = 'whatsapp-app-secret-1234567890';
    const rawWhatsAppVerify = 'whatsapp-verify-token-1234567890';
    const rawWhatsAppHome = '17771234567';
    const rawMatrixToken = 'matrix-access-token-secret-1234567890';
    const rawMatrixPassword = 'matrix-password-secret-1234567890';
    const rawFeishuSecret = 'feishu-app-secret-1234567890';
    const rawFeishuVerify = 'feishu-verify-token-1234567890';
    const rawFeishuEncrypt = 'feishu-encrypt-key-1234567890';
    const rawDingTalkSecret = 'dingtalk-client-secret-1234567890';
    const rawDingTalkWebhook = 'https://oapi.dingtalk.com/robot/send?access_token=raw-secret';
    const rawDingTalkWebhookSecret = 'dingtalk-webhook-secret-1234567890';
    const rawGoogleChatServiceAccount = '/secret/google-chat-sa.json';
    const rawGoogleChatWebhook = 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=raw-secret&token=raw-token';
    const rawTeamsWebhook = 'https://example.webhook.office.com/webhookb2/raw-secret';
    const rawTeamsGraphToken = 'teams-graph-token-secret-1234567890';
    const rawTeamsClientSecret = 'teams-client-secret-1234567890';
    const project = join(home, 'project');
    await mkdir(join(home, '.sanook', 'gateway'), { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(
      join(home, '.sanook', 'config.json'),
      JSON.stringify({ model: 'openai:gpt-5.3-codex', brainPath: join(home, 'Brain') }, null, 2),
    );
    await writeFile(join(home, '.sanook', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: rawKey }, null, 2));
    await writeFile(
      join(home, '.sanook', 'gateway', 'config.json'),
      JSON.stringify(
        {
          telegram: { botToken: rawTelegram, allowedChatIds: [12345] },
          line: { channelAccessToken: rawLineToken, homeChannel: 'U1234567890abcdef' },
          sms: { accountSid: 'AC123', authToken: rawTwilioToken, phoneNumber: '+15550000000', homeChannel: '+15551234567' },
          ntfy: { topic: 'sanook-topic', token: rawNtfyToken, homeChannel: 'sanook-topic', allowedUsers: ['sanook-topic'] },
          mattermost: {
            serverUrl: 'https://mm.example.com',
            token: rawMattermostToken,
            homeChannel: 'chan-home',
            allowedUsers: ['user-1'],
            allowedChannels: ['chan-home'],
          },
          homeassistant: {
            url: 'http://ha.local:8123',
            token: rawHassToken,
            homeChannel: 'sanook_agent',
            watchDomains: ['light'],
            watchEntities: ['sensor.temp'],
            ignoreEntities: ['sensor.noisy'],
          },
          signal: { httpUrl: 'http://127.0.0.1:8080', account: rawSignalAccount, homeChannel: rawSignalHome, allowedUsers: [rawSignalHome] },
          whatsapp: {
            phoneNumberId: '123456789012345',
            accessToken: rawWhatsAppToken,
            appSecret: rawWhatsAppSecret,
            verifyToken: rawWhatsAppVerify,
            homeChannel: rawWhatsAppHome,
            allowedUsers: [rawWhatsAppHome],
          },
          matrix: {
            homeserver: 'https://matrix.example.org',
            accessToken: rawMatrixToken,
            userId: '@sanook:matrix.example.org',
            password: rawMatrixPassword,
            homeRoom: '!home:matrix.example.org',
            allowedUsers: ['@alice:matrix.org'],
          },
          feishu: {
            domain: 'feishu',
            appId: 'cli_app',
            appSecret: rawFeishuSecret,
            verificationToken: rawFeishuVerify,
            encryptKey: rawFeishuEncrypt,
            homeChannel: 'oc_home',
            allowedChats: ['oc_home'],
            allowedUsers: ['ou_user'],
          },
          dingtalk: {
            clientId: 'ding-client',
            clientSecret: rawDingTalkSecret,
            robotCode: 'ding-robot',
            webhookUrl: rawDingTalkWebhook,
            webhookSecret: rawDingTalkWebhookSecret,
            homeChannel: 'cid-home',
            allowedUsers: ['manager'],
            allowedChats: ['cid-home'],
          },
          googleChat: {
            projectId: 'project-1',
            subscriptionName: 'projects/project-1/subscriptions/hermes-chat-events-sub',
            serviceAccountJson: rawGoogleChatServiceAccount,
            incomingWebhookUrl: rawGoogleChatWebhook,
            homeChannel: 'spaces/AAAA',
            allowedUsers: ['owner@example.com'],
            allowedSpaces: ['spaces/AAAA'],
            freeResponseSpaces: ['spaces/FREE'],
          },
          teams: {
            deliveryMode: 'graph',
            incomingWebhookUrl: rawTeamsWebhook,
            graphAccessToken: rawTeamsGraphToken,
            chatId: '19:chat@thread.v2',
            clientId: 'teams-client-id',
            clientSecret: rawTeamsClientSecret,
            tenantId: 'teams-tenant-id',
            allowedUsers: ['alice@example.com'],
          },
          webhooks: { enabled: true, secret: rawWebhookSecret, routes: { issues: { secret: rawWebhookSecret, deliver: 'log' } } },
        },
        null,
        2,
      ),
    );

    const { buildSupportDump } = await import('./support-dump.js');
    const out = await buildSupportDump({
      showKeys: true,
      version: '9.9.9',
      packageName: 'sanook-cli-test',
      cwd: project,
      env: {},
    });

    expect(out).toContain('Sanook support dump');
    expect(out).toContain('version: 9.9.9');
    expect(out).toContain('package: sanook-cli-test');
    expect(out).toContain('model: openai:gpt-5.3-codex');
    expect(out).toContain('openai');
    expect(out).toContain('stored in auth.json');
    expect(out).toContain('OPENAI_API_KEY=sk-t…ef');
    expect(out).toContain('telegram: configured via config');
    expect(out).toContain('line: configured via config');
    expect(out).toContain('sms: configured via config');
    expect(out).toContain('ntfy: configured via config');
    expect(out).toContain('mattermost: configured via config');
    expect(out).toContain('homeassistant: configured via config');
    expect(out).toContain('watchDomains=1');
    expect(out).toContain('watchEntities=1');
    expect(out).toContain('signal: configured via config');
    expect(out).toContain('account=+166…0000');
    expect(out).toContain('home=+166…4567');
    expect(out).toContain('whatsapp: configured via config');
    expect(out).toContain('home=1777…4567');
    expect(out).toContain('matrix: configured via config');
    expect(out).toContain('token=yes');
    expect(out).toContain('password=yes');
    expect(out).toContain('feishu: configured via config');
    expect(out).toContain('appId=yes');
    expect(out).toContain('secret=yes');
    expect(out).toContain('dingtalk: configured via config');
    expect(out).toContain('robot=yes');
    expect(out).toContain('webhook=yes');
    expect(out).toContain('webhookSecret=yes');
    expect(out).toContain('googlechat: configured via config');
    expect(out).toContain('serviceAccount=yes');
    expect(out).toContain('allowedSpaces=1');
    expect(out).toContain('teams: configured via config');
    expect(out).toContain('mode=graph');
    expect(out).toContain('graphToken=yes');
    expect(out).toContain('webhooks: enabled via config');
    expect(out).not.toContain(rawKey);
    expect(out).not.toContain(rawTelegram);
    expect(out).not.toContain(rawLineToken);
    expect(out).not.toContain(rawTwilioToken);
    expect(out).not.toContain(rawNtfyToken);
    expect(out).not.toContain(rawMattermostToken);
    expect(out).not.toContain(rawHassToken);
    expect(out).not.toContain(rawWebhookSecret);
    expect(out).not.toContain(rawSignalAccount);
    expect(out).not.toContain(rawSignalHome);
    expect(out).not.toContain(rawWhatsAppToken);
    expect(out).not.toContain(rawWhatsAppSecret);
    expect(out).not.toContain(rawWhatsAppVerify);
    expect(out).not.toContain(rawWhatsAppHome);
    expect(out).not.toContain(rawMatrixToken);
    expect(out).not.toContain(rawMatrixPassword);
    expect(out).not.toContain(rawFeishuSecret);
    expect(out).not.toContain(rawFeishuVerify);
    expect(out).not.toContain(rawFeishuEncrypt);
    expect(out).not.toContain(rawDingTalkSecret);
    expect(out).not.toContain(rawDingTalkWebhook);
    expect(out).not.toContain(rawDingTalkWebhookSecret);
    expect(out).not.toContain(rawGoogleChatServiceAccount);
    expect(out).not.toContain(rawGoogleChatWebhook);
    expect(out).not.toContain(rawTeamsWebhook);
    expect(out).not.toContain(rawTeamsGraphToken);
    expect(out).not.toContain(rawTeamsClientSecret);
  });
});
