import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { normalize } from './memory-store.js';
import { INDEX_PATH, sanitizeManifest, type Manifest } from './search/store.js';

export type BrainReviewStatus = 'pass' | 'warn' | 'fail';

export interface BrainReviewFinding {
  message: string;
  path?: string;
  details?: string[];
}

export interface BrainReviewCheck {
  id: string;
  title: string;
  status: BrainReviewStatus;
  message: string;
  path?: string;
  findings?: BrainReviewFinding[];
}

export interface BrainReviewReport {
  ok: boolean;
  brainPath?: string;
  checks: BrainReviewCheck[];
}

export interface BrainReviewOptions {
  brainPath?: string;
  indexPath?: string;
  nowMs?: number;
  scanMarkdownHygiene?: boolean;
  memoryInboxMaxAgeDays?: number;
  contextPackMaxAgeDays?: number;
  evalFreshnessToleranceMs?: number;
}

export interface ParsedBrainReviewArgs {
  scanMarkdownHygiene: boolean;
}

export type BrainReviewArgsResult =
  | { ok: true; value: ParsedBrainReviewArgs }
  | { ok: false; message: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MEMORY_INBOX_MAX_AGE_DAYS = 14;
const DEFAULT_CONTEXT_PACK_MAX_AGE_DAYS = 90;
const DEFAULT_EVAL_FRESHNESS_TOLERANCE_MS = 60 * 1000;
const DETAIL_LIMIT = 25;
const ROOT_FILES_WITHOUT_UP = new Set(['Home.md', 'README.md', 'CLAUDE.md', 'GEMINI.md', 'AGENTS.md', 'SANOOK.md']);
const ROOT_FILES_WITHOUT_PARENT = ROOT_FILES_WITHOUT_UP;
const SKIP_DIRS = new Set(['.git', '.obsidian', 'node_modules', 'Shared/Context7-Docs']);
const NEGATION_TOKENS = new Set([
  'no',
  'not',
  'never',
  'without',
  'disable',
  'disabled',
  'false',
  'ไม่',
  'ห้าม',
  'เลิก',
  'ปิด',
  'ไม่ได้',
  'ไม่ชอบ',
]);

export function parseBrainReviewArgs(args: string[]): BrainReviewArgsResult {
  let scanMarkdownHygiene = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-hygiene') {
      scanMarkdownHygiene = false;
    } else if (a === '--hygiene') {
      scanMarkdownHygiene = true;
    } else {
      return { ok: false, message: `ไม่รู้จัก option: ${a}` };
    }
  }
  return { ok: true, value: { scanMarkdownHygiene } };
}

function result(
  id: string,
  title: string,
  findings: BrainReviewFinding[],
  message: string,
  fail = false,
  path?: string,
): BrainReviewCheck {
  const status: BrainReviewStatus = fail ? 'fail' : findings.length ? 'warn' : 'pass';
  return { id, title, status, message, path, findings: findings.length ? findings : undefined };
}

function normalizeCandidate(line: string): string {
  return normalize(line.replace(/^-\s*/, '').replace(/\s+/g, ' ')).trim();
}

function tokensForCandidate(line: string): Set<string> {
  return new Set(
    normalizeCandidate(line)
      .split(/\s+/)
      .filter((token) => token.length > 1 && !NEGATION_TOKENS.has(token)),
  );
}

function hasNegation(line: string): boolean {
  const normalized = normalizeCandidate(line);
  return [...NEGATION_TOKENS].some((token) => normalized.includes(token));
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

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.min(a.size, b.size);
}

async function pathExistsAsDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
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

async function readManifest(indexPath: string): Promise<Manifest | null> {
  try {
    const raw = JSON.parse(await readFile(indexPath, 'utf8')) as { manifest?: unknown };
    return sanitizeManifest(raw.manifest);
  } catch {
    return null;
  }
}

