import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function importTrustWithHome(home: string): Promise<typeof import('./trust.js')> {
  vi.resetModules();
  vi.stubEnv('HOME', home);
  return import('./trust.js');
}

describe('project trust store', () => {
  let home: string;
  let project: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-trust-home-'));
    project = await mkdtemp(join(tmpdir(), 'sanook-trust-project-'));
    await mkdir(join(home, '.sanook'), { recursive: true });
    await writeFile(join(project, 'package.json'), '{}');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  });

  it('ignores malformed trusted-project roots instead of throwing', async () => {
    await writeFile(
      join(home, '.sanook', 'trusted-projects.json'),
      JSON.stringify({ trustedProjectRoots: [project, null, 42, { root: project }] }),
    );

    const { projectTrustStatus } = await importTrustWithHome(home);
    await expect(projectTrustStatus(project)).resolves.toMatchObject({ trusted: true, reason: 'store' });
  });

  it('treats non-array trusted-project roots as an empty store', async () => {
    await writeFile(join(home, '.sanook', 'trusted-projects.json'), JSON.stringify({ trustedProjectRoots: project }));

    const { projectTrustStatus } = await importTrustWithHome(home);
    await expect(projectTrustStatus(project)).resolves.toMatchObject({ trusted: false, reason: 'missing' });
  });

  it('treats a top-level array store as empty', async () => {
    await writeFile(join(home, '.sanook', 'trusted-projects.json'), JSON.stringify([project]));

    const { projectTrustStatus } = await importTrustWithHome(home);
    await expect(projectTrustStatus(project)).resolves.toMatchObject({ trusted: false, reason: 'missing' });
  });

  it('ignores blank trusted-project roots instead of resolving them against cwd', async () => {
    await writeFile(
      join(home, '.sanook', 'trusted-projects.json'),
      JSON.stringify({ trustedProjectRoots: ['', '   ', '\t'] }),
    );

    const originalCwd = process.cwd();
    process.chdir(project);
    try {
      const { projectTrustStatus } = await importTrustWithHome(home);
      await expect(projectTrustStatus(project)).resolves.toMatchObject({ trusted: false, reason: 'missing' });
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('ignores trusted-project roots with NUL bytes instead of throwing', async () => {
    await writeFile(
      join(home, '.sanook', 'trusted-projects.json'),
      JSON.stringify({ trustedProjectRoots: [`${project}\0`] }),
    );

    const { projectTrustStatus } = await importTrustWithHome(home);
    await expect(projectTrustStatus(project)).resolves.toMatchObject({ trusted: false, reason: 'missing' });
  });

  it('rewrites malformed trusted-project roots out when trusting a project', async () => {
    const trustFile = join(home, '.sanook', 'trusted-projects.json');
    await writeFile(
      trustFile,
      JSON.stringify({ trustedProjectRoots: [project, `${project}\0`, '', null, 42] }),
    );

    const { trustProject } = await importTrustWithHome(home);
    const root = await trustProject(project);

    await expect(readFile(trustFile, 'utf8').then((raw) => JSON.parse(raw))).resolves.toMatchObject({
      trustedProjectRoots: [root],
    });
  });

  it('rewrites malformed trusted-project roots out when untrusting a project', async () => {
    const otherProject = join(home, 'other-project');
    await mkdir(otherProject);
    await writeFile(join(otherProject, 'package.json'), '{}');

    const trustFile = join(home, '.sanook', 'trusted-projects.json');
    await writeFile(
      trustFile,
      JSON.stringify({ trustedProjectRoots: [project, otherProject, `${project}\0`, '', null, 42] }),
    );

    const { untrustProject } = await importTrustWithHome(home);
    await untrustProject(project);

    await expect(readFile(trustFile, 'utf8').then((raw) => JSON.parse(raw))).resolves.toMatchObject({
      trustedProjectRoots: [await realpath(otherProject)],
    });
  });
});
