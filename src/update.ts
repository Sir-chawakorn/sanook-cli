import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface PackageMeta {
  name: string;
  version: string;
}

export interface UpdateCheck {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  isOutdated: boolean;
  installCommand: string;
}

export interface UpdateCache {
  checkedAt?: string;
  latestVersion?: string;
}

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  json: () => Promise<unknown>;
}>;

type SpawnLike = (
  command: string,
  args: string[],
  options: { stdio: 'inherit'; env: NodeJS.ProcessEnv },
) => ChildProcess;

interface CheckOptions {
  fetchImpl?: FetchLike;
  registry?: string;
  timeoutMs?: number;
}

interface InstallOptions {
  spawnImpl?: SpawnLike;
}

interface NpmPackageResponse {
  'dist-tags'?: {
    latest?: string;
  };
}

function packageUrl(registry: string, packageName: string): string {
  const base = registry.replace(/\/+$/, '') || DEFAULT_REGISTRY;
  const encoded = encodeURIComponent(packageName).replace(/^%40/, '@');
  return `${base}/${encoded}`;
}

function splitVersion(version: string): { core: number[]; prerelease: string[] } {
  const [withoutBuild] = version.trim().replace(/^v/, '').split('+');
  const [corePart, prereleasePart = ''] = withoutBuild.split('-', 2);
  return {
    core: corePart.split('.').map((part) => Number.parseInt(part, 10)).map((n) => (Number.isFinite(n) ? n : 0)),
    prerelease: prereleasePart ? prereleasePart.split('.') : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const pa = a[i];
    const pb = b[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    const na = /^\d+$/.test(pa) ? Number(pa) : Number.NaN;
    const nb = /^\d+$/.test(pb) ? Number(pb) : Number.NaN;
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na > nb ? 1 : -1;
    if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1;
    if (pa !== pb) return pa > pb ? 1 : -1;
  }
  return 0;
}

export function compareVersions(a: string, b: string): number {
  const va = splitVersion(a);
  const vb = splitVersion(b);
  const len = Math.max(va.core.length, vb.core.length, 3);
  for (let i = 0; i < len; i++) {
    const na = va.core[i] ?? 0;
    const nb = vb.core[i] ?? 0;
    if (na !== nb) return na > nb ? 1 : -1;
  }
  return comparePrerelease(va.prerelease, vb.prerelease);
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

export function installCommand(packageName: string): string {
  return `npm install -g ${packageName}@latest`;
}

export function shouldCheckForUpdate(
  cache: UpdateCache | undefined,
  nowMs: number = Date.now(),
  intervalMs: number = UPDATE_CHECK_INTERVAL_MS,
): boolean {
  if (!cache?.checkedAt) return true;
  const checkedAt = Date.parse(cache.checkedAt);
  if (!Number.isFinite(checkedAt)) return true;
  if (checkedAt > nowMs) return true;
  return nowMs - checkedAt >= intervalMs;
}

export async function fetchLatestVersion(meta: PackageMeta, opts: CheckOptions = {}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetchImpl(packageUrl(opts.registry ?? process.env.npm_config_registry ?? DEFAULT_REGISTRY, meta.name), {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`npm registry ตอบ ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
    }
    const body = (await res.json()) as NpmPackageResponse;
    const latest = body['dist-tags']?.latest;
    if (!latest) throw new Error('npm registry ไม่มี dist-tag "latest"');
    return latest;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForUpdate(meta: PackageMeta, opts: CheckOptions = {}): Promise<UpdateCheck> {
  const latestVersion = await fetchLatestVersion(meta, opts);
  return {
    packageName: meta.name,
    currentVersion: meta.version,
    latestVersion,
    isOutdated: isNewerVersion(latestVersion, meta.version),
    installCommand: installCommand(meta.name),
  };
}

export function installLatest(meta: PackageMeta, opts: InstallOptions = {}): Promise<number> {
  const spawnImpl = opts.spawnImpl ?? spawn;
  return new Promise((resolve, reject) => {
    const child = spawnImpl('npm', ['install', '-g', `${meta.name}@latest`], {
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32', // Windows: npm = npm.cmd → spawn ตรงๆ ENOENT
    });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}
