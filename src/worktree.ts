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
import { mkdtemp, rm, writeFile, readFile, realpath } from 'node:fs/promises';
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
  // snapshot ต้องคลุม "ทุก path ที่ patch แตะ" รวม source ของ rename/copy (git apply ลบ source ตอน rename)
  // ไม่งั้น apply ล้มกลางทาง → rollback ไม่คืน source = ไฟล์หาย. ใช้ touched-paths (ทั้ง 2 ฝั่ง) ไม่ใช่แค่ dest
  const files = diffTouchedPaths(diff);
  if (files.length) {
    try {
      await runGit(['diff', '--cached', '--quiet', '--', ...files], repoRoot);
    } catch {
      return { ok: false, reason: 'touched files have staged changes; refusing to disturb the index' };
    }
  }
  // Snapshot every touched file's exact pre-apply content (or absence). `git apply --3way`
  // can leave conflict markers + unmerged index entries on failure, and across git versions
  // `--check` doesn't always foresee a 3-way conflict — so on ANY failure we roll the working
  // tree back to precisely this snapshot, preserving uncommitted changes that were already there.
  const before = new Map<string, Buffer | null>();
  await Promise.all(
    files.map(async (f) => {
      before.set(f, await readFile(join(repoRoot, f)).catch(() => null));
    }),
  );

  const patchFile = join(tmpdir(), `sanook-patch-${randomUUID().slice(0, 8)}.diff`);
  try {
    await writeFile(patchFile, diff, 'utf8');
    await runGit(['apply', '--check', '--3way', '--whitespace=nowarn', patchFile], repoRoot); // fast reject
    await runGit(['apply', '--3way', '--whitespace=nowarn', patchFile], repoRoot);
    return { ok: true };
  } catch (e) {
    // restore exact pre-apply content + clear any index/unmerged entries --3way may have created
    await Promise.all(
      [...before].map(async ([f, content]) => {
        const abs = join(repoRoot, f);
        if (content == null) await rm(abs, { force: true }).catch(() => {});
        else await writeFile(abs, content).catch(() => {});
      }),
    );
    if (files.length) await runGit(['reset', '-q', '--', ...files], repoRoot).catch(() => {});
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

function decodeGitQuotedPath(p: string): string {
  const bytes: number[] = [];
  for (let i = 1; i < p.length - 1; ) {
    const ch = p[i];
    if (ch !== '\\') {
      const codePoint = p.codePointAt(i);
      if (codePoint == null) break;
      const raw = String.fromCodePoint(codePoint);
      bytes.push(...Buffer.from(raw));
      i += raw.length;
      continue;
    }

    const escaped = p[++i];
    if (escaped == null) break;
    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && i + 1 < p.length - 1 && /[0-7]/.test(p[i + 1])) octal += p[++i];
      bytes.push(Number.parseInt(octal, 8));
      i++;
      continue;
    }

    const controls: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };
    const control = controls[escaped];
    if (control != null) bytes.push(control);
    else bytes.push(...Buffer.from(escaped));
    i++;
  }
  return Buffer.from(bytes).toString('utf8');
}

/** git quote paths ที่มีอักขระพิเศษ/ช่องว่างเป็น "..." แบบ C-escape → คืน path จริง (best-effort) */
function unquotePath(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) {
    try {
      return decodeGitQuotedPath(p);
    } catch {
      return p.slice(1, -1);
    }
  }
  return p;
}

function unquoteDiffSidePath(p: string): string {
  return unquotePath(p).replace(/^[ab]\//, '');
}

function diffMarkerPath(p: string): string | null {
  const token = p.startsWith('"') ? (readQuotedPathToken(p)?.token ?? p) : p.split('\t', 1)[0];
  if (token === '/dev/null') return null;
  return unquoteDiffSidePath(token);
}

function readQuotedPathToken(input: string, start = 0): { token: string; next: number } | null {
  if (input[start] !== '"') return null;
  let escaped = false;
  for (let i = start + 1; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === '"') {
      return { token: input.slice(start, i + 1), next: i + 1 };
    }
  }
  return null;
}

