import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CostMeter, Usage } from './cost.js';
import { appHomePath, BRAND, usageLedgerEnabled } from './brand.js';

export type UsageSource = 'repl' | 'headless' | 'gateway' | 'subagent' | 'plan';

export interface UsageEvent {
  id: string;
  ts: string;
  date: string;
  sessionId?: string;
  source: UsageSource;
  model: string;
  cwd?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number | null;
  priced: boolean;
}

export interface RecordAgentUsageOptions {
  model: string;
  cost: CostMeter;
  source?: UsageSource;
  sessionId?: string;
  cwd?: string;
}

const USAGE_DIR_NAME = 'usage';

export function usageDirPath(): string {
  return appHomePath(USAGE_DIR_NAME);
}

export function usageEventsPath(): string {
  return join(usageDirPath(), 'events.jsonl');
}

function localDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Parse Codex JSONL turn.completed usage payloads into AI SDK Usage shape. */
export function usageFromCodexPayload(raw: unknown): Usage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const input = num(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? u.promptTokens);
  const output = num(u.output_tokens ?? u.outputTokens ?? u.completion_tokens ?? u.completionTokens);
  const cacheRead = num(
    u.cache_read_input_tokens ?? u.cached_input_tokens ?? u.cacheReadInputTokens ?? u.cachedInputTokens,
  );
  if (!input && !output && !cacheRead) return null;
  return { inputTokens: input, outputTokens: output, cachedInputTokens: cacheRead };
}

export async function appendUsageEvent(event: UsageEvent): Promise<void> {
  if (!usageLedgerEnabled()) return;
  await mkdir(usageDirPath(), { recursive: true });
  await appendFile(usageEventsPath(), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

export function recordAgentUsage(options: RecordAgentUsageOptions): void {
  if (!usageLedgerEnabled()) return;
  const snap = options.cost.snapshot();
  const ts = new Date().toISOString();
  const event: UsageEvent = {
    id: randomUUID(),
    ts,
    date: localDate(ts),
    sessionId: options.sessionId,
    source: options.source ?? 'headless',
    model: options.model,
    cwd: options.cwd,
    inputTokens: snap.inputTokens,
    outputTokens: snap.outputTokens,
    cacheReadTokens: snap.cacheReadTokens,
    cacheWriteTokens: snap.cacheWriteTokens,
    totalTokens: snap.totalTokens,
    costUsd: snap.hasPricing ? snap.costUsd : null,
    priced: snap.hasPricing,
  };
  void appendUsageEvent(event).catch(() => {});
}

export async function loadUsageEvents(options: { since?: string; until?: string } = {}): Promise<UsageEvent[]> {
  let raw = '';
  try {
    raw = await readFile(usageEventsPath(), 'utf8');
  } catch {
    return [];
  }
  const since = options.since;
  const until = options.until;
  const out: UsageEvent[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as UsageEvent;
      if (!parsed?.ts || typeof parsed.model !== 'string') continue;
      const date = parsed.date || localDate(parsed.ts);
      if (since && date < since) continue;
      if (until && date > until) continue;
      out.push({ ...parsed, date });
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export interface UsageAggregateRow {
  key: string;
  label: string;
  models: string[];
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
}

function mergeModels(map: Map<string, number>, model: string): void {
  const label = model.includes(':') ? model.split(':').slice(1).join(':') : model;
  map.set(label, (map.get(label) ?? 0) + 1);
}

function topModels(map: Map<string, number>): string[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([model]) => `• ${model}`);
}

function weekKey(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return localDate(d.toISOString());
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function aggregateUsageEvents(
  events: UsageEvent[],
  mode: 'daily' | 'weekly' | 'monthly' | 'session',
): UsageAggregateRow[] {
  const groups = new Map<string, { models: Map<string, number>; events: UsageEvent[] }>();
  for (const event of events) {
    const key =
      mode === 'daily'
        ? event.date
        : mode === 'weekly'
          ? weekKey(event.date)
          : mode === 'monthly'
            ? monthKey(event.date)
            : event.sessionId ?? `turn:${event.id}`;
    const bucket = groups.get(key) ?? { models: new Map<string, number>(), events: [] as UsageEvent[] };
    mergeModels(bucket.models, event.model);
    bucket.events.push(event);
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, bucket]) => {
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let costUsd = 0;
      for (const event of bucket.events) {
        inputTokens += event.inputTokens;
        outputTokens += event.outputTokens;
        cacheReadTokens += event.cacheReadTokens;
        cacheWriteTokens += event.cacheWriteTokens;
        costUsd += event.costUsd ?? 0;
      }
      const label =
        mode === 'session'
          ? key.startsWith('turn:')
            ? `${key.slice(5, 18)}…`
            : key.slice(0, 24)
          : key;
      return {
        key,
        label,
        models: topModels(bucket.models),
        turns: bucket.events.length,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
        costUsd,
      };
    });
}

export function formatUsageLedgerHint(): string {
  return `ดูประวัติ token ทั้งหมด: ${BRAND.cliName} usage daily`;
}