async function checkMemoryInbox(brainPath: string, nowMs: number, maxAgeDays: number): Promise<BrainReviewCheck> {
  const path = join(brainPath, 'Shared', 'Memory-Inbox', 'memory-inbox.md');
  const content = await readText(path);
  if (!content) {
    return result('review.memory-inbox', 'Memory-Inbox curation', [{ message: 'Memory-Inbox file is missing.', path }], 'Memory-Inbox is missing.', true, path);
  }

  const candidates = [...sectionBullets(content, 'New Candidates'), ...sectionBullets(content, 'Needs Merge')];
  const findings: BrainReviewFinding[] = [];
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const candidate of candidates) {
    const key = normalizeCandidate(candidate);
    if (!key) continue;
    if (seen.has(key)) duplicates.push(candidate);
    else seen.set(key, candidate);
  }
  if (duplicates.length) {
    findings.push({ message: `${duplicates.length} duplicate Memory-Inbox candidate(s).`, path, details: duplicates.slice(0, DETAIL_LIMIT) });
  }

  const needsMerge = sectionBullets(content, 'Needs Merge');
  if (needsMerge.length) {
    findings.push({ message: `${needsMerge.length} Memory-Inbox item(s) are waiting in Needs Merge.`, path, details: needsMerge.slice(0, DETAIL_LIMIT) });
  }

  const possibleContradictions: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (hasNegation(candidates[i]) === hasNegation(candidates[j])) continue;
      const score = overlap(tokensForCandidate(candidates[i]), tokensForCandidate(candidates[j]));
      if (score >= 0.6) possibleContradictions.push(`${candidates[i]} <> ${candidates[j]}`);
    }
  }
  if (possibleContradictions.length) {
    findings.push({
      message: `${possibleContradictions.length} possible contradictory Memory-Inbox pair(s).`,
      path,
      details: possibleContradictions.slice(0, DETAIL_LIMIT),
    });
  }

  const ageDays = Math.floor((nowMs - (await mtimeMs(path))) / DAY_MS);
  if (candidates.length && ageDays > maxAgeDays) {
    findings.push({ message: `Memory-Inbox has ${candidates.length} candidate(s) and was last touched ${ageDays} days ago.`, path });
  }

  return result(
    'review.memory-inbox',
    'Memory-Inbox curation',
    findings,
    candidates.length ? `${candidates.length} candidate(s) reviewed.` : 'Memory-Inbox has no active candidates.',
    false,
    path,
  );
}

async function checkContextPacks(brainPath: string, nowMs: number, maxAgeDays: number): Promise<BrainReviewCheck> {
  const dir = join(brainPath, 'Shared', 'Context-Packs');
  const indexPath = join(dir, '_Index.md');
  const index = await readText(indexPath);
  const findings: BrainReviewFinding[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return result('review.context-packs', 'Context pack curation', [{ message: 'Context-Packs directory is missing.', path: dir }], 'Context-Packs directory is missing.', true, dir);
  }

  if (!index) findings.push({ message: 'Context-Packs index is missing.', path: indexPath });
  const packs = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== '_Index.md');
  for (const pack of packs) {
    const path = join(dir, pack.name);
    const content = await readText(path);
    const missingSections = ['## Load Order', '## Done Criteria'].filter((section) => !content.includes(section));
    if (missingSections.length) {
      findings.push({ message: `${pack.name} is missing expected section(s).`, path, details: missingSections });
    }
    const link = `[[Shared/Context-Packs/${pack.name.replace(/\.md$/i, '')}]]`;
    if (index && !index.includes(link)) findings.push({ message: `${pack.name} is not linked from Context-Packs index.`, path: indexPath });
    const ageDays = Math.floor((nowMs - (await mtimeMs(path))) / DAY_MS);
    if (ageDays > maxAgeDays) findings.push({ message: `${pack.name} has not been touched for ${ageDays} days.`, path });
  }

  return result(
    'review.context-packs',
    'Context pack curation',
    findings,
    packs.length ? `${packs.length} context pack(s) reviewed.` : 'No context packs found.',
    false,
    dir,
  );
}

