import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('installSkill local directory safety', () => {
  let home: string | undefined;
  let sources: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (home) await rm(home, { recursive: true, force: true });
    await Promise.all(sources.map((source) => rm(source, { recursive: true, force: true })));
    home = undefined;
    sources = [];
  });

  it('copies support files but skips top-level extras, dotfiles, and symlinks when supported', async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-home-'));
    const source = await mkdtemp(join(tmpdir(), 'sanook-skill-src-'));
    sources.push(source);
    vi.stubEnv('HOME', home);

    await mkdir(join(source, 'references'), { recursive: true });
    await writeFile(
      join(source, 'SKILL.md'),
      '---\nname: local-safe\ndescription: local install\n---\n\n## Steps\n1. Use the reference.',
    );
    await writeFile(join(source, 'references', 'guide.md'), 'safe reference');
    await writeFile(join(source, '.env'), 'SECRET=do-not-copy');
    await writeFile(join(source, 'secret.txt'), 'secret outside the installed tree');
    if (process.platform !== 'win32') {
      await symlink(join(source, 'secret.txt'), join(source, 'references', 'secret-link.txt'));
    }

    const { installSkill } = await import('./skill-install.js');
    const [result] = await installSkill(source);

    expect(result).toMatchObject({ name: 'local-safe' });
    expect(await readFile(join(home, '.sanook', 'skills', 'local-safe', 'references', 'guide.md'), 'utf8')).toBe(
      'safe reference',
    );
    await expect(stat(join(home, '.sanook', 'skills', 'local-safe', 'secret.txt'))).rejects.toThrow();
    await expect(stat(join(home, '.sanook', 'skills', 'local-safe', '.env'))).rejects.toThrow();
    if (process.platform !== 'win32') {
      await expect(stat(join(home, '.sanook', 'skills', 'local-safe', 'references', 'secret-link.txt'))).rejects.toThrow();
    }
  });

  it('keeps the previous install when a replacement copy exceeds the file budget', async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-home-'));
    const original = await mkdtemp(join(tmpdir(), 'sanook-skill-original-'));
    const replacement = await mkdtemp(join(tmpdir(), 'sanook-skill-replacement-'));
    sources.push(original, replacement);
    vi.stubEnv('HOME', home);

    await writeFile(
      join(original, 'SKILL.md'),
      '---\nname: durable-install\ndescription: original install\n---\n\nOriginal instructions.',
    );

    const { installSkill } = await import('./skill-install.js');
    await installSkill(original);

    await mkdir(join(replacement, 'references'), { recursive: true });
    await writeFile(
      join(replacement, 'SKILL.md'),
      '---\nname: durable-install\ndescription: replacement install\n---\n\nReplacement instructions.',
    );
    for (let i = 0; i < 310; i++) {
      await writeFile(join(replacement, 'references', `${i}.md`), 'x');
    }

    await expect(installSkill(replacement)).rejects.toThrow(/ไฟล์เยอะเกินไป/);
    await expect(stat(join(home, '.sanook', 'skills', 'durable-install', 'references'))).rejects.toThrow();
    expect(await readFile(join(home, '.sanook', 'skills', 'durable-install', 'SKILL.md'), 'utf8')).toContain(
      'Original instructions.',
    );
  });

  it('does not discover hidden skill directories during parent-directory installs', async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-home-'));
    const source = await mkdtemp(join(tmpdir(), 'sanook-skill-parent-'));
    sources.push(source);
    vi.stubEnv('HOME', home);

    await mkdir(join(source, '.hidden-skill'), { recursive: true });
    await mkdir(join(source, 'visible-skill'), { recursive: true });
    await writeFile(
      join(source, '.hidden-skill', 'SKILL.md'),
      '---\nname: hidden-skill\ndescription: should not install\n---\n\nHidden instructions.',
    );
    await writeFile(
      join(source, 'visible-skill', 'SKILL.md'),
      '---\nname: visible-skill\ndescription: should install\n---\n\nVisible instructions.',
    );

    const { installSkill } = await import('./skill-install.js');
    const installed = await installSkill(source);

    expect(installed.map((skill) => skill.name)).toEqual(['visible-skill']);
    await expect(stat(join(home, '.sanook', 'skills', 'hidden-skill'))).rejects.toThrow();
    expect(await readFile(join(home, '.sanook', 'skills', 'visible-skill', 'SKILL.md'), 'utf8')).toContain(
      'Visible instructions.',
    );
  });

  it('installNamedSkill copies a bundled catalog skill by name', async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-home-'));
    sources.push(home);
    vi.stubEnv('HOME', home);

    const { installNamedSkill } = await import('./skill-install.js');
    const [result] = await installNamedSkill('git-commit-pr');

    expect(result).toMatchObject({ name: 'git-commit-pr' });
    expect(await readFile(join(home, '.sanook', 'skills', 'git-commit-pr', 'SKILL.md'), 'utf8')).toContain(
      'Conventional Commits',
    );
  });

  it('installNamedSkill rejects unknown bundled names with a helpful error', async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-home-'));
    sources.push(home);
    vi.stubEnv('HOME', home);

    const { installNamedSkill } = await import('./skill-install.js');
    await expect(installNamedSkill('definitely-not-a-real-skill')).rejects.toThrow(/bundled skill/);
  });
});
