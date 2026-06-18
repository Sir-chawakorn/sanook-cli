import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { resolveGitBranch } from './useGitBranch.js';

const execFileP = promisify(execFile);

describe('resolveGitBranch', () => {
  it('returns null outside a git repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sanook-no-git-'));
    try {
      await expect(resolveGitBranch(dir)).resolves.toBeNull();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it('returns the current branch in a git repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sanook-git-'));
    try {
      await execFileP('git', ['-C', dir, 'init']);
      await writeFile(join(dir, 'README.md'), '# test\n');
      await execFileP('git', ['-C', dir, 'add', 'README.md']);
      await execFileP('git', ['-C', dir, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init']);
      await execFileP('git', ['-C', dir, 'checkout', '-b', 'feature/status-rule']);

      await expect(resolveGitBranch(dir)).resolves.toBe('feature/status-rule');
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
