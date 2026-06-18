import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ParsedBrainFinalArgs {
  task?: string;
  fromDiff: boolean;
  lite: boolean;
  force: boolean;
  output?: string;
}

export type BrainFinalArgsResult =
  | { ok: true; value: ParsedBrainFinalArgs }
  | { ok: false; message: string };

export interface BrainFinalReport {
  ok: boolean;
  brainPath?: string;
  path?: string;
  relPath?: string;
  task: string;
  template: 'final.md' | 'final-lite.md';
  fromDiff: boolean;
  diffFiles: string[];
  indexed: boolean;
  warnings: string[];
}

export interface CreateBrainFinalOptions {
  brainPath?: string;
  today?: string;
  task?: string;
  fromDiff?: boolean;
  lite?: boolean;
  force?: boolean;
  output?: string;
  diffFiles?: string[];
  diffProvider?: () => Promise<string[]>;
}

export interface FinalGateValidation {
  ok: boolean;
  warnings: string[];
}

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'second-brain', 'Templates');
const FINAL_HEADINGS = [
  '## 1. Objective / DoD Lock',
  '## 2. Evidence-Backed Checklist',
  '## 3. Status Matrix',
  '## 4. Evidence Matrix',
  '## 5. Residual Risk',
  '## 6. Change Summary Audit',
  '## 7. Final Answer Draft',
  '## 8. Second-Brain Routing / Memory Closeout',
];
const STATUS_TOKENS = new Set(['PASS', 'PARTIAL', 'FAIL', 'N/A', 'BLOCKED', 'TODO']);
const PASS_STATUS = 'PASS';

export function parseBrainFinalArgs(args: string[]): BrainFinalArgsResult {
  const positional: string[] = [];
  const parsed: ParsedBrainFinalArgs = { fromDiff: false, lite: false, force: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--from-diff') {
      parsed.fromDiff = true;
    } else if (arg === '--lite') {
      parsed.lite = true;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--task') {
      const value = args[++i];
      if (!value?.trim()) return { ok: false, message: 'ต้องระบุค่าให้ --task' };
      parsed.task = value.trim();
    } else if (arg.startsWith('--task=')) {
      const value = arg.slice('--task='.length).trim();
      if (!value) return { ok: false, message: 'ต้องระบุค่าให้ --task' };
      parsed.task = value;
    } else if (arg === '--output') {
      const value = args[++i];
      if (!value?.trim()) return { ok: false, message: 'ต้องระบุค่าให้ --output' };
      parsed.output = value.trim();
    } else if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim();
      if (!value) return { ok: false, message: 'ต้องระบุค่าให้ --output' };
      parsed.output = value;
    } else if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith('-')) {
      return { ok: false, message: `ไม่รู้จัก option: ${arg}` };
    } else {
      positional.push(arg);
    }
  }

  const positionalTask = positional.join(' ').trim();
  if (parsed.task && positionalTask) return { ok: false, message: 'ระบุ task ได้ครั้งเดียว: ใช้ positional หรือ --task อย่างใดอย่างหนึ่ง' };
  if (positionalTask) parsed.task = positionalTask;
  return { ok: true, value: parsed };
}

export async function createBrainFinal(options: CreateBrainFinalOptions): Promise<BrainFinalReport> {
  const task = (options.task ?? 'current task').trim() || 'current task';
  const template: BrainFinalReport['template'] = options.lite ? 'final-lite.md' : 'final.md';
  const warnings: string[] = [];
  if (!options.brainPath) {
    return { ok: false, task, template, fromDiff: !!options.fromDiff, diffFiles: [], indexed: false, warnings: ['No second-brain path is configured.'] };
  }

  const brainPath = resolve(options.brainPath);
  if (!(await pathExistsAsDir(brainPath))) {
    return {
      ok: false,
      brainPath,
      task,
      template,
      fromDiff: !!options.fromDiff,
      diffFiles: [],
      indexed: false,
      warnings: ['Configured second-brain path does not exist or is not a directory.'],
    };
  }

  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const slug = slugify(task || 'final-gate');
  const output = outputPath(brainPath, options.output ?? join('Sessions', `${today}-${slug}-final.md`));
  if (!output.ok) {
    return { ok: false, brainPath, task, template, fromDiff: !!options.fromDiff, diffFiles: [], indexed: false, warnings: [output.message] };
  }

  if ((await fileExists(output.path)) && !options.force) {
    return {
      ok: false,
      brainPath,
      path: output.path,
      relPath: vaultRel(brainPath, output.path),
      task,
      template,
      fromDiff: !!options.fromDiff,
      diffFiles: [],
      indexed: false,
      warnings: ['Final gate file already exists. Re-run with --force or choose --output.'],
    };
  }

  const diffFiles = options.fromDiff
    ? uniqueSorted(options.diffFiles ?? (await (options.diffProvider ?? defaultDiffFiles)()))
    : [];
  const raw = await readTemplate(brainPath, template);
  let content = instantiateTemplate(raw, { today, task, template, fromDiff: !!options.fromDiff, diffFiles });
  if (template === 'final-lite.md') content = content.replace('note_type: template', 'note_type: final-gate-lite');
  else content = content.replace('note_type: template', 'note_type: final-gate');

  await mkdir(dirname(output.path), { recursive: true });
  await writeFile(output.path, content, 'utf8');
  const relPath = vaultRel(brainPath, output.path);
  const indexed = await maybeAppendSessionIndex(brainPath, relPath, task);
  if (options.fromDiff && diffFiles.length === 0) warnings.push('No git worktree changes were detected for --from-diff.');

  return { ok: true, brainPath, path: output.path, relPath, task, template, fromDiff: !!options.fromDiff, diffFiles, indexed, warnings };
}

