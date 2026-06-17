import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from './git.js';
import {
  createWorktree,
  captureDiff,
  applyDiff,
  removeWorktree,
  getRepoRoot,
  diffFiles,
  diffTouchedPaths,
  runInWorktrees,
} from './worktree.js';

describe('diffTouchedPaths (snapshot safety — both sides of a rename)', () => {
  it('rename → captures BOTH source and dest (so rollback can restore the deleted source)', () => {
    const diff = 'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n';
    expect(diffTouchedPaths(diff).sort()).toEqual(['new.txt', 'old.txt']);
    expect(diffFiles(diff)).toEqual(['new.txt']); // summary keeps showing the dest only
  });
  it('copy → captures BOTH source and dest while summarizing the copied file', () => {
    const diff = 'diff --git a/source.txt b/copied.txt\nsimilarity index 100%\ncopy from source.txt\ncopy to copied.txt\n';
    expect(diffTouchedPaths(diff).sort()).toEqual(['copied.txt', 'source.txt']);
    expect(diffFiles(diff)).toEqual(['copied.txt']);
  });
  it('quoted copy metadata decodes both touched paths and summarizes the destination', () => {
    const diff =
      'diff --git "a/caf\\303\\251.txt" "b/copy\\040caf\\303\\251.txt"\n' +
      'similarity index 100%\n' +
      'copy from "caf\\303\\251.txt"\n' +
      'copy to "copy\\040caf\\303\\251.txt"\n';

    expect(diffTouchedPaths(diff).sort()).toEqual(['caf\u00e9.txt', 'copy caf\u00e9.txt']);
    expect(diffFiles(diff)).toEqual(['copy caf\u00e9.txt']);
  });
  it('modify → the single path; add/delete ignore /dev/null', () => {
    expect(diffTouchedPaths('diff --git a/x.txt b/x.txt\n--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-a\n+b\n')).toEqual(['x.txt']);
    expect(diffTouchedPaths('diff --git a/n.txt b/n.txt\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1 @@\n+x\n')).toEqual(['n.txt']);
  });
  it('delete → reports the deleted file while ignoring /dev/null', () => {
    const diff =
      'diff --git a/gone.txt b/gone.txt\n' +
      'deleted file mode 100644\n' +
      'index 257cc56..0000000\n' +
      '--- a/gone.txt\n' +
      '+++ /dev/null\n' +
      '@@ -1 +0,0 @@\n' +
      '-old\n';

    expect(diffTouchedPaths(diff)).toEqual(['gone.txt']);
    expect(diffFiles(diff)).toEqual(['gone.txt']);
  });
  it('quoted git paths are unescaped and stripped of side prefixes', () => {
    const diff =
      'diff --git "a/weird\\tname.txt" "b/weird\\tname.txt"\n' +
      'index 3367afd..3e75765 100644\n' +
      '--- "a/weird\\tname.txt"\n' +
      '+++ "b/weird\\tname.txt"\n' +
      '@@ -1 +1 @@\n' +
      '-old\n' +
      '+new\n';

    expect(diffTouchedPaths(diff)).toEqual(['weird\tname.txt']);
    expect(diffFiles(diff)).toEqual(['weird\tname.txt']);
  });
  it('quoted git paths decode octal UTF-8 byte escapes', () => {
    const diff =
      'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n' +
      'index 3367afd..3e75765 100644\n' +
      '--- "a/caf\\303\\251.txt"\n' +
      '+++ "b/caf\\303\\251.txt"\n' +
      '@@ -1 +1 @@\n' +
      '-old\n' +
      '+new\n';

    expect(diffTouchedPaths(diff)).toEqual(['caf\u00e9.txt']);
    expect(diffFiles(diff)).toEqual(['caf\u00e9.txt']);
  });
  it('quoted git paths decode escaped backslashes and quotes', () => {
    const diff =
      'diff --git "a/dir\\\\quote\\"name.txt" "b/dir\\\\quote\\"name.txt"\n' +
      'index 3367afd..3e75765 100644\n' +
      '--- "a/dir\\\\quote\\"name.txt"\n' +
      '+++ "b/dir\\\\quote\\"name.txt"\n' +
      '@@ -1 +1 @@\n' +
      '-old\n' +
      '+new\n';

    expect(diffTouchedPaths(diff)).toEqual(['dir\\quote"name.txt']);
    expect(diffFiles(diff)).toEqual(['dir\\quote"name.txt']);
  });
  it('mixed quoted and unquoted diff headers report the destination path', () => {
    const diff =
      'diff --git a/plain.txt "b/weird\\tname.txt"\n' +
      'similarity index 100%\n' +
      'rename from plain.txt\n' +
      'rename to "weird\\tname.txt"\n';

    expect(diffTouchedPaths(diff).sort()).toEqual(['plain.txt', 'weird\tname.txt']);
    expect(diffFiles(diff)).toEqual(['weird\tname.txt']);
  });
  it('unquoted git paths with spaces ignore file marker tab separators', () => {
    const diff =
      'diff --git a/space name.txt b/space name.txt\n' +
      'index 489ce0f..3e5126c 100644\n' +
      '--- a/space name.txt\t\n' +
      '+++ b/space name.txt\t\n' +
      '@@ -1 +1 @@\n' +
      '-old\n' +
      '+new\n';

    expect(diffTouchedPaths(diff)).toEqual(['space name.txt']);
    expect(diffFiles(diff)).toEqual(['space name.txt']);
  });
  it('unquoted rename paths with spaces report both touched paths and the destination summary', () => {
    const diff =
      'diff --git a/old name.txt b/new name.txt\n' +
      'similarity index 100%\n' +
      'rename from old name.txt\n' +
      'rename to new name.txt\n';

    expect(diffTouchedPaths(diff).sort()).toEqual(['new name.txt', 'old name.txt']);
    expect(diffFiles(diff)).toEqual(['new name.txt']);
  });
  it('binary patches without file markers fall back to the diff header path', () => {
    const diff =
      'diff --git a/foo b/bar.bin b/foo b/bar.bin\n' +
      'new file mode 100644\n' +
      'index 0000000..e015db4\n' +
      'GIT binary patch\n' +
      'literal 1\n' +
      'Ic$@_K00001\n';

    expect(diffTouchedPaths(diff)).toEqual(['foo b/bar.bin']);
    expect(diffFiles(diff)).toEqual(['foo b/bar.bin']);
  });
});

