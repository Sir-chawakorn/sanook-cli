import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineValue, takeValue } from './cli-option-values.js';

export type BrainNoteType = 'session' | 'bug' | 'handoff' | 'project' | 'golden-case' | 'checklist';

export interface BrainNoteTypeConfig {
  destDir: string;
  templateCandidates: readonly string[];
  defaultRelPath: (ctx: { today: string; slug: string }) => string;
  titlePlaceholders: readonly string[];
}

export interface ParsedBrainNewArgs {
  type: BrainNoteType;
  title?: string;
  force: boolean;
  output?: string;
}

export type BrainNewArgsResult =
  | { ok: true; value: ParsedBrainNewArgs }
  | { ok: false; message: string };

export interface BrainNewReport {
  ok: boolean;
  brainPath?: string;
  type?: BrainNoteType;
  title: string;
  template?: string;
  path?: string;
  relPath?: string;
  indexed: boolean;
  warnings: string[];
}

export interface CreateBrainNoteOptions {
  brainPath?: string;
  type: BrainNoteType;
  title?: string;
  today?: string;
  force?: boolean;
  output?: string;
}

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'second-brain');

export const BRAIN_NOTE_TYPES: Record<BrainNoteType, BrainNoteTypeConfig> = {
  session: {
    destDir: 'Sessions',
    templateCandidates: ['Templates/session.md'],
    defaultRelPath: ({ today, slug }) => `Sessions/${today}-${slug}.md`,
    titlePlaceholders: ['<topic>', '<task/topic>'],
  },
  bug: {
    destDir: 'Bugs',
    templateCandidates: ['Templates/bug.md'],
    defaultRelPath: ({ today, slug }) => `Bugs/${today}-${slug}.md`,
    titlePlaceholders: ['<bug>'],
  },
  handoff: {
    destDir: 'Handoffs',
    templateCandidates: ['Templates/handoff.md'],
    defaultRelPath: ({ slug }) => `Handoffs/${slug}-handoff.md`,
    titlePlaceholders: ['<project>'],
  },
  project: {
    destDir: 'Projects',
    templateCandidates: ['Templates/project.md'],
    defaultRelPath: ({ slug }) => `Projects/${slug}.md`,
    titlePlaceholders: ['<Project Name>'],
  },
  'golden-case': {
    destDir: 'Acceptance',
    templateCandidates: ['Templates/golden-case.md', 'Acceptance/golden-case-template.md'],
    defaultRelPath: ({ slug }) => `Acceptance/${slug}.md`,
    titlePlaceholders: ['Golden Case Template', '<input>', '<expected>'],
  },
  checklist: {
    destDir: 'Checklists',
    templateCandidates: ['Templates/checklist.md', 'Checklists/preflight-postflight-template.md'],
    defaultRelPath: ({ slug }) => `Checklists/${slug}-checklist.md`,
    titlePlaceholders: ['Preflight / Postflight Checklist Template'],
  },
};

export function isBrainNoteType(value: string): value is BrainNoteType {
  return Object.hasOwn(BRAIN_NOTE_TYPES, value);
}

export function parseBrainNewArgs(args: string[]): BrainNewArgsResult {
  const [typeArg, ...rest] = args;
  if (!typeArg) return { ok: false, message: 'ต้องระบุ note type' };
  if (!isBrainNoteType(typeArg)) {
    return { ok: false, message: `ไม่รู้จัก note type: ${typeArg}` };
  }

  const parsed: ParsedBrainNewArgs = { type: typeArg, force: false };
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--title' || arg.startsWith('--title=')) {
      const next = arg === '--title' ? takeValue(rest, i) : undefined;
      const value = next ? next.value : inlineValue('--title', arg);
      if (next) i = next.nextIndex;
      if (!value?.trim()) return { ok: false, message: 'ต้องระบุค่าให้ --title' };
      if (parsed.title) return { ok: false, message: 'ระบุ title ได้ครั้งเดียว' };
      parsed.title = value.trim();
    } else if (arg === '--output') {
      const next = takeValue(rest, i);
      const value = next.value;
      i = next.nextIndex;
      if (!value?.trim()) return { ok: false, message: 'ต้องระบุค่าให้ --output' };
      if (parsed.output !== undefined) return { ok: false, message: 'ระบุ output ได้ครั้งเดียว' };
      parsed.output = value.trim();
    } else if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim();
      if (!value) return { ok: false, message: 'ต้องระบุค่าให้ --output' };
      if (parsed.output !== undefined) return { ok: false, message: 'ระบุ output ได้ครั้งเดียว' };
      parsed.output = value;
    } else if (arg === '--') {
      positional.push(...rest.slice(i + 1));
      break;
    } else if (arg.startsWith('-')) {
      return { ok: false, message: `ไม่รู้จัก option: ${arg}` };
    } else {
      positional.push(arg);
    }
  }

  const positionalTitle = positional.join(' ').trim();
  if (parsed.title && positionalTitle) return { ok: false, message: 'ระบุ title ได้ครั้งเดียว: ใช้ positional หรือ --title อย่างใดอย่างหนึ่ง' };
  if (positionalTitle) parsed.title = positionalTitle;
  return { ok: true, value: parsed };
}

