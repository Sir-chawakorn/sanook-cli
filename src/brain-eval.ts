import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FOLDERS } from './brain.js';
import { checkBrainFolders, checkSearchIndexFreshness, checkVaultStructureMap } from './brain-doctor.js';
import { inspectBrainContext } from './brain-context.js';
import { search, type SearchOptions, type SearchResult } from './search/engine.js';
import { INDEX_PATH } from './search/store.js';

export type BrainEvalStatus = 'pass' | 'partial' | 'fail';

export interface BrainEvalCase {
  id: string;
  title: string;
  status: BrainEvalStatus;
  score: number;
  maxScore: number;
  evidence?: string[];
  details?: string[];
}

export interface BrainEvalReport {
  ok: boolean;
  brainPath?: string;
  score: number;
  maxScore: number;
  percent: number;
  cases: BrainEvalCase[];
}

export type BrainEvalSearch = (query: string, opts: SearchOptions) => Promise<SearchResult>;

export interface BrainEvalOptions {
  brainPath?: string;
  indexPath?: string;
  runRetrieval?: boolean;
  searchImpl?: BrainEvalSearch;
}

interface RetrievalCase {
  id: string;
  query: string;
  expectedPath: string;
}

const STATIC_CASES = ['SB-01', 'SB-02', 'SB-03', 'SB-04', 'SB-05', 'SB-06', 'SB-07', 'SB-08', 'SB-09', 'SB-10'];
const RETRIEVAL_CASES: RetrievalCase[] = [
  { id: 'RET-01', query: 'memory write protocol merge dont append', expectedPath: 'Shared/Rules/memory-write-protocol.md' },
  { id: 'RET-02', query: 'context assembly policy small context', expectedPath: 'Shared/Rules/context-assembly-policy.md' },
  { id: 'RET-03', query: 'quality ledger retrieval hit grounded', expectedPath: 'Evals/quality-ledger.md' },
];

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
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

function caseResult(
  id: string,
  title: string,
  passed: boolean,
  evidence: string[] = [],
  details: string[] = [],
  partial = false,
): BrainEvalCase {
  const status: BrainEvalStatus = passed ? 'pass' : partial ? 'partial' : 'fail';
  return {
    id,
    title,
    status,
    score: status === 'pass' ? 1 : status === 'partial' ? 0.5 : 0,
    maxScore: 1,
    evidence,
    details,
  };
}

function summarize(cases: BrainEvalCase[], brainPath?: string): BrainEvalReport {
  const score = cases.reduce((sum, item) => sum + item.score, 0);
  const maxScore = cases.reduce((sum, item) => sum + item.maxScore, 0);
  const percent = maxScore ? (score / maxScore) * 100 : 0;
  return { ok: cases.every((item) => item.status === 'pass'), brainPath, score, maxScore, percent, cases };
}

async function benchmarkFileCase(brainPath: string): Promise<BrainEvalCase> {
  const path = join(brainPath, 'Evals', 'second-brain-benchmarks.md');
  const content = await readText(path);
  if (!content) return caseResult('SB-00', 'Benchmark file exists', false, [path]);
  const missing = STATIC_CASES.filter((id) => !content.includes(id));
  return caseResult(
    'SB-00',
    'Benchmark file exists and names static cases',
    missing.length === 0,
    [path],
    missing.length ? [`missing case ids: ${missing.join(', ')}`] : [],
    missing.length > 0 && missing.length < STATIC_CASES.length,
  );
}

async function routingCase(brainPath: string): Promise<BrainEvalCase> {
  const folderCheck = await checkBrainFolders(brainPath);
  const mapCheck = await checkVaultStructureMap(brainPath);
  const missingIndexes: string[] = [];
  for (const folder of FOLDERS) {
    if (!(await fileExists(join(brainPath, folder.dir, '_Index.md')))) missingIndexes.push(`${folder.dir}/_Index.md`);
  }
  const pass = folderCheck.status === 'pass' && mapCheck.status === 'pass' && missingIndexes.length === 0;
  return caseResult(
    'SB-02',
    'Routing map and destination indexes are complete',
    pass,
    [join(brainPath, 'Vault Structure Map.md')],
    [...(folderCheck.details ?? []), ...(mapCheck.details ?? []), ...missingIndexes],
    folderCheck.status === 'pass' || mapCheck.status === 'pass',
  );
}

async function requiredFilesCase(brainPath: string, id: string, title: string, relPaths: string[], tokens: string[] = []): Promise<BrainEvalCase> {
  const missing: string[] = [];
  const evidence: string[] = [];
  const tokenMisses: string[] = [];
  for (const rel of relPaths) {
    const path = join(brainPath, rel);
    const content = await readText(path);
    if (!content) {
      missing.push(rel);
      continue;
    }
    evidence.push(path);
    for (const token of tokens) {
      if (!content.toLowerCase().includes(token.toLowerCase())) tokenMisses.push(`${rel}: missing "${token}"`);
    }
  }
  const details = [...missing.map((m) => `missing ${m}`), ...tokenMisses];
  return caseResult(id, title, details.length === 0, evidence, details, evidence.length > 0 && missing.length < relPaths.length);
}

