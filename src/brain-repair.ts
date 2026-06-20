import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FOLDERS } from './brain.js';
import { checkBrainFolders } from './brain-doctor.js';
import { inferParentRelPath } from './brain-new.js';
import { extractPackDescription, normalizePackName as normalizeContextPackName } from './brain-pack.js';

export interface BrainRepairAction {
  id: string;
  relPath: string;
  message: string;
  kind: 'markdown' | 'index' | 'folder';
}

export interface BrainRepairReport {
  ok: boolean;
  brainPath?: string;
  dryRun: boolean;
  actions: BrainRepairAction[];
  applied: string[];
  warnings: string[];
}

export interface RepairBrainOptions {
  brainPath?: string;
  dryRun?: boolean;
  expectedFolders?: readonly string[];
}

export type BrainRepairArgsResult =
  | { ok: true; dryRun: boolean }
  | { ok: false; message: string };

const ROOT_FILES_WITHOUT_PARENT = new Set(['Home.md', 'README.md', 'CLAUDE.md', 'GEMINI.md', 'AGENTS.md', 'SANOOK.md']);
const ROOT_FILES_WITHOUT_UP = ROOT_FILES_WITHOUT_PARENT;
const SKIP_DIRS = new Set(['.git', '.obsidian', 'node_modules', 'Shared/Context7-Docs']);
const PURPOSE_PLACEHOLDER = '> _(purpose pending — fill in)_\n\n';

export function parseBrainRepairArgs(args: string[]): BrainRepairArgsResult {
  for (const arg of args) {
    if (arg === '--dry-run') continue;
    return { ok: false, message: `ไม่รู้จัก option: ${arg}` };
  }
  return { ok: true, dryRun: args.includes('--dry-run') };
}

export function planPurposeFix(relPath: string, content: string): BrainRepairAction | undefined {
  if (/^>\s+/m.test(content)) return undefined;
  return {
    id: 'repair.purpose-blockquote',
    relPath,
    kind: 'markdown',
    message: 'Add purpose blockquote after frontmatter.',
  };
}

export function planParentFix(relPath: string, content: string): BrainRepairAction | undefined {
  if (ROOT_FILES_WITHOUT_PARENT.has(relPath)) return undefined;
  if (/^---[\s\S]*?^parent:/m.test(content)) return undefined;
  const parent = inferParentRelPath(relPath);
  return {
    id: 'repair.parent-frontmatter',
    relPath,
    kind: 'markdown',
    message: `Add parent frontmatter -> [[${parent}]]`,
  };
}

export function planUpLinkFix(relPath: string, content: string): BrainRepairAction | undefined {
  if (ROOT_FILES_WITHOUT_UP.has(relPath)) return undefined;
  if (content.includes('up:: [[')) return undefined;
  const parent = inferParentRelPath(relPath);
  return {
    id: 'repair.up-link',
    relPath,
    kind: 'markdown',
    message: `Append up:: [[${parent}]]`,
  };
}

export function applyPurposeFix(content: string): string {
  if (/^>\s+/m.test(content)) return content;
  const match = content.match(/^---[\s\S]*?---\n?/);
  if (match) return content.replace(match[0], `${match[0]}${PURPOSE_PLACEHOLDER}`);
  return `${PURPOSE_PLACEHOLDER}${content}`;
}

export function applyParentFix(content: string, relPath: string): string {
  if (/^---[\s\S]*?^parent:/m.test(content)) return content;
  const parent = inferParentRelPath(relPath);
  const parentLine = `parent: "[[${parent}]]"`;
  const match = content.match(/^---\n([\s\S]*?)---\n/);
  if (!match) return `---\n${parentLine}\n---\n\n${content}`;
  return content.replace(/^---\n/, `---\n${parentLine}\n`);
}

export function applyUpLinkFix(content: string, relPath: string): string {
  if (content.includes('up:: [[')) return content;
  const parent = inferParentRelPath(relPath);
  return `${content.trimEnd()}\n\nup:: [[${parent}]]\n`;
}

export function applyMarkdownRepairs(relPath: string, content: string): { content: string; applied: string[] } {
  let next = content;
  const applied: string[] = [];
  if (planPurposeFix(relPath, next)) {
    next = applyPurposeFix(next);
    applied.push('purpose-blockquote');
  }
  if (planParentFix(relPath, next)) {
    next = applyParentFix(next, relPath);
    applied.push('parent-frontmatter');
  }
  if (planUpLinkFix(relPath, next)) {
    next = applyUpLinkFix(next, relPath);
    applied.push('up-link');
  }
  return { content: next, applied };
}

export function planContextPackIndexFix(packName: string, indexContent: string): BrainRepairAction | undefined {
  const link = `[[Shared/Context-Packs/${packName}]]`;
  if (indexContent.includes(link)) return undefined;
  return {
    id: 'repair.context-pack-index',
    relPath: 'Shared/Context-Packs/_Index.md',
    kind: 'index',
    message: `Link ${packName} from Context-Packs/_Index.md`,
  };
}

