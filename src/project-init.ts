import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BRAND, appProjectPath } from './brand.js';
import { loadConfig } from './config.js';
import { projectRoot, projectTrustStatus, trustProject } from './trust.js';

export const STARTER_COMMANDS: Record<string, { description: string; body: string }> = {
  review: {
    description: 'Review recent changes before commit',
    body: `Review the recent changes in this repo. Focus on bugs, regressions, and missing tests.

$ARGUMENTS`,
  },
  plan: {
    description: 'Plan a task without modifying files yet',
    body: `Plan how to accomplish the following without modifying any files yet. Break down steps, risks, and a test approach.

$ARGUMENTS`,
  },
};

export interface ProjectInitOptions {
  cwd?: string;
  trust?: boolean;
}

export interface ProjectInitResult {
  root: string;
  created: string[];
  skipped: string[];
  trusted: boolean;
  hints: string[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function commandTemplate(name: string, spec: { description: string; body: string }): string {
  return ['---', `description: ${spec.description}`, '---', '', spec.body.trim(), ''].join('\n');
}

export async function scaffoldProjectCommands(root: string): Promise<{ created: string[]; skipped: string[] }> {
  const commandsDir = appProjectPath(root, 'commands');
  await mkdir(commandsDir, { recursive: true });
  const created: string[] = [];
  const skipped: string[] = [];

  for (const [name, spec] of Object.entries(STARTER_COMMANDS)) {
    const rel = join(BRAND.configDirName, 'commands', `${name}.md`);
    const path = join(commandsDir, `${name}.md`);
    if (await exists(path)) {
      skipped.push(rel);
      continue;
    }
    await writeFile(path, commandTemplate(name, spec));
    created.push(rel);
  }

  return { created, skipped };
}

export async function buildInitHints(root: string, trusted: boolean): Promise<string[]> {
  const hints: string[] = [];
  const config = await loadConfig({}, root);

  if (!config.brainPath?.trim()) {
    hints.push(`${BRAND.cliName} brain init — สร้าง second-brain vault แล้วเก็บ path ใน config.brainPath`);
  } else if (!(await exists(config.brainPath))) {
    hints.push(`config.brainPath ชี้ไป path ที่ไม่มี: ${config.brainPath} — รัน ${BRAND.cliName} brain init หรือแก้ config`);
  }

  hints.push(`${BRAND.cliName} mcp preset dev — ดู MCP starter pack สำหรับ repo/issues/docs/debug`);

  if (!trusted) {
    hints.push(`${BRAND.cliName} trust add — เปิดใช้ project .sanook/commands ใน REPL (ต้อง trust ก่อน)`);
  }

  return hints;
}

export function formatInitResult(result: ProjectInitResult): string {
  const lines = [`initialized ${result.root}`];
  if (result.created.length) lines.push(`created: ${result.created.join(', ')}`);
  if (result.skipped.length) lines.push(`skipped (already exists): ${result.skipped.join(', ')}`);
  if (result.trusted) lines.push('trusted: yes');
  if (result.hints.length) {
    lines.push('', 'next:');
    for (const hint of result.hints) lines.push(`  ${hint}`);
  }
  return lines.join('\n');
}

/** sanook init — scaffold project .sanook/commands + optional trust + onboarding hints */
export async function initProject(options: ProjectInitOptions = {}): Promise<ProjectInitResult> {
  const cwd = options.cwd ?? process.cwd();
  const root = await projectRoot(cwd);
  const { created, skipped } = await scaffoldProjectCommands(root);

  let trusted = (await projectTrustStatus(root)).trusted;
  if (options.trust && !trusted) {
    await trustProject(root);
    trusted = true;
  }

  const hints = await buildInitHints(root, trusted);
  return { root, created, skipped, trusted, hints };
}
