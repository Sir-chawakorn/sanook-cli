// ============================================================================
// src/worktree.ts — throwaway git worktrees for ISOLATED parallel write agents.
//
// When several sub-agents edit files at once, they would clobber each other in
// one working tree. This gives each one its own `git worktree` (detached at the
// current HEAD), so their writes are physically isolated; afterwards each
// worktree's diff is captured and applied back to the main tree sequentially.
//
// Reuses runGit()/isGitRepo() from src/git.ts (execFile, no shell). Everything is
// best-effort + defensive: not a git repo → returns null (caller falls back to a
// shared tree); a failed apply is reported, never thrown past the orchestrator.
// ============================================================================
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runGit, isGitRepo } from './git.js';

export interface Worktree {
  path: string; // absolute path to the isolated working tree (use as a sub-agent cwd)
  baseRef: string; // the HEAD sha it was branched from (pinned, not the lazy "HEAD")
  repoRoot: string; // the main repo root the worktree belongs to
  tmpParent: string; // the mkdtemp dir to remove on cleanup
}

/** repo root of `cwd` (the top-level working dir), or null if not a git repo. */
export async function getRepoRoot(cwd: string = process.cwd()): Promise<string | null> {
  if (!(await isGitRepo(cwd))) return null;
  try {
    return (await runGit(['rev-parse', '--show-toplevel'], cwd)).trim();
  } catch {
    return null;
  }
}

/**
 * Create a detached worktree at the current HEAD of the repo containing `cwd`.
 * Returns null if `cwd` is not in a git repo (caller should then run un-isolated).
 */
export async function createWorktree(cwd: string = process.cwd()): Promise<Worktree | null> {
  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) return null;
  try {
    const baseRef = (await runGit(['rev-parse', 'HEAD'], repoRoot)).trim();
    const tmpParent = await mkdtemp(join(tmpdir(), 'sanook-wt-'));
    const path = join(tmpParent, `t-${randomUUID().slice(0, 8)}`); // must not pre-exist; git creates it
    await runGit(['worktree', 'add', '--detach', path, baseRef], repoRoot);
    const real = await realpath(path).catch(() => path);
    return { path: real, baseRef, repoRoot, tmpParent };
  } catch {
    return null;
  }
}

/**
 * Capture everything the sub-agent changed in its worktree as a unified diff
 * (vs the base HEAD), including new/untracked files. Empty string = no changes.
 */
export async function captureDiff(wt: Worktree): Promise<string> {
  try {
    await runGit(['add', '-A'], wt.path); // stage incl. untracked so they appear in the diff
    return await runGit(['diff', '--cached', '--binary', wt.baseRef], wt.path);
  } catch {
    return '';
  }
}

export interface ApplyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Apply a captured diff back into the main repo (at its root). Uses --3way so a
 * clean patch lands and a conflicting one is reported rather than silently lost.
 * Empty diff is a no-op success.
 */
export async function applyDiff(diff: string, repoRoot: string): Promise<ApplyResult> {
  if (!diff.trim()) return { ok: true };
  const patchFile = join(tmpdir(), `sanook-patch-${randomUUID().slice(0, 8)}.diff`);
  try {
    await writeFile(patchFile, diff, 'utf8');
    // `git apply --3way` may leave conflict markers / unmerged index entries when it fails.
    // Check first, then apply only when Git proves the patch can land cleanly.
    await runGit(['apply', '--check', '--3way', '--whitespace=nowarn', patchFile], repoRoot);
    await runGit(['apply', '--3way', '--whitespace=nowarn', patchFile], repoRoot);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message.split('\n')[0] };
  } finally {
    await rm(patchFile, { force: true }).catch(() => {});
  }
}

/** Remove the worktree and its temp parent (best-effort; prunes git's bookkeeping). */
export async function removeWorktree(wt: Worktree): Promise<void> {
  await runGit(['worktree', 'remove', '--force', wt.path], wt.repoRoot).catch(() => {});
  await rm(wt.tmpParent, { recursive: true, force: true }).catch(() => {});
  await runGit(['worktree', 'prune'], wt.repoRoot).catch(() => {});
}

/** changed file paths in a captured diff (for a human-readable summary). */
export function diffFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const m of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) files.add(m[2]);
  return [...files];
}

export interface MergeNote {
  description: string;
  changed: string[]; // files this task changed
  applied: boolean; // merged into the main tree?
  reason?: string; // why not (conflict) / empty
}

export interface WorktreeRun<R> {
  result: R; // whatever the per-task work returned
  merge: MergeNote;
}

/**
 * Run `work(task, cwd, i)` for each task in ITS OWN throwaway worktree (concurrently,
 * via the injected `runConcurrently`), then capture+apply each worktree's diff back
 * into the main tree sequentially. The work callback is injected so this whole
 * lifecycle (create → isolate → merge → cleanup) unit-tests with no agent/network.
 * Returns null if `root` is not a git repo or worktrees can't be created.
 */
export async function runInWorktrees<T extends { description: string }, R>(
  tasks: T[],
  root: string,
  work: (task: T, cwd: string, index: number) => Promise<R>,
  runConcurrently: (thunks: (() => Promise<R>)[]) => Promise<R[]>,
): Promise<WorktreeRun<R>[] | null> {
  if (!(await getRepoRoot(root))) return null;
  const wts: Worktree[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const wt = await createWorktree(root);
    if (!wt) {
      for (const w of wts) await removeWorktree(w);
      return null;
    }
    wts.push(wt);
  }

  let results: R[];
  try {
    results = await runConcurrently(tasks.map((t, i) => () => work(t, wts[i].path, i)));
  } catch (e) {
    for (const w of wts) await removeWorktree(w);
    throw e;
  }

  const out: WorktreeRun<R>[] = [];
  for (let i = 0; i < wts.length; i++) {
    let merge: MergeNote;
    try {
      const diff = await captureDiff(wts[i]);
      if (!diff.trim()) {
        merge = { description: tasks[i].description, changed: [], applied: true };
      } else {
        const changed = diffFiles(diff);
        const res = await applyDiff(diff, root); // sequential → deterministic conflict handling
        merge = { description: tasks[i].description, changed, applied: res.ok, reason: res.reason };
      }
    } finally {
      await removeWorktree(wts[i]);
    }
    out.push({ result: results[i], merge });
  }
  return out;
}