async function contextCase(brainPath: string, indexPath: string): Promise<BrainEvalCase> {
  const report = await inspectBrainContext({ brainPath, indexPath });
  const structuralWarnings = report.warnings.filter(
    (warning) => !warning.includes('Search index is missing') && !warning.includes('Search index is older'),
  );
  return caseResult(
    'SB-09',
    'Hot context assembles without missing or oversized sources',
    report.ok && report.contextChars > 0 && structuralWarnings.length === 0,
    report.sources.map((source) => source.path),
    structuralWarnings,
    report.contextChars > 0,
  );
}

async function indexCase(brainPath: string, indexPath: string): Promise<BrainEvalCase> {
  const check = await checkSearchIndexFreshness(brainPath, indexPath);
  return caseResult(
    'SB-IDX',
    'Search index exists and is fresh enough',
    check.status === 'pass',
    [indexPath],
    check.status === 'pass' ? [] : [check.message, ...(check.details ?? [])],
    check.status === 'warn',
  );
}

async function retrievalCase(brainPath: string, item: RetrievalCase, searchImpl: BrainEvalSearch): Promise<BrainEvalCase> {
  const res = await searchImpl(item.query, { mode: 'fts', limit: 5, sources: ['vault'] });
  const hit = res.hits.find((candidate) => candidate.path === item.expectedPath);
  return caseResult(
    item.id,
    `Retrieval finds ${item.expectedPath}`,
    !!hit,
    hit ? [join(brainPath, hit.path ?? item.expectedPath)] : [],
    hit ? [] : [`query="${item.query}" did not return ${item.expectedPath}`],
    res.hits.length > 0,
  );
}

export async function runBrainEval(options: BrainEvalOptions = {}): Promise<BrainEvalReport> {
  const brainPath = options.brainPath;
  if (!brainPath) {
    return summarize([
      caseResult('SB-CONFIG', 'Second-brain path is configured', false, [], ['Run `sanook brain init [path]` first.']),
    ]);
  }

  try {
    if (!(await stat(brainPath)).isDirectory()) {
      return summarize([
        caseResult('SB-CONFIG', 'Second-brain path is a directory', false, [brainPath], ['Configured brainPath is not a directory.']),
      ], brainPath);
    }
  } catch {
    return summarize([
      caseResult('SB-CONFIG', 'Second-brain path exists', false, [brainPath], ['Configured brainPath does not exist.']),
    ], brainPath);
  }

  const indexPath = options.indexPath ?? INDEX_PATH;
  const cases: BrainEvalCase[] = [
    await benchmarkFileCase(brainPath),
    await requiredFilesCase(brainPath, 'SB-01', 'AI context entrypoint exists', ['Shared/AI-Context-Index.md'], ['Vault Structure Map']),
    await routingCase(brainPath),
    await requiredFilesCase(
      brainPath,
      'SB-03',
      'Memory write protocol is documented',
      ['Shared/Rules/memory-write-protocol.md'],
      ['ADD', 'UPDATE', 'DELETE', 'NOOP'],
    ),
    await requiredFilesCase(
      brainPath,
      'SB-04',
      'External ingest quarantine/provenance path exists',
      ['Runbooks/ingest-quarantine.md', 'Shared/Provenance/ingest-log.md'],
    ),
    await requiredFilesCase(brainPath, 'SB-05', 'Coding verification standard exists', ['Shared/Tech-Standards/verification-standard.md']),
    await requiredFilesCase(brainPath, 'SB-06', 'Owner-facing response examples exist', ['Shared/User-Memory/response-examples.md']),
    await requiredFilesCase(
      brainPath,
      'SB-07',
      'Framework improvement evidence paths exist',
      ['Evals/quality-ledger.md', 'Research/_Index.md', 'Sessions/_Index.md'],
    ),
    await requiredFilesCase(
      brainPath,
      'SB-08',
      'Multi-agent coordination paths exist',
      ['Shared/Coordination/task-board.md', 'Shared/Coordination/task-board/_Index.md'],
    ),
    await contextCase(brainPath, indexPath),
    await requiredFilesCase(
      brainPath,
      'SB-10',
      'Learning loop ledger and session index exist',
      ['Evals/quality-ledger.md', 'Sessions/_Index.md'],
    ),
    await indexCase(brainPath, indexPath),
  ];

  if (options.runRetrieval !== false) {
    const searchImpl = options.searchImpl ?? search;
    for (const item of RETRIEVAL_CASES) cases.push(await retrievalCase(brainPath, item, searchImpl));
  }

  return summarize(cases, brainPath);
}

function statusLabel(status: BrainEvalStatus): string {
  return status.toUpperCase().padEnd(7);
}

export function formatBrainEvalReport(report: BrainEvalReport): string {
  const lines = [
    'Sanook brain eval',
    `vault: ${report.brainPath ?? '(not configured)'}`,
    `score: ${report.score.toFixed(1)}/${report.maxScore} (${report.percent.toFixed(1)}%)`,
  ];
  for (const item of report.cases) {
    lines.push(`[${statusLabel(item.status)}] ${item.id} — ${item.title}`);
    for (const evidence of item.evidence ?? []) lines.push(`       ${evidence}`);
    for (const detail of item.details ?? []) lines.push(`       - ${detail}`);
  }
  return lines.join('\n');
}
