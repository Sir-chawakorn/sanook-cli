import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkGateway,
  formatGatewayDoctorReport,
  summarizeChannelHealth,
} from './doctor.js';
import { formatMobileChatReply } from './deliver.js';

const tempDirs: string[] = [];

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'sanook-gateway-doctor-'));
  tempDirs.push(dir);
  vi.stubEnv('HOME', dir);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('gateway doctor', () => {
  it('reports unconfigured gateway as a warning', async () => {
    const report = await checkGateway({ config: {}, skipNetwork: true });

    expect(report.ok).toBe(true);
    expect(report.checks.some((check) => check.id === 'gateway.configured' && check.status === 'warn')).toBe(true);
  });

  it('fails when Telegram allowlist is empty', async () => {
    const report = await checkGateway({
      config: { telegram: { botToken: '123:abc', allowedChatIds: [] } },
      skipNetwork: true,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'telegram', id: 'telegram.allowlist', status: 'fail' }),
      ]),
    );
  });

  it('validates Telegram token via getMe when network checks are enabled', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/getMe');
      return new Response(JSON.stringify({ ok: true, result: { username: 'sanook_bot' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const report = await checkGateway({
      config: { telegram: { botToken: '123:abc', allowedChatIds: [111] } },
      skipNetwork: false,
    });

    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ channel: 'telegram', id: 'telegram.token.live', status: 'pass' })]),
    );
  });

  it('flags invalid webhook URLs for LINE and WhatsApp', async () => {
    const report = await checkGateway({
      config: {
        line: { channelAccessToken: 'line-token', publicUrl: 'not-a-url', homeChannel: 'U123' },
        whatsapp: { phoneNumberId: '123', accessToken: 'wa-token', publicUrl: 'ftp://bad.example', homeChannel: '15551234567' },
      },
      skipNetwork: true,
    });

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'line', id: 'line.public_url', status: 'fail' }),
        expect.objectContaining({ channel: 'whatsapp', id: 'whatsapp.public_url', status: 'fail' }),
      ]),
    );
  });

  it('summarizes channel health with the worst status per channel', () => {
    const summary = summarizeChannelHealth([
      { id: 'a', channel: 'telegram', status: 'pass', message: 'ok' },
      { id: 'b', channel: 'telegram', status: 'fail', message: 'bad token' },
      { id: 'c', channel: 'slack', status: 'warn', message: 'missing app token' },
      { id: 'd', channel: 'discord', status: 'skip', message: 'not configured' },
    ]);

    expect(summary).toEqual([
      { channel: 'discord', status: 'skip' },
      { channel: 'slack', status: 'warn' },
      { channel: 'telegram', status: 'fail' },
    ]);
  });

  it('formats a readable doctor report', async () => {
    const report = await checkGateway({
      config: { telegram: { botToken: '123:abc', allowedChatIds: [111] } },
      skipNetwork: true,
    });
    const text = formatGatewayDoctorReport(report);

    expect(text).toContain('gateway doctor');
    expect(text).toContain('telegram/telegram.token');
  });
});

describe('gateway doctor task helpers', () => {
  it('lists queued cron jobs in run order', async () => {
    vi.resetModules();
    const ledger = await import('./ledger.js');
    await ledger.enqueueTask({ kind: 'cron', spec: 'later', schedule: 'every 1h', runAt: Date.now() + 60_000 });
    await ledger.enqueueTask({ kind: 'cron', spec: 'soon', schedule: 'every 30m', runAt: Date.now() + 1_000 });
    await ledger.enqueueTask({ kind: 'once', spec: 'one-shot', runAt: Date.now() });

    vi.resetModules();
    const { listPendingCronJobs: listPending } = await import('./doctor.js');
    const pending = await listPending();
    expect(pending.map((task) => task.spec)).toEqual(['soon', 'later']);
  });

  it('lists recent delivery failures from the task ledger', async () => {
    vi.resetModules();
    const ledger = await import('./ledger.js');
    const task = await ledger.enqueueTask({
      kind: 'cron',
      spec: 'deploy report',
      schedule: '09:00',
      deliver: 'telegram:111',
      runAt: Date.now(),
    });
    await ledger.updateTask(task.id, {
      status: 'failed',
      lastRun: Date.now(),
      lastError: 'Telegram sendMessage 403',
    });

    vi.resetModules();
    const { listRecentDeliveryFailures: listFailures } = await import('./doctor.js');
    const failures = await listFailures();
    expect(failures).toEqual([
      expect.objectContaining({
        taskId: task.id,
        deliver: 'telegram:111',
        error: 'Telegram sendMessage 403',
        status: 'failed',
      }),
    ]);
  });
});

describe('mobile chat reply formatting', () => {
  it('truncates long fenced code blocks', () => {
    const code = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const formatted = formatMobileChatReply(`Before\n\`\`\`ts\n${code}\n\`\`\`\nAfter`);

    expect(formatted).toContain('line 1');
    expect(formatted).toContain('truncated for mobile');
    expect(formatted).not.toContain('line 20');
    expect(formatted).toContain('After');
  });

  it('caps overall summary length', () => {
    const formatted = formatMobileChatReply('a'.repeat(4000), { maxSummaryChars: 100 });
    expect(formatted.length).toBeLessThan(200);
    expect(formatted).toContain('summary truncated for mobile');
  });
});
