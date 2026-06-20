import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { persistenceEnabled } from './brand.js';
import { normalize, consolidate, loadStore, saveStore } from './memory-store.js';
import { search, type SearchResult } from './search/engine.js';

export type BrainConsolidateStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface BrainConsolidateFinding {
  message: string;
  path?: string;
  details?: string[];
}

export interface BrainConsolidateStep {
  id: string;
  title: string;
  status: BrainConsolidateStatus;
  message: string;
  findings: BrainConsolidateFinding[];
  applied?: string[];
}

export interface BrainConsolidateReport {
  ok: boolean;
  brainPath?: string;
  dryRun: boolean;
  steps: BrainConsolidateStep[];
}

export interface BrainConsolidateOptions {
  brainPath?: string;
  nowMs?: number;
  apply?: boolean;
  archive?: boolean;
  memory?: boolean;
  runRetrieval?: boolean;
  searchImpl?: (query: string) => Promise<SearchResult>;
}

export interface ParsedBrainConsolidateArgs {
  apply: boolean;
  archive: boolean;
  memory: boolean;
  runRetrieval: boolean;
}

export type BrainConsolidateArgsResult =
  | { ok: true; value: ParsedBrainConsolidateArgs }
  | { ok: false; message: string };

const ARCHIVE_EXEMPT_PREFIXES = ['Shared/Core-Facts/', 'Shared/Archive/'];
const RETRIEVAL_CASES = [
  { id: 'RET-01', query: 'memory write protocol merge dont append', expectedPath: 'Shared/Rules/memory-write-protocol.md' },
  { id: 'RET-02', query: 'context assembly policy small context', expectedPath: 'Shared/Rules/context-assembly-policy.md' },
  { id: 'RET-03', query: 'quality ledger retrieval hit grounded', expectedPath: 'Evals/quality-ledger.md' },
];

export function parseBrainConsolidateArgs(args: string[]): BrainConsolidateArgsResult {
  let apply = false;
  let archive = false;
  let memory = false;
  let runRetrieval = true;
  for (const a of args) {
    if (a === '--apply') apply = true;
    else if (a === '--archive') archive = true;
    else if (a === '--memory') memory = true;
    else if (a === '--no-retrieval') runRetrieval = false;
    else return { ok: false, message: `ไม่รู้จัก option: ${a}` };
  }
  if (archive && !apply) return { ok: false, message: '--archive ต้องใช้ร่วมกับ --apply (destructive move ถามก่อน — default เป็น dry-run)' };
  return { ok: true, value: { apply, archive, memory, runRetrieval } };
}

function step(
  id: string,
  title: string,
  findings: BrainConsolidateFinding[],
  message: string,
  fail = false,
  applied?: string[],
): BrainConsolidateStep {
  const status: BrainConsolidateStatus = fail ? 'fail' : findings.length ? 'warn' : 'pass';
  return { id, title, status, message, findings, applied };
}

function sectionBullets(content: string, heading: string): string[] {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/.test(line.trim())) break;
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') && !trimmed.includes('_(')) out.push(trimmed);
  }
  return out;
}

function parseFrontmatterField(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim().replace(/^["']|["']$/g, '');
}

function parseIsoDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function listMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(abs: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === '.git' || entry.name === '.obsidian' || entry.name === 'node_modules') continue;
        await walk(join(abs, entry.name), childRel);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(childRel);
      }
    }
  }
  await walk(root, '');
  return out;
}

async function routeInboxStep(brainPath: string, apply: boolean): Promise<BrainConsolidateStep> {
  const path = join(brainPath, 'Shared', 'Memory-Inbox', 'memory-inbox.md');
  const content = await readText(path);
  if (!content) {
    return step('consolidate.inbox-route', 'Route Memory-Inbox', [{ message: 'Memory-Inbox file is missing.', path }], 'Memory-Inbox is missing.', true);
  }

  const candidates = sectionBullets(content, 'New Candidates');
  const needsMerge = sectionBullets(content, 'Needs Merge');
  const findings: BrainConsolidateFinding[] = [];
  const applied: string[] = [];

  if (needsMerge.length) {
    findings.push({
      message: `${needsMerge.length} item(s) waiting in Needs Merge — promote to durable or discard.`,
      path,
      details: needsMerge.slice(0, 15),
    });
  }

  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const candidate of candidates) {
    const key = normalize(candidate.replace(/^-\s*/, '').replace(/\s+/g, ' ')).trim();
    if (!key) continue;
    if (seen.has(key)) duplicates.push(candidate);
    else seen.set(key, candidate);
  }
  if (duplicates.length) {
    findings.push({ message: `${duplicates.length} duplicate candidate(s) in New Candidates.`, path, details: duplicates.slice(0, 15) });
    if (apply) {
      let next = content;
      for (const dup of duplicates) next = next.replace(`${dup}\n`, '');
      if (next !== content) {
        await writeFile(path, next);
        applied.push(`removed ${duplicates.length} exact duplicate inbox candidate(s)`);
      }
    }
  }

  if (candidates.length && !needsMerge.length && !duplicates.length) {
    findings.push({
      message: `${candidates.length} candidate(s) ready for routing (ADD/UPDATE/DELETE/NOOP).`,
      path,
      details: candidates.slice(0, 10),
    });
  }

  return step(
    'consolidate.inbox-route',
    'Route Memory-Inbox',
    findings,
    candidates.length ? `${candidates.length} inbox candidate(s) reviewed.` : 'Memory-Inbox has no active candidates.',
    false,
    applied.length ? applied : undefined,
  );
}

