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

  it('rejects slug overrides that escape the Projects directory', async () => {
    await mkdir(join(brainPath, 'Shared'), { recursive: true });
    await writeFile(join(brainPath, 'Shared', 'repo.md'), `repo_path: ${repoA}\n`, 'utf8');

    await expect(resolveVaultProject({ brainPath, slug: '../Shared' })).resolves.toBeNull();
    await expect(resolveVaultProject({ brainPath, slug: 'beta/repo' })).resolves.toBeNull();
    await expect(resolveVaultProject({ brainPath, slug: '.hidden' })).resolves.toBeNull();
  });

  it('normalizes quoted project metadata values', async () => {
    const repoWithSpaces = join(root, 'repo with spaces');
    await mkdir(repoWithSpaces, { recursive: true });
    await writeFile(
      join(brainPath, 'Projects', 'beta', 'repo.md'),
      [
        '---',
        `repo_path: "${repoWithSpaces}" # hand-edited YAML frontmatter`,
        String.raw`verify: "node scripts\verify.mjs && npm test"`,
        "default_branch: 'release/candidate'",
        '---',
        '',
        '# Beta',
        '',
      ].join('\n'),
      'utf8',
    );

    const beta = (await listVaultProjects(brainPath)).find((project) => project.slug === 'beta');
    expect(beta).toMatchObject({
      repoPath: repoWithSpaces,
      verify: String.raw`node scripts\verify.mjs && npm test`,
      defaultBranch: 'release/candidate',
    });
    await expect(resolveVaultProject({ brainPath, cwd: repoWithSpaces })).resolves.toMatchObject({ slug: 'beta' });
  });

  it('ignores YAML-style inline comments for unquoted metadata values', async () => {
    const repoWithSpaces = join(root, 'repo with inline comment');
    await mkdir(repoWithSpaces, { recursive: true });
    await writeFile(
      join(brainPath, 'Projects', 'beta', 'repo.md'),
      [
        `repo_path: ${repoWithSpaces} # local checkout with spaces`,
        'verify: npm test # smoke command',
        'default_branch: main # release branch',
        '',
      ].join('\n'),
      'utf8',
    );

    const beta = (await listVaultProjects(brainPath)).find((project) => project.slug === 'beta');
    expect(beta).toMatchObject({
      repoPath: repoWithSpaces,
      verify: 'npm test',
      defaultBranch: 'main',
    });
    await expect(resolveVaultProject({ brainPath, cwd: repoWithSpaces })).resolves.toMatchObject({ slug: 'beta' });
  });

  it('preserves hash characters that are part of unquoted metadata values', async () => {
    const repoWithHash = join(root, 'repo#hash');
    await mkdir(repoWithHash, { recursive: true });
    await writeFile(
      join(brainPath, 'Projects', 'beta', 'repo.md'),
      [
        `repo_path: ${repoWithHash} # local checkout`,
        'verify: npm run test#unit # smoke command',
        'default_branch: feature/#42 # release branch',
        '',
      ].join('\n'),
      'utf8',
    );

    const beta = (await listVaultProjects(brainPath)).find((project) => project.slug === 'beta');
    expect(beta).toMatchObject({
      repoPath: repoWithHash,
      verify: 'npm run test#unit',
      defaultBranch: 'feature/#42',
    });
    await expect(resolveVaultProject({ brainPath, cwd: repoWithHash })).resolves.toMatchObject({ slug: 'beta' });
  });

  it('accepts YAML-style spacing before metadata colons', async () => {
    const repoWithSpacedKeys = join(root, 'repo with spaced keys');
    await mkdir(repoWithSpacedKeys, { recursive: true });
    await writeFile(
      join(brainPath, 'Projects', 'beta', 'repo.md'),
      [
        `repo_path : ${repoWithSpacedKeys}`,
        'verify : npm run typecheck',
        'default_branch : main',
        '',
      ].join('\n'),
      'utf8',
    );

    const beta = (await listVaultProjects(brainPath)).find((project) => project.slug === 'beta');
    expect(beta).toMatchObject({
      repoPath: repoWithSpacedKeys,
      verify: 'npm run typecheck',
      defaultBranch: 'main',
    });
    await expect(resolveVaultProject({ brainPath, cwd: repoWithSpacedKeys })).resolves.toMatchObject({ slug: 'beta' });
  });

  it('falls back to overview metadata when repo note has no metadata', async () => {
    const repoFromOverview = join(root, 'repo-from-overview');
    await mkdir(repoFromOverview, { recursive: true });
    await writeFile(join(brainPath, 'Projects', 'beta', 'repo.md'), '# Beta repo\n\nHandwritten notes only.\n', 'utf8');
    await writeFile(
      join(brainPath, 'Projects', 'beta', 'overview.md'),
      [
        '# Beta',
        '',
        `repo_path: ${repoFromOverview}`,
        'verify: npm run typecheck',
        'default_branch: main',
        '',
      ].join('\n'),
      'utf8',
    );

    const beta = (await listVaultProjects(brainPath)).find((project) => project.slug === 'beta');
    expect(beta).toMatchObject({
      repoPath: repoFromOverview,
      verify: 'npm run typecheck',
      defaultBranch: 'main',
    });
    await expect(resolveVaultProject({ brainPath, cwd: repoFromOverview })).resolves.toMatchObject({ slug: 'beta' });
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
