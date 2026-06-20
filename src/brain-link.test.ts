import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { linkBrainToProject } from './brain-link.js';
import { BRAND } from './brand.js';

describe('linkBrainToProject', () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('scaffolds Projects/<slug>/ and creates SANOOK.md in cwd', async () => {
    root = mkdtempSync(join(tmpdir(), 'sanook-brain-link-'));
    const brain = join(root, 'vault');
    const repo = join(root, 'repo');
    mkdirSync(brain, { recursive: true });
    mkdirSync(join(brain, 'Projects'), { recursive: true });
    mkdirSync(join(brain, 'Sessions'), { recursive: true });
    writeFileSync(join(brain, 'Projects', '_Index.md'), 'up:: [[Home]]\n', 'utf8');
    mkdirSync(repo, { recursive: true });

    const report = await linkBrainToProject({ brainPath: brain, cwd: repo, title: 'Demo Repo', today: '2026-06-21' });

    expect(report.ok).toBe(true);
    expect(report.projectRelDir).toBe('Projects/demo-repo');
    expect(report.memoryCreated).toBe(true);
    expect(report.memoryFile).toBe(join(repo, BRAND.memoryFileName));
  });
});