async function dedupMergeStep(brainPath: string): Promise<BrainConsolidateStep> {
  const path = join(brainPath, 'Shared', 'Memory-Inbox', 'memory-inbox.md');
  const content = await readText(path);
  const candidates = [...sectionBullets(content, 'New Candidates'), ...sectionBullets(content, 'Needs Merge')];
  const findings: BrainConsolidateFinding[] = [];
  const buckets = new Map<string, string[]>();
  for (const candidate of candidates) {
    const key = normalize(candidate.replace(/^-\s*/, '').replace(/\s+/g, ' ')).trim();
    if (!key) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }
  const overlaps = [...buckets.entries()].filter(([, items]) => items.length > 1);
  if (overlaps.length) {
    findings.push({
      message: `${overlaps.length} overlapping inbox group(s) need merge.`,
      path,
      details: overlaps.slice(0, 10).map(([key, items]) => `${key} (${items.length}x)`),
    });
  }
  return step('consolidate.dedup-merge', 'Dedup + merge inbox', findings, 'Inbox overlap scan complete.');
}

async function staleArchiveStep(brainPath: string, nowMs: number, apply: boolean, archive: boolean): Promise<BrainConsolidateStep> {
  const findings: BrainConsolidateFinding[] = [];
  const applied: string[] = [];
  const candidates: string[] = [];

  for (const rel of await listMarkdown(brainPath)) {
    if (ARCHIVE_EXEMPT_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    const abs = join(brainPath, rel);
    const content = await readText(abs);
    const staleAfter = parseFrontmatterField(content, 'stale_after');
    const staleMs = parseIsoDate(staleAfter);
    if (staleMs === undefined || staleMs > nowMs) continue;
    candidates.push(rel);
    findings.push({ message: `Stale candidate: stale_after=${staleAfter}`, path: abs });
  }

  if (archive && apply) {
    await mkdir(join(brainPath, 'Shared', 'Archive'), { recursive: true });
    for (const rel of candidates) {
      const src = join(brainPath, rel);
      const dest = join(brainPath, 'Shared', 'Archive', rel.split('/').pop()!);
      await rename(src, dest);
      applied.push(`archived ${rel} → Shared/Archive/${rel.split('/').pop()}`);
    }
  } else if (candidates.length) {
    findings.unshift({
      message: `${candidates.length} note(s) past stale_after — dry-run only; rerun with --apply --archive to move into Shared/Archive.`,
    });
  }

  return step(
    'consolidate.stale-archive',
    'Stale → Archive',
    findings,
    candidates.length ? `${candidates.length} stale note(s) flagged.` : 'No stale notes flagged.',
    false,
    applied.length ? applied : undefined,
  );
}

async function patternPromoteStep(brainPath: string): Promise<BrainConsolidateStep> {
  const inboxPath = join(brainPath, 'Shared', 'Memory-Inbox', 'memory-inbox.md');
  const candidates = sectionBullets(await readText(inboxPath), 'New Candidates');
  const findings: BrainConsolidateFinding[] = [];
  const markdown = await listMarkdown(brainPath);
  const corpusParts: string[] = [];
  for (const rel of markdown.slice(0, 200)) {
    const text = await readText(join(brainPath, rel));
    if (text) corpusParts.push(normalize(text));
  }
  const corpus = corpusParts.join('\n');

  for (const candidate of candidates) {
    const phrase = normalize(candidate.replace(/^-\s*/, '').replace(/\s+/g, ' ')).trim();
    if (phrase.length < 12) continue;
    const tokens = phrase.split(/\s+/).filter((t) => t.length > 3).slice(0, 4);
    if (tokens.length < 2) continue;
    const hits = tokens.filter((token) => corpus.includes(token)).length;
    if (hits >= 3 || (tokens.length >= 2 && hits === tokens.length && corpus.includes(phrase.slice(0, 20)))) {
      findings.push({
        message: `Possible recurring pattern (≥3 signals): "${phrase.slice(0, 80)}"`,
        path: inboxPath,
        details: ['Consider promoting to Playbooks/ or Distillations/ after review.'],
      });
    }
  }

  return step(
    'consolidate.pattern-promote',
    'Pattern → promote',
    findings,
    findings.length ? `${findings.length} pattern candidate(s) found.` : 'No recurring patterns detected in inbox.',
  );
}

async function retrievalCheckStep(
  runRetrieval: boolean,
  searchImpl: (query: string) => Promise<SearchResult>,
): Promise<BrainConsolidateStep> {
  if (!runRetrieval) {
    return { id: 'consolidate.retrieval-check', title: 'Retrieval check', status: 'skipped', message: 'Skipped (--no-retrieval).', findings: [] };
  }

  const findings: BrainConsolidateFinding[] = [];
  for (const item of RETRIEVAL_CASES) {
    const res = await searchImpl(item.query);
    const hit = res.hits.find((candidate) => candidate.path === item.expectedPath);
    if (!hit) {
      findings.push({
        message: `${item.id} miss: query did not return ${item.expectedPath}`,
        details: [`query="${item.query}"`, ...res.hits.slice(0, 3).map((h) => `got: ${h.path ?? h.snippet.slice(0, 60)}`)],
      });
    }
  }

  return step(
    'consolidate.retrieval-check',
    'Retrieval check',
    findings,
    findings.length ? `${findings.length} retrieval miss(es).` : 'Retrieval eval cases passed.',
    false,
  );
}

async function memoryConsolidateStep(apply: boolean, memory: boolean, nowMs: number): Promise<BrainConsolidateStep> {
  if (!memory) {
    return { id: 'consolidate.auto-memory', title: 'Auto-memory consolidate', status: 'skipped', message: 'Skipped (pass --memory to consolidate ~/.sanook memory store).', findings: [] };
  }
  if (!persistenceEnabled()) {
    return step('consolidate.auto-memory', 'Auto-memory consolidate', [{ message: 'Persistence is disabled (SANOOK_DISABLE_PERSISTENCE).' }], 'Auto-memory consolidate skipped.', false);
  }

  const store = await loadStore();
  const { store: next, report } = consolidate(store, nowMs);
  const findings: BrainConsolidateFinding[] = [];
  if (report.archived.length) findings.push({ message: `Would archive ${report.archived.length} auto-memory fact(s).`, details: report.archived.slice(0, 10) });
  if (report.merged.length) findings.push({ message: `Merged ${report.merged.length} overlapping auto-memory fact(s).`, details: report.merged.slice(0, 10) });
  if (report.needsReview.length) findings.push({ message: `${report.needsReview.length} auto-memory fact(s) need review.`, details: report.needsReview.slice(0, 10) });

  const applied: string[] = [];
  if (apply) {
    await saveStore(next);
    applied.push('saved consolidated auto-memory store');
  }

  return step(
    'consolidate.auto-memory',
    'Auto-memory consolidate',
    findings,
    apply ? 'Auto-memory store consolidated.' : 'Auto-memory consolidate dry-run (pass --apply --memory to save).',
    false,
    applied.length ? applied : undefined,
  );
}

export async function runBrainConsolidate(options: BrainConsolidateOptions = {}): Promise<BrainConsolidateReport> {
  const brainPath = options.brainPath;
  const apply = options.apply ?? false;
  const dryRun = !apply;

  if (!brainPath) {
    return {
      ok: false,
      dryRun,
      steps: [step('consolidate.configured', 'Second-brain configured', [{ message: 'No second-brain path is configured.' }], 'Run `sanook brain init [path]` first.', true)],
    };
  }

  try {
    if (!(await stat(brainPath)).isDirectory()) {
      return {
        ok: false,
        brainPath,
        dryRun,
        steps: [step('consolidate.path', 'Second-brain path', [{ message: 'Configured path is not a directory.', path: brainPath }], 'Configured brainPath is not usable.', true)],
      };
    }
  } catch {
    return {
      ok: false,
      brainPath,
      dryRun,
      steps: [step('consolidate.path', 'Second-brain path', [{ message: 'Configured path does not exist.', path: brainPath }], 'Configured brainPath is not usable.', true)],
    };
  }

  const nowMs = options.nowMs ?? Date.now();
  const searchImpl =
    options.searchImpl ??
    ((query: string) => search(query, { mode: 'fts', limit: 5, sources: ['vault'] }));

  const steps = [
    await routeInboxStep(brainPath, apply),
    await dedupMergeStep(brainPath),
    await staleArchiveStep(brainPath, nowMs, apply, options.archive ?? false),
    await patternPromoteStep(brainPath),
    await retrievalCheckStep(options.runRetrieval !== false, searchImpl),
    await memoryConsolidateStep(apply, options.memory ?? false, nowMs),
  ];

  const ok = !steps.some((s) => s.status === 'fail');
  return { ok, brainPath, dryRun, steps };
}

function statusLabel(status: BrainConsolidateStatus): string {
  return status.toUpperCase().padEnd(7);
}

export function formatBrainConsolidateReport(report: BrainConsolidateReport): string {
  const lines = [
    'Sanook brain consolidate',
    `vault: ${report.brainPath ?? '(not configured)'}`,
    `mode: ${report.dryRun ? 'dry-run (pass --apply for safe fixes; --apply --archive for stale moves)' : 'apply'}`,
  ];
  for (const s of report.steps) {
    lines.push(`[${statusLabel(s.status)}] ${s.id} — ${s.message}`);
    for (const finding of s.findings) {
      lines.push(`       - ${finding.message}`);
      if (finding.path) lines.push(`         ${finding.path}`);
      for (const detail of finding.details ?? []) lines.push(`         · ${detail}`);
    }
    for (const action of s.applied ?? []) lines.push(`       ✓ ${action}`);
  }
  return lines.join('\n');
}