export function formatBrainFinalReport(report: BrainFinalReport): string {
  const lines = ['Sanook brain final'];
  lines.push(`vault: ${report.brainPath ?? '(not configured)'}`);
  lines.push(`task: ${report.task}`);
  lines.push(`template: ${report.template}`);
  if (report.path) lines.push(`created: ${report.path}`);
  if (report.relPath) lines.push(`link: [[${report.relPath.replace(/\.md$/i, '')}]]`);
  if (report.fromDiff) lines.push(`from-diff: ${report.diffFiles.length} file(s)`);
  if (report.indexed) lines.push('sessions-index: updated');
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  return lines.join('\n');
}

export async function listFinalGateFiles(brainPath: string): Promise<Array<{ relPath: string; path: string; content: string }>> {
  const sessionsDir = join(brainPath, 'Sessions');
  const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const out: Array<{ relPath: string; path: string; content: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === '_Index.md') continue;
    const relPath = `Sessions/${entry.name}`;
    const path = join(brainPath, relPath);
    const content = await readText(path);
    if (isFinalGateContent(content, entry.name)) out.push({ relPath, path, content });
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

export function validateFinalGateContent(content: string): FinalGateValidation {
  const warnings: string[] = [];
  for (const heading of FINAL_HEADINGS) {
    if (!content.includes(heading)) warnings.push(`Missing final gate section: ${heading}`);
  }
  if (!content.includes('## Final Verdict')) warnings.push('Missing final verdict section.');
  if (!content.includes('If a row has no evidence')) warnings.push('Missing explicit evidence rule: "If a row has no evidence".');

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!isTableHeader(lines, i)) continue;
    const headers = tableCells(lines[i]).map((cell) => normalizeHeader(cell));
    const statusIndex = headers.findIndex((header) => header === 'status' || header === 'verdict');
    const evidenceIndex = headers.findIndex((header) => header === 'evidence' || header === 'important output' || header === 'scope proven');
    if (statusIndex < 0) continue;
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = tableCells(lines[j]);
      if (!cells.length || isSeparatorRow(cells)) continue;
      const status = normalizeStatus(cells[statusIndex]);
      if (!status) continue;
      const rowName = cells[0]?.replace(/`/g, '').trim() || `row ${j + 1}`;
      if (status === 'TODO') warnings.push(`TODO status remains in final gate row: ${rowName}`);
      if (status === PASS_STATUS && evidenceIndex >= 0 && isPlaceholderEvidence(cells[evidenceIndex] ?? '')) {
        warnings.push(`PASS row has no evidence: ${rowName}`);
      }
    }
  }

  const placeholders = content.match(/<[^>\n]+>/g) ?? [];
  const meaningfulPlaceholders = placeholders.filter(isTemplatePlaceholder);
  if (meaningfulPlaceholders.length) warnings.push(`Unfilled placeholder(s) remain: ${uniqueSorted(meaningfulPlaceholders).slice(0, 5).join(', ')}`);

  return { ok: warnings.length === 0, warnings };
}

function instantiateTemplate(
  raw: string,
  options: { today: string; task: string; template: BrainFinalReport['template']; fromDiff: boolean; diffFiles: string[] },
): string {
  const titleTask = options.task;
  let content = raw
    .replaceAll('YYYY-MM-DD', options.today)
    .replaceAll('<task/topic>', titleTask)
    .replace('tags: [template, final-gate, verification, dod]', 'tags: [final-gate, verification, dod]')
    .replace('tags: [template, final-gate, verification, lite]', 'tags: [final-gate, verification, lite]')
    .replace('parent: "[[Templates/_Index]]"', 'parent: "[[Sessions/_Index]]"')
    .replace('up:: [[Templates/_Index]]', 'up:: [[Sessions/_Index]]')
    .replace('<paste owner request or goal text here>', options.task);

  if (options.fromDiff) content = injectDiffEvidence(content, options.diffFiles);
  return content;
}

function injectDiffEvidence(content: string, diffFiles: string[]): string {
  const fileRows = diffFiles.length
    ? diffFiles.map((file) => `| \`${file}\` | TODO: summarize change | \`git status --short\` / \`git diff -- ${file}\` |`).join('\n')
    : '| `(no git worktree changes detected)` | N/A | `git status --short` |';
  const commandRows = diffFiles.length
    ? '| `git status --short` | TODO | Populated by `--from-diff`; review before marking PASS. | Current worktree changed paths. |'
    : '| `git status --short` | N/A | No changed paths detected by `--from-diff`. | Worktree scan only. |';

  return replaceFilesChangedRows(content.replace('| `<command>` | TODO |  |  |', commandRows), fileRows);
}