export function inferParentRelPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  parts.pop();
  if (!parts.length) return 'Home';
  return `${parts.join('/')}/_Index`;
}

export function destinationIndexRelPath(type: BrainNoteType, relPath: string): string {
  const config = BRAIN_NOTE_TYPES[type];
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized.startsWith(`${config.destDir}/`) && normalized.includes('/')) {
    const nested = normalized.slice(config.destDir.length + 1);
    if (nested.includes('/')) {
      const subDir = nested.split('/')[0];
      return `${config.destDir}/${subDir}/_Index`;
    }
  }
  return `${config.destDir}/_Index`;
}

export function validateNoteOutputPath(type: BrainNoteType, relPath: string): { ok: true } | { ok: false; message: string } {
  const config = BRAIN_NOTE_TYPES[type];
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized.endsWith('/_Index.md') || normalized === '_Index.md') {
    return { ok: false, message: 'Cannot create a note at an _Index.md path.' };
  }
  if (!normalized.startsWith(`${config.destDir}/`)) {
    return { ok: false, message: `${type} notes must stay under ${config.destDir}/.` };
  }
  return { ok: true };
}

export function instantiateNoteTemplate(
  raw: string,
  options: { today: string; title: string; parent: string; type: BrainNoteType },
): string {
  let content = raw.replaceAll('YYYY-MM-DD', options.today).replaceAll('{{DATE}}', options.today);
  const config = BRAIN_NOTE_TYPES[options.type];
  for (const placeholder of config.titlePlaceholders) {
    content = content.replaceAll(placeholder, options.title);
  }
  content = content.replace(/^# .+$/m, (heading) => {
    if (heading.includes(options.title)) return heading;
    if (options.type === 'session') return `# ${options.today} — ${options.title}`;
    if (options.type === 'bug') return `# ${options.today} — ${options.title}`;
    if (options.type === 'handoff') return `# ${options.title} — Handoff`;
    if (options.type === 'project') return `# ${options.title}`;
    if (options.type === 'golden-case') return `# ${options.title}`;
    if (options.type === 'checklist') return `# ${options.title}`;
    return heading;
  });

  const parentValue = `"[[${options.parent}]]"`;
  if (/^parent:/m.test(content)) {
    content = content.replace(/^parent:.*$/m, `parent: ${parentValue}`);
  } else if (/^---[\s\S]*?---/m.test(content)) {
    content = content.replace(/^---\n/m, `---\nparent: ${parentValue}\n`);
  }

  const upLink = `up:: [[${options.parent}]]`;
  if (content.includes('up:: [[')) content = content.replace(/^up:: \[\[[^\]]+\]\]\s*$/m, upLink);
  else content = `${content.trimEnd()}\n\n${upLink}\n`;

  if (options.type === 'golden-case') content = content.replace(/^note_type:\s*template/m, 'note_type: golden-case');
  if (options.type === 'checklist') content = content.replace(/^note_type:\s*template/m, 'note_type: checklist');
  content = content.replace(/^tags: \[template,/m, 'tags: [');
  return content;
}

