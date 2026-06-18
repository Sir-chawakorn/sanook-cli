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

const SEMVER_NUMERIC_IDENTIFIER = '(?:0|[1-9]\\d*)';
const SEMVER_NON_NUMERIC_PRERELEASE_IDENTIFIER = '\\d*[A-Za-z-][0-9A-Za-z-]*';
const SEMVER_PRERELEASE_IDENTIFIER = `(?:${SEMVER_NUMERIC_IDENTIFIER}|${SEMVER_NON_NUMERIC_PRERELEASE_IDENTIFIER})`;
const NPM_VERSION_PATTERN = new RegExp(
  `^v?${SEMVER_NUMERIC_IDENTIFIER}\\.${SEMVER_NUMERIC_IDENTIFIER}\\.${SEMVER_NUMERIC_IDENTIFIER}` +
    `(?:-${SEMVER_PRERELEASE_IDENTIFIER}(?:\\.${SEMVER_PRERELEASE_IDENTIFIER})*)?` +
    `(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && (err as { name?: unknown }).name === 'AbortError';
}

function readLatestDistTag(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  const distTags = (body as { 'dist-tags'?: unknown })['dist-tags'];
  if (typeof distTags !== 'object' || distTags === null) return undefined;
  return (distTags as { latest?: unknown }).latest;
}

function packageUrl(registry: string, packageName: string): string {
  const base = registry.trim().replace(/\/+$/, '') || DEFAULT_REGISTRY;
  const encoded = encodeURIComponent(packageName).replace(/^%40/, '@');
  return `${base}/${encoded}`;
}

function normalizeNumericIdentifier(part: string): string | undefined {
  return /^\d+$/.test(part) ? part.replace(/^0+/, '') || '0' : undefined;
}

function compareNumericIdentifiers(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a > b ? 1 : -1;
}

function splitVersion(version: string): { core: string[]; prerelease: string[] } {
  const [withoutBuild] = version.trim().replace(/^v/, '').split('+');
  const prereleaseIndex = withoutBuild.indexOf('-');
  const corePart = prereleaseIndex === -1 ? withoutBuild : withoutBuild.slice(0, prereleaseIndex);
  const prereleasePart = prereleaseIndex === -1 ? '' : withoutBuild.slice(prereleaseIndex + 1);
  return {
    core: corePart.split('.').map((part) => normalizeNumericIdentifier(part) ?? '0'),
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
    const na = normalizeNumericIdentifier(pa);
    const nb = normalizeNumericIdentifier(pb);
    if (na !== undefined && nb !== undefined && na !== nb) {
      return compareNumericIdentifiers(na, nb);
    }
    if ((na !== undefined) !== (nb !== undefined)) return na !== undefined ? -1 : 1;
    if (pa !== pb) return pa > pb ? 1 : -1;
  }
  return 0;
}

export function compareVersions(a: string, b: string): number {
  const va = splitVersion(a);
  const vb = splitVersion(b);
  const len = Math.max(va.core.length, vb.core.length, 3);
  for (let i = 0; i < len; i++) {
    const na = va.core[i] ?? '0';
    const nb = vb.core[i] ?? '0';
    if (na !== nb) return compareNumericIdentifiers(na, nb);
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
  const timeoutMs = opts.timeoutMs ?? 8000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(packageUrl(opts.registry ?? process.env.npm_config_registry ?? DEFAULT_REGISTRY, meta.name), {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`npm registry ตอบ ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
    }
    const body = await res.json();
    const latest = readLatestDistTag(body);
    if (typeof latest !== 'string' || !latest.trim()) throw new Error('npm registry ไม่มี dist-tag "latest"');
    const trimmedLatest = latest.trim();
    if (!NPM_VERSION_PATTERN.test(trimmedLatest)) throw new Error('npm registry dist-tag "latest" ไม่ใช่ semver');
    return trimmedLatest;
  } catch (err) {
    if (ctrl.signal.aborted && isAbortError(err)) throw new Error(`npm registry timeout after ${timeoutMs}ms`);
    throw err;
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
