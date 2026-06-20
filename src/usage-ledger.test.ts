import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CostMeter } from './cost.js';
import {
  aggregateUsageEvents,
  appendUsageEvent,
  loadUsageEvents,
  recordAgentUsage,
  usageFromCodexPayload,
} from './usage-ledger.js';

describe('usage ledger', () => {
  let home: string;

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { force: true, recursive: true });
  });

  it('records agent turns to JSONL under ~/.sanook/usage', async () => {
    home = mkdtempSync(join(tmpdir(), 'sanook-usage-'));
    vi.stubEnv('HOME', home);
    const meter = new CostMeter('anthropic:claude-sonnet-4-6');
    meter.add({ inputTokens: 120, outputTokens: 45, cachedInputTokens: 10 }, 5);
    recordAgentUsage({ model: 'sonnet', cost: meter, source: 'repl', sessionId: 'sess-1', cwd: home });
    await new Promise((r) => setTimeout(r, 20));
    const events = await loadUsageEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.sessionId).toBe('sess-1');
    expect(events[0]?.inputTokens).toBe(105);
    expect(events[0]?.outputTokens).toBe(45);
    expect(events[0]?.cacheReadTokens).toBe(10);
    expect(events[0]?.cacheWriteTokens).toBe(5);
  });

  it('aggregates daily rows like ccusage', async () => {
    home = mkdtempSync(join(tmpdir(), 'sanook-usage-'));
    vi.stubEnv('HOME', home);
    await appendUsageEvent({
      id: 'a',
      ts: '2026-06-20T10:00:00.000Z',
      date: '2026-06-20',
      source: 'repl',
      model: 'anthropic:sonnet',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
      costUsd: 0.01,
      priced: true,
    });
    await appendUsageEvent({
      id: 'b',
      ts: '2026-06-21T10:00:00.000Z',
      date: '2026-06-21',
      source: 'headless',
      model: 'codex:gpt-5.5',
      inputTokens: 200,
      outputTokens: 80,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 280,
      costUsd: null,
      priced: false,
    });
    const rows = aggregateUsageEvents(await loadUsageEvents(), 'daily');
    expect(rows).toHaveLength(2);
    const codexRow = rows.find((row) => row.key === '2026-06-21');
    expect(codexRow?.models.join(' ')).toContain('gpt-5.5');
  });

  it('parses codex turn.completed usage payloads', () => {
    expect(
      usageFromCodexPayload({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 }),
    ).toEqual({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 5 });
  });
});