function sameUnquotedDiffPathSplit(input: string): number | null {
  for (let i = input.indexOf(' b/'); i !== -1; i = input.indexOf(' b/', i + 1)) {
    const from = input.slice(0, i);
    const to = input.slice(i + 1);
    if (unquoteDiffSidePath(from) === unquoteDiffSidePath(to)) return i;
  }
  return null;
}

function readDiffPathToken(input: string, start = 0): { token: string; next: number } | null {
  if (input[start] === '"') return readQuotedPathToken(input, start);
  const next = input.indexOf(' ', start);
  const end = next === -1 ? input.length : next;
  if (end === start) return null;
  return { token: input.slice(start, end), next: end };
}

function diffGitPaths(line: string): { from: string; to: string } | null {
  if (!line.startsWith('diff --git ')) return null;
  const rest = line.slice('diff --git '.length);
  if (!rest.startsWith('"')) {
    const split = sameUnquotedDiffPathSplit(rest);
    if (split != null) {
      return { from: unquoteDiffSidePath(rest.slice(0, split)), to: unquoteDiffSidePath(rest.slice(split + 1)) };
    }
  }
  const from = readDiffPathToken(rest);
  if (!from || rest[from.next] !== ' ') return null;
  const to = readDiffPathToken(rest, from.next + 1);
  if (!to || to.next !== rest.length) return null;
  return { from: unquoteDiffSidePath(from.token), to: unquoteDiffSidePath(to.token) };
}

/** changed file paths in a captured diff (dest side — for a human-readable summary). */
export function diffFiles(diff: string): string[] {
  const files = new Set<string>();
  let current: { headerTo?: string; markerFrom?: string; markerTo?: string; renamedTo?: string } | null = null;
  const flush = () => {
    if (!current) return;
    const path = current.renamedTo ?? current.markerTo ?? current.headerTo ?? current.markerFrom;
    if (path) files.add(path);
  };

  for (const line of diff.split('\n')) {
    const paths = diffGitPaths(line);
    if (paths || line.startsWith('diff --git ')) {
      flush();
      current = { headerTo: paths?.to };
      continue;
    }
    if (!current) continue;

    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(?:rename|copy) to (.+)$/))) {
      current.renamedTo = unquotePath(m[1]);
    } else if ((m = line.match(/^--- (.+)$/))) {
      current.markerFrom = diffMarkerPath(m[1]) ?? current.markerFrom;
    } else if ((m = line.match(/^\+\+\+ (.+)$/))) {
      current.markerTo = diffMarkerPath(m[1]) ?? current.markerTo;
    }
  }
  flush();
  return [...files];
}

/**
 * ทุก path ที่ patch อ่าน "หรือ" เขียน — รวม 2 ฝั่งของ rename/copy — สำหรับ snapshot + rollback ให้ปลอดภัย
 * (จงใจ liberal: snapshot เกินไม่เป็นไร [restore ทับด้วยเนื้อเดิม = no-op] แต่ขาด source ของ rename = ไฟล์หาย)
 * อ่านจากบรรทัด `--- a/` `+++ b/` `rename from/to` `copy from/to` ซึ่งมี path เดียวต่อบรรทัด (parse แม่นกว่า `diff --git`)
 */
export function diffTouchedPaths(diff: string): string[] {
  const set = new Set<string>();
  for (const line of diff.split('\n')) {
    let m: RegExpMatchArray | null;
    const paths = diffGitPaths(line);
    if (paths) {
      set.add(paths.from);
      set.add(paths.to);
    } else if (
      (m = line.match(/^rename from (.+)$/)) ||
      (m = line.match(/^rename to (.+)$/)) ||
      (m = line.match(/^copy from (.+)$/)) ||
      (m = line.match(/^copy to (.+)$/))
    ) {
      set.add(unquotePath(m[1]));
    } else if ((m = line.match(/^--- (.+)$/))) {
      const path = diffMarkerPath(m[1]);
      if (path) set.add(path);
    } else if ((m = line.match(/^\+\+\+ (.+)$/))) {
      const path = diffMarkerPath(m[1]);
      if (path) set.add(path);
    }
  }
  return [...set];
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
