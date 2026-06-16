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

  it('persists and redacts Discord, Slack, and Email gateway config', async () => {
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
    });

    const cfg = await C.readGatewayConfig();
    expect(cfg.discord?.defaultChannelId).toBe('111111111111111111');
    expect(cfg.slack?.defaultChannelId).toBe('C01ABC');
    expect(cfg.email?.allowedUsers).toEqual(['owner@example.com']);
    expect(C.redactGatewayConfig(cfg).discord?.botToken).toBe('<secret:DISCORD_BOT_TOKEN>');
    expect(C.redactGatewayConfig(cfg).slack?.botToken).toBe('<secret:SLACK_BOT_TOKEN>');
    expect(C.redactGatewayConfig(cfg).slack?.appToken).toBe('<secret:SLACK_APP_TOKEN>');
    expect(C.redactGatewayConfig(cfg).email?.password).toBe('<secret:EMAIL_PASSWORD>');
  });

  it('env Discord, Slack, and Email settings override persisted messaging config', () => {
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
  });
});