async function checkSessionIndexCoverage(brainPath: string, indexPath: string): Promise<BrainReviewCheck> {
  const sessionsDir = join(brainPath, 'Sessions');
  let entries;
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return result('review.session-index', 'Session index coverage', [{ message: 'Sessions directory is missing.', path: sessionsDir }], 'Sessions directory is missing.', true, sessionsDir);
  }
  const sessions = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== '_Index.md')
    .map((entry) => `Sessions/${entry.name}`)
    .sort();

  if (!sessions.length) return result('review.session-index', 'Session index coverage', [], 'No session notes to check.', false, sessionsDir);

  const manifest = await readManifest(indexPath);
  if (!manifest) {
    return result(
      'review.session-index',
      'Session index coverage',
      [{ message: 'Search index is missing or unreadable; run `sanook index`.', path: indexPath }],
      `${sessions.length} session note(s) found, but no readable index manifest exists.`,
      false,
      indexPath,
    );
  }

  const missing = sessions.filter((session) => !manifest[session]);
  return result(
    'review.session-index',
    'Session index coverage',
    missing.length ? [{ message: `${missing.length} session note(s) are missing from the search manifest.`, path: indexPath, details: missing.slice(0, DETAIL_LIMIT) }] : [],
    `${sessions.length} session note(s) checked against the search manifest.`,
    false,
    indexPath,
  );
}

