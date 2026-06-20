import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { BRAND } from './brand.js';
import { scaffoldProjectWorkspace } from './project-scaffold.js';

export interface LinkBrainToProjectOptions {
  brainPath: string;
  cwd?: string;
  title?: string;
  today?: string;
}

export interface LinkBrainToProjectReport {
  ok: boolean;
  brainPath: string;
  projectSlug?: string;
  projectRelDir?: string;
  memoryFile?: string;
  memoryCreated: boolean;
  warnings: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Wire a freshly scaffolded vault to the current repo: Projects/<slug>/ + SANOOK.md memory stub. */
export async function linkBrainToProject(options: LinkBrainToProjectOptions): Promise<LinkBrainToProjectReport> {
  const cwd = options.cwd ?? process.cwd();
  const brainPath = options.brainPath;
  const title = options.title?.trim() || basename(cwd) || 'Project';
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const warnings: string[] = [];

  const scaffold = await scaffoldProjectWorkspace({
    brainPath,
    title,
    repoPath: cwd,
    today,
  });
  if (!scaffold.ok && scaffold.skipped.length) {
    warnings.push(...scaffold.warnings);
  } else if (scaffold.warnings.length) {
    warnings.push(...scaffold.warnings);
  }

  const memoryFile = join(cwd, BRAND.memoryFileName);
  let memoryCreated = false;
  if (!(await exists(memoryFile))) {
    const body = [
      `# ${BRAND.productName} project memory`,
      '',
      `> Linked to second-brain vault: \`${brainPath}\``,
      scaffold.ok || scaffold.slug ? `> Project workspace: \`Projects/${scaffold.slug}/\`` : '',
      '',
      '## Conventions',
      '',
      '- Decisions, gotchas, and preferences discovered in this repo belong here or in the vault.',
      `- Session summaries are auto-written to \`Sessions/\` in the vault on exit (Ctrl+C / /quit).`,
      '',
    ]
      .filter(Boolean)
      .join('\n');
    await writeFile(memoryFile, `${body}\n`, 'utf8');
    memoryCreated = true;
  } else {
    try {
      const current = await readFile(memoryFile, 'utf8');
      if (!current.includes(brainPath)) {
        await writeFile(
          memoryFile,
          `${current.trimEnd()}\n\n<!-- ${BRAND.productName} -->\nsecond-brain: ${brainPath}\nproject: Projects/${scaffold.slug}/\n`,
          'utf8',
        );
      }
    } catch {
      warnings.push(`Could not update existing ${BRAND.memoryFileName}`);
    }
  }

  return {
    ok: scaffold.ok || scaffold.skipped.length > 0,
    brainPath,
    projectSlug: scaffold.slug,
    projectRelDir: scaffold.relDir,
    memoryFile,
    memoryCreated,
    warnings,
  };
}