export async function createBrainNote(options: CreateBrainNoteOptions): Promise<BrainNewReport> {
  const title = (options.title ?? defaultTitleForType(options.type)).trim() || defaultTitleForType(options.type);
  const warnings: string[] = [];
  if (!options.brainPath) {
    return { ok: false, title, indexed: false, warnings: ['No second-brain path is configured.'] };
  }

  const brainPath = resolve(options.brainPath);
  if (!(await pathExistsAsDir(brainPath))) {
    return { ok: false, brainPath, title, indexed: false, warnings: ['Configured second-brain path does not exist or is not a directory.'] };
  }

  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const slug = slugify(title);
  const config = BRAIN_NOTE_TYPES[options.type];
  const relPath = normalizeRelPath(options.output ?? config.defaultRelPath({ today, slug }));
  const valid = validateNoteOutputPath(options.type, relPath);
  if (!valid.ok) {
    return { ok: false, brainPath, type: options.type, title, indexed: false, warnings: [valid.message] };
  }

  const destIndexRel = destinationIndexRelPath(options.type, relPath);
  const indexPath = join(brainPath, `${destIndexRel}.md`);
  if (!(await fileExists(indexPath))) {
    warnings.push(`Destination index missing: ${destIndexRel}.md`);
  } else {
    await readFile(indexPath, 'utf8');
  }

  const outputPath = resolve(isAbsolute(relPath) ? relPath : join(brainPath, relPath));
  const insideVault = !relative(brainPath, outputPath).startsWith('..') && !isAbsolute(relative(brainPath, outputPath));
  if (!insideVault) {
    return { ok: false, brainPath, type: options.type, title, indexed: false, warnings: ['--output must stay inside the configured second-brain vault.'] };
  }

  if ((await fileExists(outputPath)) && !options.force) {
    return {
      ok: false,
      brainPath,
      type: options.type,
      title,
      path: outputPath,
      relPath,
      indexed: false,
      warnings: ['Note already exists. Re-run with --force or choose --output.'],
    };
  }

  const template = await readNoteTemplate(brainPath, options.type);
  if (!template.path) {
    return { ok: false, brainPath, type: options.type, title, indexed: false, warnings: [template.message] };
  }

  const parent = destinationIndexRelPath(options.type, relPath);
  const content = instantiateNoteTemplate(template.content, { today, title, parent, type: options.type });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, 'utf8');
  const indexed = await maybeAppendDestinationIndex(brainPath, destIndexRel, relPath, title, options.type);

  return {
    ok: true,
    brainPath,
    type: options.type,
    title,
    template: template.path,
    path: outputPath,
    relPath,
    indexed,
    warnings,
  };
}

export function formatBrainNewReport(report: BrainNewReport): string {
  const lines = ['Sanook brain new'];
  lines.push(`vault: ${report.brainPath ?? '(not configured)'}`);
  if (report.type) lines.push(`type: ${report.type}`);
  lines.push(`title: ${report.title}`);
  if (report.template) lines.push(`template: ${report.template}`);
  if (report.path) lines.push(`created: ${report.path}`);
  if (report.relPath) lines.push(`link: [[${report.relPath.replace(/\.md$/i, '')}]]`);
  if (report.indexed) lines.push('index: updated');
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  return lines.join('\n');
}

function defaultTitleForType(type: BrainNoteType): string {
  switch (type) {
    case 'session':
      return 'session note';
    case 'bug':
      return 'bug report';
    case 'handoff':
      return 'project handoff';
    case 'project':
      return 'project overview';
    case 'golden-case':
      return 'golden case';
    case 'checklist':
      return 'preflight postflight';
  }
}

async function readNoteTemplate(
  brainPath: string,
  type: BrainNoteType,
): Promise<{ path?: string; content: string; message: string }> {
  for (const candidate of BRAIN_NOTE_TYPES[type].templateCandidates) {
    const vaultPath = join(brainPath, candidate);
    const fromVault = await readText(vaultPath);
    if (fromVault) return { path: candidate, content: fromVault, message: '' };
    const bundledPath = join(TEMPLATE_ROOT, candidate);
    const fromBundled = await readText(bundledPath);
    if (fromBundled) return { path: candidate, content: fromBundled, message: '' };
  }
  return { content: '', message: `No template found for ${type}.` };
}

async function maybeAppendDestinationIndex(
  brainPath: string,
  indexRel: string,
  noteRel: string,
  title: string,
  type: BrainNoteType,
): Promise<boolean> {
  const indexPath = join(brainPath, `${indexRel}.md`);
  const content = await readText(indexPath);
  if (!content) return false;
  const note = noteRel.replace(/\.md$/i, '');
  const link = `[[${note}]]`;
  if (content.includes(link)) return false;
  const line = `- ${link} — ${type}: ${title}`;
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
  return slug || 'note';
}

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
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