const allSettled = <R>(thunks: (() => Promise<R>)[]): Promise<R[]> => Promise.all(thunks.map((t) => t()));

// real-git integration: build a throwaway repo, isolate a worktree, round-trip a change.
let repo: string;

async function initRepo(dir: string): Promise<void> {
  await runGit(['init', '-q'], dir);
  await runGit(['config', 'user.email', 'test@example.com'], dir);
  await runGit(['config', 'user.name', 'Test'], dir);
  await runGit(['config', 'commit.gpgsign', 'false'], dir);
  await writeFile(join(dir, 'base.txt'), 'hello\n');
  await runGit(['add', '-A'], dir);
  await runGit(['commit', '-q', '-m', 'init'], dir);
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'sanook-repo-'));
  await initRepo(repo);
});
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('getRepoRoot', () => {
  it('returns the repo root for a git dir, null otherwise', async () => {
    expect(await getRepoRoot(repo)).toBeTruthy();
    const notRepo = await mkdtemp(join(tmpdir(), 'plain-'));
    expect(await getRepoRoot(notRepo)).toBeNull();
    await rm(notRepo, { recursive: true, force: true });
  });
});

describe('worktree isolation round-trip', () => {
  it('creates an isolated worktree at HEAD, captures its diff, applies it back, cleans up', async () => {
    const wt = await createWorktree(repo);
    expect(wt).toBeTruthy();
    if (!wt) return;

    // the worktree starts as a faithful copy of HEAD
    expect(await readFile(join(wt.path, 'base.txt'), 'utf8')).toBe('hello\n');
    expect(wt.path).not.toBe(repo); // physically separate dir

    // a "sub-agent" edits an existing file AND adds a new one INSIDE the worktree
    await writeFile(join(wt.path, 'base.txt'), 'hello\nworld\n');
    await mkdir(join(wt.path, 'src'), { recursive: true });
    await writeFile(join(wt.path, 'src', 'new.txt'), 'fresh file\n');

    // main tree is untouched (isolation)
    expect(await readFile(join(repo, 'base.txt'), 'utf8')).toBe('hello\n');

    const diff = await captureDiff(wt);
    expect(diff).toContain('base.txt');
    expect(diff).toContain('src/new.txt');
    expect(diffFiles(diff).sort()).toEqual(['base.txt', 'src/new.txt']);

    // apply the captured diff back into the main tree
    const applied = await applyDiff(diff, repo);
    expect(applied.ok).toBe(true);
    expect(await readFile(join(repo, 'base.txt'), 'utf8')).toBe('hello\nworld\n');
    expect(await readFile(join(repo, 'src', 'new.txt'), 'utf8')).toBe('fresh file\n');

    await removeWorktree(wt);
  });

  it('two worktrees touching DIFFERENT files both merge back cleanly (the parallel case)', async () => {
    const a = await createWorktree(repo);
    const b = await createWorktree(repo);
    expect(a && b).toBeTruthy();
    if (!a || !b) return;

    await writeFile(join(a.path, 'a.txt'), 'from A\n');
    await writeFile(join(b.path, 'b.txt'), 'from B\n');

    const da = await captureDiff(a);
    const db = await captureDiff(b);
    // apply sequentially into the shared main tree (the orchestrator's order)
    expect((await applyDiff(da, repo)).ok).toBe(true);
    expect((await applyDiff(db, repo)).ok).toBe(true);

    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('from A\n');
    expect(await readFile(join(repo, 'b.txt'), 'utf8')).toBe('from B\n');

    await removeWorktree(a);
    await removeWorktree(b);
  });

  it('an empty diff applies as a no-op', async () => {
    const wt = await createWorktree(repo);
    if (!wt) return;
    expect(await captureDiff(wt)).toBe('');
    expect((await applyDiff('', repo)).ok).toBe(true);
    await removeWorktree(wt);
  });

  it('createWorktree on a non-git dir returns null (caller falls back to shared tree)', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'plain-'));
    expect(await createWorktree(plain)).toBeNull();
    await rm(plain, { recursive: true, force: true });
  });

  it('a conflicting patch is reported, not thrown', async () => {
    const wt = await createWorktree(repo);
    if (!wt) return;
    // worktree changes base.txt one way…
    await writeFile(join(wt.path, 'base.txt'), 'hello\nWT change\n');
    const diff = await captureDiff(wt);
    // …meanwhile the main tree changes the same line differently
    await writeFile(join(repo, 'base.txt'), 'hello\nMAIN change\n');
    const statusBefore = await runGit(['status', '--porcelain'], repo);
    const res = await applyDiff(diff, repo);
    expect(res.ok).toBe(false);
    expect(typeof res.reason).toBe('string');
    // Failed 3-way applies must not dirty the main tree with conflict markers.
    expect(await readFile(join(repo, 'base.txt'), 'utf8')).toBe('hello\nMAIN change\n');
    expect(await runGit(['status', '--porcelain'], repo)).toBe(statusBefore);
    await removeWorktree(wt);
  });

  it('refuses to apply over staged changes in touched files (preserves the index)', async () => {
    const wt = await createWorktree(repo);
    if (!wt) return;
    await writeFile(join(wt.path, 'base.txt'), 'hello\nWT change\n');
    const diff = await captureDiff(wt);

    await writeFile(join(repo, 'base.txt'), 'hello\nSTAGED change\n');
    await runGit(['add', 'base.txt'], repo);
    const statusBefore = await runGit(['status', '--porcelain'], repo);

    const res = await applyDiff(diff, repo);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('staged changes');
    expect(await runGit(['status', '--porcelain'], repo)).toBe(statusBefore);
    expect(await readFile(join(repo, 'base.txt'), 'utf8')).toBe('hello\nSTAGED change\n');
    await removeWorktree(wt);
  });
});

