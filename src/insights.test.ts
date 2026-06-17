import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('local insights', () => {
  let home: string;
  let realHome: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    realHome = process.env.HOME;
    home = await mkdtemp(join(tmpdir(), 'sanook-insights-'));
    process.env.HOME = home;
  });

  afterEach(async () => {
    vi.resetModules();
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    await rm(home, { recursive: true, force: true });
  });

  it('summarizes saved CLI and gateway sessions', async () => {
    const { saveSession } = await import('./session.js');
    const { saveGatewaySession, gatewaySessionId } = await import('./gateway/session.js');
    const { renderInsights } = await import('./insights.js');
    const cwd = join(home, 'project');

    await saveSession({
      id: 'cli-session',
      created: '2026-06-17T00:00:00.000Z',
      updated: new Date().toISOString(),
      model: 'sonnet',
      cwd,
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
    });
    await saveGatewaySession({
      id: gatewaySessionId('discord', 'chan-1'),
      platform: 'discord',
      target: 'chan-1',
      created: '2026-06-17T00:00:00.000Z',
      updated: new Date().toISOString(),
      model: 'openai:gpt-5.5',
      messages: [{ role: 'user', content: 'from gateway' }],
    });

    const report = await renderInsights({ days: 30, cwd });
    expect(report).toContain('sessions: 1');
    expect(report).toContain('gateway sessions: 1');
    expect(report).toContain('messages: 3');
    expect(report).toContain('sonnet');
    expect(report).toContain('openai:gpt-5.5');
  });

  it('filters CLI and gateway sessions outside the requested day window', async () => {
    const { saveSession } = await import('./session.js');
    const { saveGatewaySession, gatewaySessionId } = await import('./gateway/session.js');
    const { renderInsights } = await import('./insights.js');
    const cwd = join(home, 'project');
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    await saveSession({
      id: 'old-cli-session',
      created: old,
      updated: old,
      model: 'old-cli-model',
      cwd,
      messages: [{ role: 'user', content: 'old cli' }],
    });
    await saveSession({
      id: 'fresh-cli-session',
      created: '2026-06-17T00:00:00.000Z',
      updated: new Date().toISOString(),
      model: 'fresh-cli-model',
      cwd,
      messages: [{ role: 'user', content: 'fresh cli' }],
    });
    await saveGatewaySession({
      id: gatewaySessionId('discord', 'old-chan'),
      platform: 'discord',
      target: 'old-chan',
      created: old,
      updated: old,
      model: 'old-gateway-model',
      messages: [{ role: 'user', content: 'old gateway' }],
    });
    await saveGatewaySession({
      id: gatewaySessionId('discord', 'fresh-chan'),
      platform: 'discord',
      target: 'fresh-chan',
      created: '2026-06-17T00:00:00.000Z',
      updated: new Date().toISOString(),
      model: 'fresh-gateway-model',
      messages: [{ role: 'user', content: 'fresh gateway' }],
    });

    const report = await renderInsights({ days: 30, cwd });
    expect(report).toContain('sessions: 1');
    expect(report).toContain('gateway sessions: 1');
    expect(report).toContain('messages: 2');
    expect(report).toContain('fresh-cli-model');
    expect(report).toContain('fresh-gateway-model');
    expect(report).not.toContain('old-cli-model');
    expect(report).not.toContain('old-gateway-model');
  });

  it('skips malformed saved sessions instead of failing the report', async () => {
    const { saveSession, sessionStorePath } = await import('./session.js');
    const { renderInsights } = await import('./insights.js');
    const cwd = join(home, 'project');

    await mkdir(sessionStorePath(), { recursive: true });
    await writeFile(
      join(sessionStorePath(), 'bad.json'),
      JSON.stringify({
        id: 'bad-session',
        created: '2026-06-17T00:00:00.000Z',
        updated: new Date().toISOString(),
        model: 'sonnet',
        cwd,
        messages: { role: 'user', content: 'not an array' },
      }),
    );
    await saveSession({
      id: 'valid-session',
      created: '2026-06-17T00:00:00.000Z',
      updated: new Date().toISOString(),
      model: 'sonnet',
      cwd,
      messages: [{ role: 'user', content: 'hello' }],
    });

    const report = await renderInsights({ days: 30, cwd, includeGateway: false });
    expect(report).toContain('sessions: 1');
    expect(report).toContain('gateway sessions: 0');
    expect(report).toContain('messages: 1');
  });

  it('parses insights arguments consistently', async () => {
    const { parseInsightsArgs, parseInsightsDays } = await import('./insights-args.js');

    expect(parseInsightsDays('')).toBe(30);
    expect(parseInsightsDays('7')).toBe(7);
    expect(parseInsightsDays('--days 14')).toBe(14);
    expect(parseInsightsDays('--days=15')).toBe(15);
    expect(parseInsightsDays(['-d', '21'])).toBe(21);
    expect(parseInsightsDays(['-d=22'])).toBe(22);
    expect(parseInsightsDays('--days 0')).toBeNull();
    expect(parseInsightsDays('--days')).toBeNull();
    expect(parseInsightsDays('--days 7 junk')).toBeNull();
    expect(parseInsightsDays('7 junk')).toBeNull();
    expect(parseInsightsDays('nope')).toBeNull();

    expect(parseInsightsArgs('')).toEqual({ days: 30, all: false });
    expect(parseInsightsArgs('--all')).toEqual({ days: 30, all: true });
    expect(parseInsightsArgs('--days 7 --all')).toEqual({ days: 7, all: true });
    expect(parseInsightsArgs('--all -d 14')).toEqual({ days: 14, all: true });
    expect(parseInsightsArgs(['-a', '21'])).toEqual({ days: 21, all: true });
    expect(parseInsightsArgs('--all nope')).toBeNull();
  });
});
