import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildProjectContextBlock,
  listVaultProjects,
  resolveVaultProject,
} from './project-registry.js';

describe('project-registry', () => {
  let root: string;
  let brainPath: string;
  let repoA: string;
  let repoB: string;

  beforeEach(async () => {
    root = join(tmpdir(), `sanook-project-reg-${Math.random().toString(36).slice(2)}`);
    await mkdir(root, { recursive: true });
    brainPath = join(root, 'vault');
    repoA = join(root, 'repo-a');
    repoB = join(root, 'repo-b');
    await mkdir(brainPath, { recursive: true });
    await mkdir(repoA, { recursive: true });
    await mkdir(repoB, { recursive: true });
    await mkdir(join(repoA, 'src'), { recursive: true });
    await mkdir(join(brainPath, 'Projects', 'alpha'), { recursive: true });
    await mkdir(join(brainPath, 'Projects', 'beta'), { recursive: true });
    await writeFile(
      join(brainPath, 'Projects', 'alpha', 'repo.md'),
      `# Alpha\n\nrepo_path: ${repoA}\n`,
      'utf8',
    );
    await writeFile(
      join(brainPath, 'Projects', 'alpha', 'current-state.md'),
      '# Current\n\nNow: alpha work\n\nup:: [[Projects/alpha/_Index]]\n',
      'utf8',
    );
    await writeFile(join(brainPath, 'Projects', 'beta', 'repo.md'), `repo_path: ${repoB}\n`, 'utf8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists vault projects with repo paths', async () => {
    const projects = await listVaultProjects(brainPath);
    expect(projects.map((p) => p.slug).sort()).toEqual(['alpha', 'beta']);
    expect(projects.find((p) => p.slug === 'alpha')?.repoPath).toBe(repoA);
  });

  it('resolves project from cwd inside repo_path', async () => {
    const nested = join(repoA, 'src');
    const project = await resolveVaultProject({ brainPath, cwd: nested });
    expect(project?.slug).toBe('alpha');
  });

  it('resolves project by slug override', async () => {
    const project = await resolveVaultProject({ brainPath, slug: 'beta' });
    expect(project?.slug).toBe('beta');
    expect(project?.repoPath).toBe(repoB);
  });

  it('builds project context block from hot files', async () => {
    const project = await resolveVaultProject({ brainPath, slug: 'alpha' });
    expect(project).toBeTruthy();
    const block = await buildProjectContextBlock(brainPath, project!);
    expect(block).toContain('<project_workspace');
    expect(block).toContain('alpha work');
    expect(block).toContain('project-current-state');
  });
});
