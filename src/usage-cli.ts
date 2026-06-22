import { BRAND } from './brand.js';
import { takeValue } from './cli-option-values.js';
import { aggregateUsageEvents, loadUsageEvents, usageEventsPath, type UsageAggregateRow } from './usage-ledger.js';

export type UsageReportMode = 'daily' | 'weekly' | 'monthly' | 'session';

export interface ParsedUsageArgs {
  mode: UsageReportMode;
  since?: string;
  until?: string;
  days: number;
  json: boolean;
  noColor: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POSITIVE_INTEGER_RE = /^[1-9]\d*$/;

function isUsageDate(raw: string | undefined): raw is string {
  if (!raw || !DATE_RE.test(raw)) return false;
  const [year, month, day] = raw.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCFullYear(year);
  return d.toISOString().slice(0, 10) === raw;
}

function parsePositiveInteger(raw: string | undefined): number | undefined {
  if (!raw || !POSITIVE_INTEGER_RE.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

function shiftDaysFrom(anchor: string, days: number): string {
  const [year, month, day] = anchor.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function parseUsageArgs(args: string[]): ParsedUsageArgs | null {
  if (args.includes('-h') || args.includes('--help')) return null;
  let mode: UsageReportMode = 'daily';
  let since: string | undefined;
  let until: string | undefined;
  let days = 30;
  let json = false;
  let noColor = false;
  let sawSince = false;
  let sawUntil = false;
  let sawDays = false;

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '--no-color') noColor = true;
    else if (arg === '--since') {
      if (sawSince) return null;
      const picked = takeValue(args, i);
      if (!isUsageDate(picked.value)) return null;
      since = picked.value;
      sawSince = true;
      i = picked.nextIndex;
    } else if (arg.startsWith('--since=')) {
      if (sawSince) return null;
      since = arg.slice('--since='.length);
      if (!isUsageDate(since)) return null;
      sawSince = true;
    } else if (arg === '--until') {
      if (sawUntil) return null;
      const picked = takeValue(args, i);
      if (!isUsageDate(picked.value)) return null;
      until = picked.value;
      sawUntil = true;
      i = picked.nextIndex;
    } else if (arg.startsWith('--until=')) {
      if (sawUntil) return null;
      until = arg.slice('--until='.length);
      if (!isUsageDate(until)) return null;
      sawUntil = true;
    } else if (arg === '--days') {
      if (sawDays) return null;
      const picked = takeValue(args, i);
      const n = parsePositiveInteger(picked.value);
      if (n === undefined) return null;
      days = n;
      sawDays = true;
      i = picked.nextIndex;
    } else if (arg.startsWith('--days=')) {
      if (sawDays) return null;
      const n = parsePositiveInteger(arg.slice('--days='.length));
      if (n === undefined) return null;
      days = n;
      sawDays = true;
    } else if (!arg.startsWith('-')) positional.push(arg);
    else return null;
  }

  if (positional.length > 1) return null;
  if (positional[0]) {
    if (!['daily', 'weekly', 'monthly', 'session'].includes(positional[0])) return null;
    mode = positional[0] as UsageReportMode;
  }
  if (!until) until = new Date().toISOString().slice(0, 10);
  if (!since) since = shiftDaysFrom(until, days - 1);
  if (since > until) return null;
  return { mode, since, until, days, json, noColor };
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtCost(n: number): string {
  return n > 0 ? `$${n.toFixed(2)}` : '$0.00';
}

function renderTable(title: string, rows: UsageAggregateRow[], wide: boolean): string {
  if (!rows.length) {
    return [
      `╭${'─'.repeat(Math.max(42, title.length + 4))}╮`,
      `│ ${title.padEnd(Math.max(40, title.length + 2))} │`,
      `╰${'─'.repeat(Math.max(42, title.length + 4))}╯`,
      '',
      `(no usage recorded — run ${BRAND.cliName} and complete a turn first)`,
      `ledger: ${usageEventsPath()}`,
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push(`╭${'─'.repeat(title.length + 4)}╮`);
  lines.push(`│ ${title} │`);
  lines.push(`╰${'─'.repeat(title.length + 4)}╯`);
  lines.push('');

  if (wide) {
    lines.push(
      '┌────────────┬─────────┬──────────────────┬─────────┬─────────┬────────────┬────────────┐',
    );
    lines.push(
      '│ Period     │ Turns   │ Models           │ Input   │ Output  │ Cache R/W  │ Cost (USD) │',
    );
    lines.push(
      '├────────────┼─────────┼──────────────────┼─────────┼─────────┼────────────┼────────────┤',
    );
    for (const row of rows) {
      const models = row.models.join(' ').slice(0, 16).padEnd(16);
      const cache = `${fmt(row.cacheReadTokens)}/${fmt(row.cacheWriteTokens)}`.padStart(10);
      lines.push(
        `│ ${row.label.padEnd(10)} │ ${String(row.turns).padStart(7)} │ ${models} │ ${fmt(row.inputTokens).padStart(7)} │ ${fmt(row.outputTokens).padStart(7)} │ ${cache} │ ${fmtCost(row.costUsd).padStart(10)} │`,
      );
    }
    lines.push(
      '└────────────┴─────────┴──────────────────┴─────────┴─────────┴────────────┴────────────┘',
    );
  } else {
    lines.push('┌────────────┬──────────────────┬─────────┬─────────┬────────────┐');
    lines.push('│ Period     │ Models           │ Input   │ Output  │ Cost (USD) │');
    lines.push('├────────────┼──────────────────┼─────────┼─────────┼────────────┤');
    for (const row of rows) {
      const models = row.models.join(' ').slice(0, 16).padEnd(16);
      lines.push(
        `│ ${row.label.padEnd(10)} │ ${models} │ ${fmt(row.inputTokens).padStart(7)} │ ${fmt(row.outputTokens).padStart(7)} │ ${fmtCost(row.costUsd).padStart(10)} │`,
      );
    }
    lines.push('└────────────┴──────────────────┴─────────┴─────────┴────────────┘');
  }

  const totalCost = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const totalTokens = rows.reduce((sum, row) => sum + row.totalTokens, 0);
  lines.push('');
  lines.push(`totals: ${fmt(totalTokens)} tokens · ${fmtCost(totalCost)} estimated · ledger: ${usageEventsPath()}`);
  return lines.join('\n');
}

export async function renderUsageReport(options: ParsedUsageArgs): Promise<string> {
  const events = await loadUsageEvents({ since: options.since, until: options.until });
  const rows = aggregateUsageEvents(events, options.mode);
  if (options.json) {
    return JSON.stringify(
      {
        agent: BRAND.cliName,
        mode: options.mode,
        since: options.since,
        until: options.until,
        events: events.length,
        rows,
        ledger: usageEventsPath(),
      },
      null,
      2,
    );
  }
  const title =
    options.mode === 'daily'
      ? `${BRAND.productName} Usage Report — Daily`
      : options.mode === 'weekly'
        ? `${BRAND.productName} Usage Report — Weekly`
        : options.mode === 'monthly'
          ? `${BRAND.productName} Usage Report — Monthly`
          : `${BRAND.productName} Usage Report — Sessions`;
  const wide = (process.stdout.columns ?? 100) >= 100;
  return renderTable(title, rows, wide);
}

export function usageHelpText(): string {
  return [
    `ใช้: ${BRAND.cliName} usage [daily|weekly|monthly|session] [--days N] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json]`,
    '',
    'บันทึก token/cost ทุก agent turn ลง ~/.sanook/usage/events.jsonl (ccusage-style local ledger).',
    'ปิดได้ด้วย SANOOK_DISABLE_USAGE=1',
  ].join('\n');
}
