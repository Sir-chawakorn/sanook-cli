import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VaultProject } from './project-registry.js';

export interface ScaffoldProjectOptions {
  brainPath: string;
  title: string;
  slug?: string;
  repoPath?: string;
  verify?: string;
  defaultBranch?: string;
  today?: string;
  force?: boolean;
}

export interface ScaffoldProjectReport {
  ok: boolean;
  brainPath: string;
  slug: string;
  title: string;
  relDir: string;
  created: string[];
  skipped: string[];
  indexed: boolean;
  warnings: string[];
}

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'second-brain', 'Templates', 'project-workspace');

const WORKSPACE_FILES = ['_Index.md', 'overview.md', 'current-state.md', 'context.md', 'repo.md'] as const;

export function slugifyProject(value: string): string {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'project';
}

function renderTemplate(raw: string, vars: Record<string, string>): string {
  let out = raw;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

async function readTemplate(name: string): Promise<string> {
  return readFile(join(TEMPLATE_ROOT, name), 'utf8');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function maybeAppendProjectsIndex(brainPath: string, slug: string, title: string): Promise<boolean> {
  const indexPath = join(brainPath, 'Projects', '_Index.md');
  let content: string;
  try {
    content = await readFile(indexPath, 'utf8');
  } catch {
    return false;
  }
  const link = `[[Projects/${slug}/_Index]]`;
  if (content.includes(link)) return false;
  const line = `- ${link} — ${title}`;
  const marker = 'up:: [[Home]]';
  const next = content.includes(marker) ? content.replace(marker, `${line}\n\n${marker}`) : `${content.trimEnd()}\n${line}\n`;
  await writeFile(indexPath, next, 'utf8');
  return true;
}

export async function scaffoldProjectWorkspace(options: ScaffoldProjectOptions): Promise<ScaffoldProjectReport> {
  const brainPath = resolve(options.brainPath);
  const title = options.title.trim() || 'Project';
  const slug = options.slug?.trim() || slugifyProject(title);
  const relDir = `Projects/${slug}`;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const repoPath = options.repoPath?.trim() ?? '';
  const verify = options.verify?.trim() ?? 'npm test && npm run typecheck';
  const defaultBranch = options.defaultBranch?.trim() ?? 'main';
  const created: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  const vars: Record<string, string> = {
    DATE: today,
    TITLE: title,
    SLUG: slug,
    REPO_PATH: repoPath,
    VERIFY: verify,
    DEFAULT_BRANCH: defaultBranch,
  };

  for (const name of WORKSPACE_FILES) {
    const rel = `${relDir}/${name}`;
    const path = join(brainPath, rel);
    if ((await fileExists(path)) && !options.force) {
      skipped.push(rel);
      continue;
    }
    await mkdir(dirname(path), { recursive: true });
    const raw = await readTemplate(name);
    await writeFile(path, renderTemplate(raw, vars), 'utf8');
    created.push(rel);
  }

  if (!created.length && skipped.length) {
    return {
      ok: false,
      brainPath,
      slug,
      title,
      relDir,
      created,
      skipped,
      indexed: false,
      warnings: ['Project workspace already exists. Re-run with --force to overwrite scaffold files.'],
    };
  }

  const indexed = await maybeAppendProjectsIndex(brainPath, slug, title);
  if (!indexed) warnings.push('Projects/_Index.md was not updated (missing or link already present).');

  return { ok: true, brainPath, slug, title, relDir, created, skipped, indexed, warnings };
}

export function formatScaffoldProjectReport(report: ScaffoldProjectReport): string {
  const lines = ['Sanook brain new project (workspace scaffold)'];
  lines.push(`vault: ${report.brainPath}`);
  lines.push(`slug: ${report.slug}`);
  lines.push(`title: ${report.title}`);
  lines.push(`dir: ${report.relDir}/`);
  if (report.created.length) {
    lines.push(`created (${report.created.length}):`);
    for (const rel of report.created) lines.push(`  ${rel}`);
  }
  if (report.skipped.length) {
    lines.push(`skipped (${report.skipped.length}):`);
    for (const rel of report.skipped) lines.push(`  ${rel}`);
  }
  if (report.indexed) lines.push('index: Projects/_Index.md updated');
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  return lines.join('\n');
}

export type { VaultProject };