async function frameworkFiles(brainPath: string): Promise<string[]> {
  const paths = ['SANOOK.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'Vault Structure Map.md', 'Shared/AI-Context-Index.md'];
  for (const rel of await listMarkdown(join(brainPath, 'Shared', 'Rules'))) paths.push(`Shared/Rules/${rel}`);
  for (const rel of await listMarkdown(join(brainPath, 'Shared', 'Context-Packs'))) paths.push(`Shared/Context-Packs/${rel}`);
  return paths;
}

async function newest(paths: string[], brainPath: string): Promise<{ rel: string; mtime: number }> {
  let best = { rel: '', mtime: 0 };
  for (const rel of paths) {
    const mt = await mtimeMs(join(brainPath, rel));
    if (mt > best.mtime) best = { rel, mtime: mt };
  }
  return best;
}

async function checkEvalFreshness(brainPath: string, toleranceMs: number): Promise<BrainReviewCheck> {
  const evalFiles = ['Evals/second-brain-benchmarks.md', 'Evals/retrieval-eval.md', 'Evals/quality-ledger.md'];
  const findings: BrainReviewFinding[] = [];
  for (const rel of evalFiles) {
    if (!(await mtimeMs(join(brainPath, rel)))) findings.push({ message: `Missing eval file: ${rel}`, path: join(brainPath, rel) });
  }
  if (findings.length) {
    return result('review.eval-freshness', 'Eval freshness after framework changes', findings, 'Eval files are incomplete.', true, join(brainPath, 'Evals'));
  }

  const newestFramework = await newest(await frameworkFiles(brainPath), brainPath);
  const newestEval = await newest(evalFiles, brainPath);
  if (newestFramework.mtime > newestEval.mtime + toleranceMs) {
    findings.push({
      message: 'Framework/context files are newer than eval evidence; rerun `sanook brain eval` and update the ledger if behavior changed.',
      details: [`newest framework: ${newestFramework.rel}`, `newest eval: ${newestEval.rel}`],
    });
  }
  return result('review.eval-freshness', 'Eval freshness after framework changes', findings, 'Framework files and eval evidence compared.', false, join(brainPath, 'Evals'));
}

async function checkMarkdownHygiene(brainPath: string): Promise<BrainReviewCheck> {
  const markdown = await listMarkdown(brainPath);
  const missingPurpose: string[] = [];
  const missingParent: string[] = [];
  const missingUp: string[] = [];
  for (const rel of markdown) {
    const content = await readText(join(brainPath, rel));
    if (!/^>\s+/m.test(content)) missingPurpose.push(rel);
    if (!ROOT_FILES_WITHOUT_PARENT.has(rel) && !/^---[\s\S]*?^parent:/m.test(content)) missingParent.push(rel);
    if (!ROOT_FILES_WITHOUT_UP.has(rel) && !content.includes('up:: [[')) missingUp.push(rel);
  }
  const findings: BrainReviewFinding[] = [];
  if (missingPurpose.length) findings.push({ message: `${missingPurpose.length} markdown file(s) have no purpose blockquote.`, details: missingPurpose.slice(0, DETAIL_LIMIT) });
  if (missingParent.length) findings.push({ message: `${missingParent.length} markdown file(s) have no parent frontmatter.`, details: missingParent.slice(0, DETAIL_LIMIT) });
  if (missingUp.length) findings.push({ message: `${missingUp.length} markdown file(s) have no up:: graph link.`, details: missingUp.slice(0, DETAIL_LIMIT) });
  return result('review.markdown-hygiene', 'Markdown routing hygiene', findings, `${markdown.length} markdown file(s) scanned.`, false, brainPath);
}

export async function reviewBrain(options: BrainReviewOptions = {}): Promise<BrainReviewReport> {
  const brainPath = options.brainPath;
  if (!brainPath) {
    return {
      ok: false,
      checks: [
        result('review.configured', 'Second-brain path configured', [{ message: 'No second-brain path is configured.' }], 'Run `sanook brain init [path]` first.', true),
      ],
    };
  }

  if (!(await pathExistsAsDir(brainPath))) {
    return {
      ok: false,
      brainPath,
      checks: [
        result('review.path', 'Second-brain path exists', [{ message: 'Configured second-brain path does not exist or is not a directory.', path: brainPath }], 'Configured brainPath is not usable.', true, brainPath),
      ],
    };
  }

  const nowMs = options.nowMs ?? Date.now();
  const checks = [
    await checkMemoryInbox(brainPath, nowMs, options.memoryInboxMaxAgeDays ?? DEFAULT_MEMORY_INBOX_MAX_AGE_DAYS),
    await checkContextPacks(brainPath, nowMs, options.contextPackMaxAgeDays ?? DEFAULT_CONTEXT_PACK_MAX_AGE_DAYS),
    await checkSessionIndexCoverage(brainPath, options.indexPath ?? INDEX_PATH),
    await checkEvalFreshness(brainPath, options.evalFreshnessToleranceMs ?? DEFAULT_EVAL_FRESHNESS_TOLERANCE_MS),
  ];
  if (options.scanMarkdownHygiene !== false) checks.push(await checkMarkdownHygiene(brainPath));

  return { ok: !checks.some((check) => check.status === 'fail'), brainPath, checks };
}

function statusLabel(status: BrainReviewStatus): string {
  return status.toUpperCase().padEnd(4);
}

export function formatBrainReviewReport(report: BrainReviewReport): string {
  const lines = ['Sanook brain review', `vault: ${report.brainPath ?? '(not configured)'}`];
  const warnCount = report.checks.filter((check) => check.status === 'warn').length;
  const failCount = report.checks.filter((check) => check.status === 'fail').length;
  lines.push(`summary: ${report.checks.length} check(s), ${warnCount} warning(s), ${failCount} failure(s)`);
  for (const check of report.checks) {
    lines.push(`[${statusLabel(check.status)}] ${check.id} — ${check.message}`);
    if (check.path) lines.push(`       ${check.path}`);
    for (const finding of check.findings ?? []) {
      lines.push(`       - ${finding.message}`);
      if (finding.path && finding.path !== check.path) lines.push(`         ${finding.path}`);
      for (const detail of finding.details ?? []) lines.push(`         · ${detail}`);
    }
  }
  return lines.join('\n');
}
