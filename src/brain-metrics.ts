import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { checkSearchIndexFreshness } from './brain-doctor.js';
import { runBrainEval, type BrainEvalReport } from './brain-eval.js';
import { INDEX_PATH, sanitizeManifest, type Manifest } from './search/store.js';

export interface BrainMetricsCounts {
  markdownTotal: number;
  byTopFolder: Record<string, number>;
  inboxCandidates: number;
  inboxNeedsMerge: number;
  sessionNotes: number;
  contextPacks: number;
  archivedNotes: number;
}

export interface BrainMetricsStaleNote {
  relPath: string;
  staleAfter: string;
  daysPastStale: number;
  daysSinceTouch: number;
}

export interface BrainMetricsIndexFreshness {
  status: 'pass' | 'warn' | 'fail';
  message: string;
  indexMtimeMs?: number;
  vaultLatestMtimeMs?: number;
}

export interface BrainMetricsRetrievalCoverage {
  sessionIndexed: number;
  sessionTotal: number;
  sessionMissing: string[];
  evalPercent: number;
  evalOk: boolean;
  evalScore: number;
  evalMaxScore: number;
}

export interface BrainMetricsReport {
  ok: boolean;
  brainPath?: string;
  counts: BrainMetricsCounts;
  staleNotes: BrainMetricsStaleNote[];
  indexFreshness: BrainMetricsIndexFreshness;
  retrieval: BrainMetricsRetrievalCoverage;
}

export interface BrainMetricsOptions {
  brainPath?: string;
  indexPath?: string;
  nowMs?: number;
  runRetrievalEval?: boolean;
  staleTouchGraceDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SKIP_DIRS = new Set(['.git', '.obsidian', 'node_modules', 'Shared/Context7-Docs']);
const ARCHIVE_EXEMPT_PREFIXES = ['Shared/Core-Facts/', 'Shared/Archive/'];

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
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function topFolder(relPath: string): string {
  const parts = relPath.split('/');
  return parts.length > 1 ? parts[0]! : relPath;
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
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(childRel)) continue;
        await walk(join(abs, entry.name), childRel);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(childRel);
      }
    }
  }
  await walk(root, '');
  return out.sort();
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function mtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

async function readManifest(indexPath: string): Promise<Manifest | null> {
  try {
    const raw = JSON.parse(await readFile(indexPath, 'utf8')) as { manifest?: unknown };
    return sanitizeManifest(raw.manifest);
  } catch {
    return null;
  }
}

async function collectCounts(brainPath: string): Promise<BrainMetricsCounts> {
  const markdown = await listMarkdown(brainPath);
  const byTopFolder: Record<string, number> = {};
  for (const rel of markdown) {
    const folder = topFolder(rel);
    byTopFolder[folder] = (byTopFolder[folder] ?? 0) + 1;
  }

  const inboxPath = join(brainPath, 'Shared', 'Memory-Inbox', 'memory-inbox.md');
  const inbox = await readText(inboxPath);
  const inboxCandidates = sectionBullets(inbox, 'New Candidates').length;
  const inboxNeedsMerge = sectionBullets(inbox, 'Needs Merge').length;

  let sessionNotes = 0;
  try {
    sessionNotes = (await readdir(join(brainPath, 'Sessions'), { withFileTypes: true })).filter(
      (e) => e.isFile() && e.name.endsWith('.md') && e.name !== '_Index.md',
    ).length;
  } catch {
    sessionNotes = 0;
  }

  let contextPacks = 0;
  try {
    contextPacks = (await readdir(join(brainPath, 'Shared', 'Context-Packs'), { withFileTypes: true })).filter(
      (e) => e.isFile() && e.name.endsWith('.md') && e.name !== '_Index.md',
    ).length;
  } catch {
    contextPacks = 0;
  }

  const archivedNotes = markdown.filter((rel) => rel.startsWith('Shared/Archive/')).length;

  return {
    markdownTotal: markdown.length,
    byTopFolder,
    inboxCandidates,
    inboxNeedsMerge,
    sessionNotes,
    contextPacks,
    archivedNotes,
  };
}

