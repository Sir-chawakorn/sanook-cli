import { chmod, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { appHomePath, appProjectPath, BRAND_ENV, envFlag } from './brand.js';

const TRUST_FILE = appHomePath('trusted-projects.json');
const BOUNDARY_MARKERS = ['.git', 'package.json'];

interface TrustStore {
  trustedProjectRoots?: string[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function canonical(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return resolve(p);
  }
}

function isUsableStoredRoot(root: unknown): root is string {
  return typeof root === 'string' && root.trim().length > 0 && !root.includes('\0');
}

export async function projectRoot(cwd: string = process.cwd()): Promise<string> {
  let dir = resolve(cwd);
  for (;;) {
    const atBoundary = (await Promise.all(BOUNDARY_MARKERS.map((mk) => exists(join(dir, mk))))).some(Boolean);
    if (atBoundary) return canonical(dir);
    const parent = dirname(dir);
    if (parent === dir) return canonical(resolve(cwd));
    dir = parent;
  }
}

async function readStore(): Promise<TrustStore> {
  try {
    const parsed = JSON.parse(await readFile(TRUST_FILE, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const roots = (parsed as { trustedProjectRoots?: unknown }).trustedProjectRoots;
    if (roots === undefined) return {};
    return {
      trustedProjectRoots: Array.isArray(roots) ? roots.filter(isUsableStoredRoot) : [],
    };
  } catch {
    return {};
  }
}

async function writeStore(store: TrustStore): Promise<void> {
  await mkdir(dirname(TRUST_FILE), { recursive: true });
  await writeFile(TRUST_FILE, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await chmod(TRUST_FILE, 0o600).catch(() => {});
}

export interface ProjectTrustStatus {
  root: string;
  trusted: boolean;
  reason: 'env' | 'store' | 'missing';
}

export async function projectTrustStatus(cwd: string = process.cwd()): Promise<ProjectTrustStatus> {
  const root = await projectRoot(cwd);
  if (envFlag(BRAND_ENV.trustProject)) return { root, trusted: true, reason: 'env' };
  const store = await readStore();
  const trusted = new Set(await Promise.all((store.trustedProjectRoots ?? []).map(canonical)));
  return trusted.has(root)
    ? { root, trusted: true, reason: 'store' }
    : { root, trusted: false, reason: 'missing' };
}

export async function trustProject(cwd: string = process.cwd()): Promise<string> {
  const root = await projectRoot(cwd);
  const store = await readStore();
  const existing = new Set(await Promise.all((store.trustedProjectRoots ?? []).map(canonical)));
  existing.add(root);
  await writeStore({ trustedProjectRoots: [...existing].sort() });
  return root;
}

export async function untrustProject(cwd: string = process.cwd()): Promise<string> {
  const root = await projectRoot(cwd);
  const store = await readStore();
  const roots = await Promise.all((store.trustedProjectRoots ?? []).map(canonical));
  await writeStore({ trustedProjectRoots: roots.filter((r) => r !== root).sort() });
  return root;
}

export async function projectConfigPathIfTrusted(file: string, cwd: string = process.cwd()): Promise<string | null> {
  const root = await projectRoot(cwd);
  const p = appProjectPath(root, file);
  if (!(await exists(p))) return null;
  const trust = await projectTrustStatus(root);
  return trust.trusted ? p : null;
}

export async function hasUntrustedProjectConfig(file: string, cwd: string = process.cwd()): Promise<boolean> {
  const root = await projectRoot(cwd);
  const p = appProjectPath(root, file);
  if (!(await exists(p))) return false;
  const trust = await projectTrustStatus(root);
  return !trust.trusted;
}
