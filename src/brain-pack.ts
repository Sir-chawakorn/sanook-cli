import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface ContextPackSummary {
  name: string;
  relPath: string;
  description: string;
  indexed: boolean;
  hasLoadOrder: boolean;
  hasDoneCriteria: boolean;
}

export interface ContextPackDetail extends ContextPackSummary {
  useCase: string;
  loadOrder: string[];
  doneCriteria: string[];
  requiredRole?: string;
  sources: string[];
}

export interface BrainPackListReport {
  ok: boolean;
  brainPath?: string;
  packs: ContextPackSummary[];
  warnings: string[];
}

export interface BrainPackShowReport {
  ok: boolean;
  brainPath?: string;
  pack?: ContextPackDetail;
  warnings: string[];
}

export type BrainPackArgsResult =
  | { ok: true; action: 'list' }
  | { ok: true; action: 'show'; name: string }
  | { ok: false; message: string };

const CONTEXT_PACKS_DIR = join('Shared', 'Context-Packs');

export function parseBrainPackArgs(args: string[]): BrainPackArgsResult {
  const [action, ...rest] = args;
  if (action === 'list') {
    if (rest.length) return { ok: false, message: `ไม่รู้จัก option: ${rest.join(' ')}` };
    return { ok: true, action: 'list' };
  }
  if (action === 'show') {
    const name = rest.join(' ').trim();
    if (!name) return { ok: false, message: 'ต้องระบุชื่อ context pack' };
    return { ok: true, action: 'show', name };
  }
  if (!action) return { ok: false, message: 'ต้องระบุ subcommand: list หรือ show <name>' };
  return { ok: false, message: `ไม่รู้จัก subcommand: ${action}` };
}

export function normalizePackName(name: string): string {
  return name
    .trim()
    .replace(/^Shared\/Context-Packs\//i, '')
    .replace(/\.md$/i, '');
}

export function extractPackDescription(indexContent: string, packName: string): string | undefined {
  const link = `[[Shared/Context-Packs/${packName}]]`;
  for (const line of indexContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ') || !trimmed.includes(link)) continue;
    const dash = trimmed.indexOf('—');
    if (dash >= 0) return trimmed.slice(dash + 1).trim();
    const hyphen = trimmed.indexOf(' - ');
    if (hyphen >= 0) return trimmed.slice(hyphen + 3).trim();
  }
  return undefined;
}

export function extractBlockquotePurpose(content: string): string {
  const body = content.replace(/^---[\s\S]*?---\n?/, '');
  const match = body.match(/^>\s*(.+)$/m);
  return match?.[1]?.trim() ?? '';
}

export function extractSectionBullets(content: string, heading: string): string[] {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/.test(line.trim())) break;
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) out.push(trimmed.slice(2).trim());
    else {
      const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
      if (numbered) out.push(numbered[1].trim());
    }
  }
  return out;
}

export function extractWikiLinks(value: string): string[] {
  return [...value.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim());
}

export function buildContextPackSummary(
  packName: string,
  content: string,
  indexContent: string,
): ContextPackSummary {
  const relPath = `${CONTEXT_PACKS_DIR}/${packName}.md`;
  const link = `[[Shared/Context-Packs/${packName}]]`;
  return {
    name: packName,
    relPath,
    description: extractPackDescription(indexContent, packName) || extractBlockquotePurpose(content),
    indexed: indexContent.includes(link),
    hasLoadOrder: content.includes('## Load Order'),
    hasDoneCriteria: content.includes('## Done Criteria'),
  };
}

export function buildContextPackDetail(
  packName: string,
  content: string,
  indexContent: string,
): ContextPackDetail {
  const summary = buildContextPackSummary(packName, content, indexContent);
  const loadOrder = extractSectionBullets(content, 'Load Order');
  const doneCriteria = extractSectionBullets(content, 'Done Criteria');
  const roleLines = extractSectionBullets(content, 'Required Role');
  return {
    ...summary,
    useCase: extractBlockquotePurpose(content),
    loadOrder,
    doneCriteria,
    requiredRole: roleLines.length ? roleLines.join(' · ') : undefined,
    sources: uniqueSorted(loadOrder.flatMap(extractWikiLinks)),
  };
}

