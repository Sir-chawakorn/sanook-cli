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
    const rawWebhookSecret = 'webhook-secret-1234567890';
    const rawSignalAccount = '+16660000000';
    const rawSignalHome = '+16661234567';
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
          signal: { httpUrl: 'http://127.0.0.1:8080', account: rawSignalAccount, homeChannel: rawSignalHome, allowedUsers: [rawSignalHome] },
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
    expect(out).toContain('signal: configured via config');
    expect(out).toContain('account=+166…0000');
    expect(out).toContain('home=+166…4567');
    expect(out).toContain('webhooks: enabled via config');
    expect(out).not.toContain(rawKey);
    expect(out).not.toContain(rawTelegram);
    expect(out).not.toContain(rawLineToken);
    expect(out).not.toContain(rawTwilioToken);
    expect(out).not.toContain(rawNtfyToken);
    expect(out).not.toContain(rawWebhookSecret);
    expect(out).not.toContain(rawSignalAccount);
    expect(out).not.toContain(rawSignalHome);
  });
});
