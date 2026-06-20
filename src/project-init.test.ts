import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('initProject', () => {
  let home: string;
  let project: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-init-home-'));
    project = await mkdtemp(join(tmpdir(), 'sanook-init-project-'));
    await mkdir(join(home, '.sanook'), { recursive: true });
    await writeFile(join(project, 'package.json'), '{}');
    vi.stubEnv('HOME', home);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  });

  it('scaffolds starter commands and suggests brain + mcp preset dev', async () => {
    const { initProject } = await import('./project-init.js');
    const result = await initProject({ cwd: project });

    expect(result.created).toEqual(['.sanook/commands/review.md', '.sanook/commands/plan.md']);
    expect(result.skipped).toEqual([]);
    expect(result.trusted).toBe(false);
    expect(result.hints.some((h) => h.includes('brain init'))).toBe(true);
    expect(result.hints.some((h) => h.includes('mcp preset dev'))).toBe(true);
    expect(result.hints.some((h) => h.includes('trust add'))).toBe(true);

    const review = await readFile(join(project, '.sanook', 'commands', 'review.md'), 'utf8');
    expect(review).toContain('description: Review recent changes before commit');
    expect(review).toContain('$ARGUMENTS');
  });

  it('skips existing command files and can trust the project', async () => {
    await mkdir(join(project, '.sanook', 'commands'), { recursive: true });
    await writeFile(join(project, '.sanook', 'commands', 'review.md'), 'keep me');

    const { initProject } = await import('./project-init.js');
    const result = await initProject({ cwd: project, trust: true });

    expect(result.created).toEqual(['.sanook/commands/plan.md']);
    expect(result.skipped).toEqual(['.sanook/commands/review.md']);
    expect(result.trusted).toBe(true);
    expect(result.hints.some((h) => h.includes('trust add'))).toBe(false);
    expect(await readFile(join(project, '.sanook', 'commands', 'review.md'), 'utf8')).toBe('keep me');
  });

  it('omits brain init hint when brainPath is configured', async () => {
    await writeFile(join(home, '.sanook', 'config.json'), JSON.stringify({ brainPath: project }, null, 2));

    const { initProject } = await import('./project-init.js');
    const result = await initProject({ cwd: project });

    expect(result.hints.some((h) => h.includes('brain init'))).toBe(false);
    expect(result.hints.some((h) => h.includes('mcp preset dev'))).toBe(true);
  });
});