export function applyContextPackIndexFix(indexContent: string, packName: string, packContent: string): string {
  const link = `[[Shared/Context-Packs/${packName}]]`;
  if (indexContent.includes(link)) return indexContent;
  const description = extractBlockquotePurpose(packContent) || 'context pack';
  const line = `- ${link} — ${description}`;
  const marker = '\n## Use Rule';
  if (indexContent.includes(marker)) return indexContent.replace(marker, `\n${line}\n${marker}`);
  const upMarker = '\nup:: [[Shared/_Index]]';
  if (indexContent.includes(upMarker)) return indexContent.replace(upMarker, `\n${line}\n${upMarker}`);
  return `${indexContent.trimEnd()}\n${line}\n`;
}

export async function collectRepairActions(
  brainPath: string,
  expectedFolders: readonly string[] = FOLDERS.map((folder) => folder.dir),
): Promise<BrainRepairAction[]> {
  const actions: BrainRepairAction[] = [];

  const folderCheck = await checkBrainFolders(brainPath, expectedFolders);
  for (const missing of folderCheck.details ?? []) {
    actions.push({
      id: 'repair.missing-folder',
      relPath: missing,
      kind: 'folder',
      message: `Create missing folder: ${missing}`,
    });
  }

  for (const relPath of await listMarkdown(brainPath)) {
    const content = await readText(join(brainPath, relPath));
    for (const plan of [planPurposeFix, planParentFix, planUpLinkFix]) {
      const action = plan(relPath, content);
      if (action) actions.push(action);
    }
  }

  const packsDir = join(brainPath, 'Shared', 'Context-Packs');
  const indexPath = join(packsDir, '_Index.md');
  const indexContent = await readText(indexPath);
  let entries;
  try {
    entries = await readdir(packsDir, { withFileTypes: true });
  } catch {
    return actions;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === '_Index.md') continue;
    const packName = normalizeContextPackName(entry.name);
    const action = planContextPackIndexFix(packName, indexContent);
    if (action) actions.push(action);
  }

  return actions;
}

export async function repairBrain(options: RepairBrainOptions = {}): Promise<BrainRepairReport> {
  const dryRun = options.dryRun ?? false;
  const warnings: string[] = [];
  const brainPath = options.brainPath;
  if (!brainPath) {
    return { ok: false, dryRun, actions: [], applied: [], warnings: ['No second-brain path is configured.'] };
  }
  if (!(await pathExistsAsDir(brainPath))) {
    return { ok: false, brainPath, dryRun, actions: [], applied: [], warnings: ['Configured second-brain path does not exist or is not a directory.'] };
  }

  const actions = await collectRepairActions(brainPath, options.expectedFolders);
  if (dryRun) {
    return { ok: true, brainPath, dryRun, actions, applied: [], warnings };
  }

  const applied: string[] = [];
  const markdownUpdates = new Map<string, { content: string; applied: string[] }>();

  for (const action of actions) {
    if (action.kind === 'folder') {
      await mkdir(join(brainPath, action.relPath), { recursive: true });
      applied.push(`${action.relPath}: created folder`);
      continue;
    }

    if (action.kind === 'index' && action.id === 'repair.context-pack-index') {
      const indexPath = join(brainPath, action.relPath);
      const indexContent = await readText(indexPath);
      if (!indexContent) {
        warnings.push(`Skipped ${action.relPath}: index file missing.`);
        continue;
      }
      const packName = action.message.match(/Link ([^\s]+) from/)?.[1];
      if (!packName) continue;
      const packContent = await readText(join(brainPath, 'Shared', 'Context-Packs', `${packName}.md`));
      const next = applyContextPackIndexFix(indexContent, packName, packContent);
      if (next !== indexContent) {
        await writeFile(indexPath, next, 'utf8');
        applied.push(`${action.relPath}: linked ${packName}`);
      }
      continue;
    }

    if (action.kind === 'markdown') {
      const current = markdownUpdates.get(action.relPath)?.content ?? (await readText(join(brainPath, action.relPath)));
      const repaired = applyMarkdownRepairs(action.relPath, current);
      if (repaired.applied.length) {
        const prior = markdownUpdates.get(action.relPath)?.applied ?? [];
        markdownUpdates.set(action.relPath, { content: repaired.content, applied: uniqueSorted([...prior, ...repaired.applied]) });
      }
    }
  }

  for (const [relPath, update] of markdownUpdates) {
    await writeFile(join(brainPath, relPath), update.content, 'utf8');
    applied.push(`${relPath}: ${update.applied.join(', ')}`);
  }

  return { ok: true, brainPath, dryRun, actions, applied, warnings };
}

export function formatBrainRepairReport(report: BrainRepairReport): string {
  const lines = ['Sanook brain repair', `vault: ${report.brainPath ?? '(not configured)'}`];
  lines.push(`mode: ${report.dryRun ? 'dry-run' : 'apply'}`);
  lines.push(`planned: ${report.actions.length} fix(es)`);
  for (const action of report.actions) {
    lines.push(`- [${action.id}] ${action.relPath} — ${action.message}`);
  }
  if (!report.dryRun) {
    lines.push(`applied: ${report.applied.length}`);
    for (const item of report.applied) lines.push(`  ✓ ${item}`);
  }
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  return lines.join('\n');
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

async function pathExistsAsDir(path: string): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises');
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

function extractBlockquotePurpose(content: string): string {
  const body = content.replace(/^---[\s\S]*?---\n?/, '');
  const match = body.match(/^>\s*(.+)$/m);
  return match?.[1]?.trim() ?? '';
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