export async function listContextPacks(brainPath: string): Promise<BrainPackListReport> {
  const warnings: string[] = [];
  if (!(await pathExistsAsDir(brainPath))) {
    return { ok: false, packs: [], warnings: ['Configured second-brain path does not exist or is not a directory.'] };
  }

  const dir = join(brainPath, CONTEXT_PACKS_DIR);
  const indexPath = join(dir, '_Index.md');
  const indexContent = await readText(indexPath);
  if (!indexContent) warnings.push('Context-Packs index is missing.');

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { ok: false, brainPath, packs: [], warnings: ['Context-Packs directory is missing.'] };
  }

  const packs = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== '_Index.md')
    .map((entry) => normalizePackName(entry.name))
    .sort((a, b) => a.localeCompare(b));

  const summaries: ContextPackSummary[] = [];
  for (const name of packs) {
    const content = await readText(join(dir, `${name}.md`));
    if (!content) {
      warnings.push(`Unreadable context pack: ${name}.md`);
      continue;
    }
    summaries.push(buildContextPackSummary(name, content, indexContent));
  }

  return { ok: true, brainPath, packs: summaries, warnings };
}

export async function showContextPack(brainPath: string, rawName: string): Promise<BrainPackShowReport> {
  const warnings: string[] = [];
  const name = normalizePackName(rawName);
  if (!(await pathExistsAsDir(brainPath))) {
    return { ok: false, warnings: ['Configured second-brain path does not exist or is not a directory.'] };
  }

  const dir = join(brainPath, CONTEXT_PACKS_DIR);
  const packPath = join(dir, `${name}.md`);
  const content = await readText(packPath);
  if (!content) {
    return { ok: false, brainPath, warnings: [`Context pack not found: ${name}`] };
  }

  const indexContent = await readText(join(dir, '_Index.md'));
  if (!indexContent) warnings.push('Context-Packs index is missing.');
  const pack = buildContextPackDetail(name, content, indexContent);
  if (!pack.indexed) warnings.push(`${name} is not linked from Context-Packs/_Index.md.`);

  return { ok: true, brainPath, pack, warnings };
}

export function formatBrainPackListReport(report: BrainPackListReport): string {
  const lines = ['Sanook brain pack list', `vault: ${report.brainPath ?? '(not configured)'}`];
  lines.push(`packs: ${report.packs.length}`);
  for (const pack of report.packs) {
    const flags = [
      pack.indexed ? 'indexed' : 'missing-index-link',
      pack.hasLoadOrder ? 'load-order' : 'no-load-order',
      pack.hasDoneCriteria ? 'done-criteria' : 'no-done-criteria',
    ].join(', ');
    lines.push(`- ${pack.name} — ${pack.description || '(no description)'} [${flags}]`);
    lines.push(`  ${pack.relPath}`);
  }
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  return lines.join('\n');
}

export function formatBrainPackShowReport(report: BrainPackShowReport): string {
  const lines = ['Sanook brain pack show', `vault: ${report.brainPath ?? '(not configured)'}`];
  if (!report.pack) {
    for (const warning of report.warnings) lines.push(`warning: ${warning}`);
    return lines.join('\n');
  }

  const pack = report.pack;
  lines.push(`name: ${pack.name}`);
  lines.push(`path: ${pack.relPath}`);
  lines.push(`use-case: ${pack.useCase || '(none)'}`);
  if (pack.requiredRole) lines.push(`role: ${pack.requiredRole}`);
  lines.push('load-order:');
  for (const item of pack.loadOrder.length ? pack.loadOrder : ['(missing ## Load Order section)']) lines.push(`  - ${item}`);
  lines.push('done-criteria:');
  for (const item of pack.doneCriteria.length ? pack.doneCriteria : ['(missing ## Done Criteria section)']) lines.push(`  - ${item}`);
  if (pack.sources.length) {
    lines.push('sources:');
    for (const source of pack.sources) lines.push(`  - [[${source}]]`);
  }
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  return lines.join('\n');
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