async function collectStaleNotes(
  brainPath: string,
  nowMs: number,
  touchGraceDays: number,
): Promise<BrainMetricsStaleNote[]> {
  const out: BrainMetricsStaleNote[] = [];
  for (const rel of await listMarkdown(brainPath)) {
    if (ARCHIVE_EXEMPT_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    const path = join(brainPath, rel);
    const content = await readText(path);
    const staleAfter = parseFrontmatterField(content, 'stale_after');
    const staleMs = parseIsoDate(staleAfter);
    if (staleMs === undefined || staleMs > nowMs) continue;
    const touchMs = await mtimeMs(path);
    const daysPastStale = Math.floor((nowMs - staleMs) / DAY_MS);
    const daysSinceTouch = Math.floor((nowMs - touchMs) / DAY_MS);
    if (daysSinceTouch < touchGraceDays) continue;
    out.push({ relPath: rel, staleAfter: staleAfter!, daysPastStale, daysSinceTouch });
  }
  return out.sort((a, b) => b.daysPastStale - a.daysPastStale);
}

async function collectRetrievalCoverage(
  brainPath: string,
  indexPath: string,
  evalReport?: BrainEvalReport,
): Promise<BrainMetricsRetrievalCoverage> {
  let sessionTotal = 0;
  let sessionIndexed = 0;
  const sessionMissing: string[] = [];
  try {
    const sessions = (await readdir(join(brainPath, 'Sessions'), { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== '_Index.md')
      .map((e) => `Sessions/${e.name}`)
      .sort();
    sessionTotal = sessions.length;
    const manifest = await readManifest(indexPath);
    if (manifest) {
      for (const rel of sessions) {
        if (manifest[rel]) sessionIndexed++;
        else sessionMissing.push(rel);
      }
    }
  } catch {
    sessionTotal = 0;
  }

  return {
    sessionIndexed,
    sessionTotal,
    sessionMissing,
    evalPercent: evalReport?.percent ?? 0,
    evalOk: evalReport?.ok ?? false,
    evalScore: evalReport?.score ?? 0,
    evalMaxScore: evalReport?.maxScore ?? 0,
  };
}

export async function collectBrainMetrics(options: BrainMetricsOptions = {}): Promise<BrainMetricsReport> {
  const brainPath = options.brainPath;
  const emptyCounts: BrainMetricsCounts = {
    markdownTotal: 0,
    byTopFolder: {},
    inboxCandidates: 0,
    inboxNeedsMerge: 0,
    sessionNotes: 0,
    contextPacks: 0,
    archivedNotes: 0,
  };

  if (!brainPath) {
    return {
      ok: false,
      counts: emptyCounts,
      staleNotes: [],
      indexFreshness: { status: 'fail', message: 'No second-brain path is configured.' },
      retrieval: { sessionIndexed: 0, sessionTotal: 0, sessionMissing: [], evalPercent: 0, evalOk: false, evalScore: 0, evalMaxScore: 0 },
    };
  }

  try {
    if (!(await stat(brainPath)).isDirectory()) {
      return {
        ok: false,
        brainPath,
        counts: emptyCounts,
        staleNotes: [],
        indexFreshness: { status: 'fail', message: 'Configured second-brain path is not a directory.' },
        retrieval: { sessionIndexed: 0, sessionTotal: 0, sessionMissing: [], evalPercent: 0, evalOk: false, evalScore: 0, evalMaxScore: 0 },
      };
    }
  } catch {
    return {
      ok: false,
      brainPath,
      counts: emptyCounts,
      staleNotes: [],
      indexFreshness: { status: 'fail', message: 'Configured second-brain path does not exist.' },
      retrieval: { sessionIndexed: 0, sessionTotal: 0, sessionMissing: [], evalPercent: 0, evalOk: false, evalScore: 0, evalMaxScore: 0 },
    };
  }

  const nowMs = options.nowMs ?? Date.now();
  const indexPath = options.indexPath ?? INDEX_PATH;
  const counts = await collectCounts(brainPath);
  const staleNotes = await collectStaleNotes(brainPath, nowMs, options.staleTouchGraceDays ?? 14);
  const indexCheck = await checkSearchIndexFreshness(brainPath, indexPath);
  const evalReport = options.runRetrievalEval === false ? undefined : await runBrainEval({ brainPath, indexPath, runRetrieval: true });
  const retrieval = await collectRetrievalCoverage(brainPath, indexPath, evalReport);

  const indexFreshness: BrainMetricsIndexFreshness = {
    status: indexCheck.status,
    message: indexCheck.message,
  };
  for (const detail of indexCheck.details ?? []) {
    const m = detail.match(/^(\w+)_mtime_ms=(\d+)/);
    if (!m) continue;
    const value = Number(m[2]);
    if (m[1] === 'index') indexFreshness.indexMtimeMs = value;
    if (m[1] === 'vault_latest') indexFreshness.vaultLatestMtimeMs = value;
  }

  const ok =
    indexCheck.status !== 'fail' &&
    staleNotes.length === 0 &&
    (retrieval.sessionTotal === 0 || retrieval.sessionMissing.length === 0) &&
    (evalReport === undefined || evalReport.ok);

  return { ok, brainPath, counts, staleNotes, indexFreshness, retrieval };
}

export function formatBrainMetricsReport(report: BrainMetricsReport): string {
  const lines = ['Sanook brain metrics', `vault: ${report.brainPath ?? '(not configured)'}`];
  lines.push('counts:');
  lines.push(`  markdown: ${report.counts.markdownTotal}`);
  lines.push(`  inbox candidates: ${report.counts.inboxCandidates} · needs merge: ${report.counts.inboxNeedsMerge}`);
  lines.push(`  sessions: ${report.counts.sessionNotes} · context packs: ${report.counts.contextPacks} · archived: ${report.counts.archivedNotes}`);
  const folders = Object.entries(report.counts.byTopFolder).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (folders.length) {
    lines.push('  top folders:');
    for (const [folder, count] of folders) lines.push(`    ${folder}: ${count}`);
  }
  lines.push(`index freshness: [${report.indexFreshness.status.toUpperCase()}] ${report.indexFreshness.message}`);
  lines.push(
    `retrieval coverage: sessions indexed ${report.retrieval.sessionIndexed}/${report.retrieval.sessionTotal}` +
      (report.retrieval.evalMaxScore ? ` · eval ${report.retrieval.evalScore}/${report.retrieval.evalMaxScore} (${report.retrieval.evalPercent.toFixed(1)}%)` : ''),
  );
  if (report.retrieval.sessionMissing.length) {
    lines.push('  missing from index:');
    for (const rel of report.retrieval.sessionMissing.slice(0, 10)) lines.push(`    - ${rel}`);
  }
  if (report.staleNotes.length) {
    lines.push(`stale notes (${report.staleNotes.length}):`);
    for (const note of report.staleNotes.slice(0, 15)) {
      lines.push(`  - ${note.relPath} (stale_after=${note.staleAfter}, +${note.daysPastStale}d, untouched ${note.daysSinceTouch}d)`);
    }
  } else {
    lines.push('stale notes: none flagged');
  }
  lines.push(`summary: ${report.ok ? 'healthy' : 'needs attention'}`);
  return lines.join('\n');
}