function replaceFilesChangedRows(content: string, fileRows: string): string {
  const fullPattern = /(Files changed:\n\n\| File\/path \| Change summary \| Evidence \|\n\|---\|---\|---\|\n)\| `(?:<path>|<file>)` \|  \|  \|/;
  const litePattern = /(Changed files:\n\n\| File \| Change summary \| Evidence \|\n\|---\|---\|---\|\n)\| `(?:<path>|<file>)` \|  \|  \|/;
  return content.replace(fullPattern, `$1${fileRows}`).replace(litePattern, `$1${fileRows}`);
}

async function readTemplate(brainPath: string, template: BrainFinalReport['template']): Promise<string> {
  const vaultTemplate = join(brainPath, 'Templates', template);
  const fromVault = await readText(vaultTemplate);
  if (fromVault) return fromVault;
  return readFile(join(TEMPLATE_ROOT, template), 'utf8');
}

async function defaultDiffFiles(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1'], { cwd: process.cwd(), encoding: 'utf8' });
    return stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map(parsePorcelainPath)
      .filter((path): path is string => !!path);
  } catch {
    return [];
  }
}

function parsePorcelainPath(line: string): string | undefined {
  const raw = line.slice(3).trim();
  if (!raw) return undefined;
  const renameIndex = raw.lastIndexOf(' -> ');
  return renameIndex >= 0 ? raw.slice(renameIndex + 4) : raw;
}

function outputPath(brainPath: string, output: string): { ok: true; path: string } | { ok: false; message: string } {
  const path = resolve(isAbsolute(output) ? output : join(brainPath, output));
  const rel = relative(brainPath, path);
  if (rel.startsWith('..') || isAbsolute(rel)) return { ok: false, message: '--output must stay inside the configured second-brain vault.' };
  return { ok: true, path };
}

async function maybeAppendSessionIndex(brainPath: string, relPath: string, task: string): Promise<boolean> {
  if (!relPath.startsWith('Sessions/') || relPath.endsWith('/_Index.md')) return false;
  const indexPath = join(brainPath, 'Sessions', '_Index.md');
  const content = await readText(indexPath);
  if (!content) return false;
  const note = relPath.replace(/\.md$/i, '');
  const link = `[[${note}]]`;
  if (content.includes(link)) return false;
  const line = `- ${link} — final gate: ${task}`;
  const marker = '\nup:: [[Home]]';
  const next = content.includes(marker) ? content.replace(marker, `\n${line}\n${marker}`) : `${content.trimEnd()}\n${line}\n`;
  await writeFile(indexPath, next, 'utf8');
  return true;
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'final-gate';
}

function vaultRel(brainPath: string, path: string): string {
  return relative(brainPath, path).split(sep).join('/');
}

function isFinalGateContent(content: string, fileName: string): boolean {
  return (
    /^note_type:\s*final-gate/m.test(content) ||
    /^note_type:\s*final-gate-lite/m.test(content) ||
    (content.includes('## Final Verdict') && content.includes('## 1. Objective / DoD Lock')) ||
    /-final\.md$/i.test(fileName)
  );
}

function isTableHeader(lines: string[], index: number): boolean {
  return lines[index]?.trim().startsWith('|') && isSeparatorRow(tableCells(lines[index + 1] ?? ''));
}

function tableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return [];
  return trimmed
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function normalizeHeader(value: string): string {
  return value.replace(/`/g, '').trim().toLowerCase();
}

function normalizeStatus(value: string): string | undefined {
  const cleaned = value.replace(/`/g, '').trim().toUpperCase();
  return STATUS_TOKENS.has(cleaned) ? cleaned : undefined;
}

function isPlaceholderEvidence(value: string): boolean {
  const cleaned = value
    .replace(/`/g, '')
    .replace(/<[^>]+>/g, (item) => (isTemplatePlaceholder(item) ? '' : item))
    .trim();
  return !cleaned || cleaned === '-' || cleaned === '—' || /^TODO\b/i.test(cleaned) || cleaned === '|';
}

function isTemplatePlaceholder(value: string): boolean {
  const inner = value.slice(1, -1).trim();
  if (!inner || inner.includes('e.g.')) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(inner)) return false;
  if (/^mailto:\S+$/i.test(inner)) return false;
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(inner)) return false;
  return true;
}

async function pathExistsAsDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
