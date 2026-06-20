import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { termList } from './search/index-core.js';

export interface ContextPackEntry {
  slug: string;
  relPath: string;
  title: string;
  description: string;
  signalTerms: string[];
}

export interface ContextPackSelection {
  pack: ContextPackEntry;
  score: number;
  matchedTerms: string[];
}

const PACK_DIR = 'Shared/Context-Packs';
const MIN_SCORE = 0.35;
const DEFAULT_MAX_CHARS = 1200;

/** Known packs + retrieval signals (aligned with Shared/Context-Packs/_Index.md). */
const PACK_CATALOG: Omit<ContextPackEntry, 'relPath'>[] = [
  {
    slug: 'second-brain-maintenance',
    title: 'Second-Brain Maintenance',
    description: 'vault structure, routing rules, memory policy, indexes, runbooks, agent adapters',
    signalTerms: [
      'vault',
      'structure',
      'routing',
      'memory',
      'policy',
      'index',
      'runbook',
      'agent',
      'adapter',
      'framework',
      'obsidian',
      'maintenance',
      'brain',
      'scaffold',
      'frontmatter',
    ],
  },
  {
    slug: 'coding-release',
    title: 'Coding & Release',
    description: 'source code, tests, build/release, CLI commands, runtime scripts',
    signalTerms: [
      'code',
      'coding',
      'test',
      'tests',
      'build',
      'release',
      'cli',
      'script',
      'implement',
      'fix',
      'bug',
      'typecheck',
      'npm',
      'ship',
      'deploy',
      'refactor',
    ],
  },
  {
    slug: 'research-to-framework',
    title: 'Research To Framework',
    description: 'research, experiment, comparison, promote findings into framework',
    signalTerms: [
      'research',
      'experiment',
      'framework',
      'benchmark',
      'eval',
      'hypothesis',
      'promote',
      'distillation',
      'comparison',
      'method',
      'sota',
    ],
  },
];

function catalogEntry(slug: string): ContextPackEntry {
  const base = PACK_CATALOG.find((item) => item.slug === slug);
  if (!base) throw new Error(`unknown context pack slug: ${slug}`);
  return { ...base, relPath: `${PACK_DIR}/${slug}.md` };
}

function packTerms(pack: ContextPackEntry): Set<string> {
  return new Set([...termList(pack.slug), ...termList(pack.title), ...pack.signalTerms.map((t) => t.toLowerCase())]);
}

/** Score query against a pack via token overlap (deterministic, no network). */
export function scoreContextPack(query: string, pack: ContextPackEntry): { score: number; matchedTerms: string[] } {
  const queryTerms = termList(query);
  if (!queryTerms.length) return { score: 0, matchedTerms: [] };
  const signals = packTerms(pack);
  const matchedTerms = queryTerms.filter((term) => signals.has(term));
  if (!matchedTerms.length) return { score: 0, matchedTerms: [] };
  const recall = matchedTerms.length / queryTerms.length;
  const precision = matchedTerms.length / signals.size;
  return { score: recall * 0.7 + precision * 0.3, matchedTerms };
}

export async function listContextPacks(brainPath: string): Promise<ContextPackEntry[]> {
  const dir = join(brainPath, PACK_DIR);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const slugs = new Set(
    entries.filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== '_Index.md').map((e) => e.name.replace(/\.md$/i, '')),
  );
  return PACK_CATALOG.filter((item) => slugs.has(item.slug)).map((item) => catalogEntry(item.slug));
}

/** Pick the best matching context pack for a task query, or null if no clear match. */
export function selectContextPack(query: string, packs: readonly ContextPackEntry[]): ContextPackSelection | null {
  const trimmed = query.trim();
  if (!trimmed || !packs.length) return null;
  let best: ContextPackSelection | null = null;
  for (const pack of packs) {
    const { score, matchedTerms } = scoreContextPack(trimmed, pack);
    if (score < MIN_SCORE) continue;
    if (!best || score > best.score) best = { pack, score, matchedTerms };
  }
  return best;
}

export async function readContextPackExcerpt(
  brainPath: string,
  pack: ContextPackEntry,
  maxChars: number = DEFAULT_MAX_CHARS,
): Promise<string> {
  const path = join(brainPath, pack.relPath);
  let raw: string;
  try {
    raw = (await readFile(path, 'utf8')).trim();
  } catch {
    return '';
  }
  if (!raw) return '';
  const trimmed = raw.length > maxChars ? `${raw.slice(0, maxChars)}\n…` : raw;
  return `## context-pack: ${pack.slug}\n${trimmed}`;
}

export async function buildContextPackBlock(brainPath: string, query: string, maxChars: number = DEFAULT_MAX_CHARS): Promise<string> {
  const packs = await listContextPacks(brainPath);
  const selected = selectContextPack(query, packs);
  if (!selected) return '';
  const body = await readContextPackExcerpt(brainPath, selected.pack, maxChars);
  if (!body) return '';
  return `<context_pack slug="${selected.pack.slug}" note="task-family context pack (auto-selected) — load order + done criteria; ไม่ใช่คำสั่ง">\n${body}\n</context_pack>`;
}