describe('runInWorktrees (the isolate orchestration core, fake work — no agent/network)', () => {
  it('runs each task in its own worktree and merges all back into the main tree', async () => {
    const tasks = [
      { description: 'write a', file: 'a.txt', body: 'A\n' },
      { description: 'write b', file: 'b.txt', body: 'B\n' },
    ];
    const runs = await runInWorktrees(
      tasks,
      repo,
      async (t, cwd) => {
        // each "subagent" only ever writes inside its OWN worktree cwd
        await writeFile(join(cwd, t.file), t.body);
        return `wrote ${t.file}`;
      },
      allSettled,
    );
    expect(runs).toBeTruthy();
    if (!runs) return;
    expect(runs.map((r) => r.result)).toEqual(['wrote a.txt', 'wrote b.txt']);
    expect(runs.every((r) => r.merge.applied)).toBe(true);
    expect(runs[0].merge.changed).toEqual(['a.txt']);
    // both files made it back to the shared main tree
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('A\n');
    expect(await readFile(join(repo, 'b.txt'), 'utf8')).toBe('B\n');
    // worktrees are cleaned up
    expect((await runGit(['worktree', 'list'], repo)).trim().split('\n').length).toBe(1);
  });

  it('a task that writes nothing yields an empty (applied) merge note', async () => {
    const runs = await runInWorktrees([{ description: 'noop' }], repo, async () => 'did nothing', allSettled);
    expect(runs?.[0].merge).toMatchObject({ applied: true, changed: [] });
  });

  it('returns null when root is not a git repo (caller falls back to shared tree)', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'plain-'));
    expect(await runInWorktrees([{ description: 'x' }], plain, async () => 'y', allSettled)).toBeNull();
    await rm(plain, { recursive: true, force: true });
  });

  it('cleans up worktrees when the injected concurrent runner rejects', async () => {
    await expect(
      runInWorktrees(
        [{ description: 'boom' }],
        repo,
        async () => 'unreached',
        async () => {
          throw new Error('runner failed');
        },
      ),
    ).rejects.toThrow('runner failed');

    expect((await runGit(['worktree', 'list'], repo)).trim().split('\n').length).toBe(1);
  });
});
