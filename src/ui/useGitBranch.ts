import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { useEffect, useState } from 'react';

const execFileP = promisify(execFile);
const BRANCH_CACHE_MS = 15_000;
const BRANCH_TIMEOUT_MS = 700;

const cache = new Map<string, { at: number; branch: string | null }>();
const inflight = new Map<string, Promise<string | null>>();

export async function resolveGitBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      timeout: BRANCH_TIMEOUT_MS,
    });
    const branch = stdout.trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

function loadCachedGitBranch(cwd: string): Promise<string | null> {
  const active = inflight.get(cwd);
  if (active) return active;

  const load = resolveGitBranch(cwd).finally(() => inflight.delete(cwd));
  inflight.set(cwd, load);
  return load;
}

export function useGitBranch(cwd: string): string | null {
  const [branch, setBranch] = useState<string | null>(() => cache.get(cwd)?.branch ?? null);

  useEffect(() => {
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      const cached = cache.get(cwd);
      if (cached && Date.now() - cached.at < BRANCH_CACHE_MS) {
        if (!cancelled) setBranch(cached.branch);
        return;
      }

      const branch = await loadCachedGitBranch(cwd);
      cache.set(cwd, { at: Date.now(), branch });
      if (!cancelled) setBranch(branch);
    };

    void refresh();
    const interval = setInterval(() => void refresh(), BRANCH_CACHE_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [cwd]);

  return branch;
}

export function clearGitBranchCacheForTests(): void {
  cache.clear();
  inflight.clear();
}
