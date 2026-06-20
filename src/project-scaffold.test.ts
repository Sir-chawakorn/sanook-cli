import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAIN_DEFAULTS, scaffoldBrain } from './brain.js';
import { scaffoldProjectWorkspace, slugifyProject } from './project-scaffold.js';

describe('project-scaffold', () => {
  let dir: string;
  let vault: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `sanook-project-scaffold-${Math.random().toString(36).slice(2)}`);
    vault = join(dir, 'vault');
    await scaffoldBrain(vault, { ...BRAIN_DEFAULTS, today: '2026-06-20' });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('slugifies project titles', () => {
    expect(slugifyProject('My Cool App')).toBe('my-cool-app');
  });

  it('scaffolds a full Projects/<slug>/ workspace', async () => {
    const repo = join(dir, 'my-app');
    const report = await scaffoldProjectWorkspace({
      brainPath: vault,
      title: 'My App',
      repoPath: repo,
      verify: 'npm test',
      today: '2026-06-20',
    });
    expect(report.ok).toBe(true);
    expect(report.slug).toBe('my-app');
    expect(report.created.length).toBeGreaterThanOrEqual(5);
    const repoMd = await readFile(join(vault, 'Projects/my-app/repo.md'), 'utf8');
    expect(repoMd).toContain(`repo_path: ${repo}`);
    expect(repoMd).toContain('npm test');
    const index = await readFile(join(vault, 'Projects/_Index.md'), 'utf8');
    expect(index).toContain('[[Projects/my-app/_Index]]');
    await expect(stat(join(vault, 'Projects/my-app/overview.md'))).resolves.toBeDefined();
  });
});
