import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { appHomePath } from './brand.js';
import { FOLDERS } from './brain.js';
import { INDEX_PATH } from './search/store.js';

export type BrainDoctorStatus = 'pass' | 'warn' | 'fail';

export interface BrainDoctorCheck {
  id: string;
  status: BrainDoctorStatus;
  message: string;
  path?: string;
  details?: string[];
}

export interface BrainDoctorReport {
  ok: boolean;
  checks: BrainDoctorCheck[];
}

export interface BrainDoctorOptions {
  brainPath?: string;
  indexPath?: string;
  mcpConfigPath?: string;
  indexFreshnessToleranceMs?: number;
  expectedFolders?: readonly string[];
}

export const BRAIN_HOT_FILES = [
  'SANOOK.md',
  'Shared/AI-Context-Index.md',
  'Vault Structure Map.md',
  'Shared/Operating-State/current-state.md',
] as const;

const DEFAULT_INDEX_FRESHNESS_TOLERANCE_MS = 1000;
const SKIP_DIRS = new Set(['.git', '.obsidian', 'node_modules']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFolderReference(path: string): string {
  return path.replace(/\/+$/, '');
}

function extractFolderReferences(map: string): Set<string> {
  return new Set([...map.matchAll(/`([^`]+)`/g)].map((match) => normalizeFolderReference(match[1])));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function latestMarkdownMtimeMs(root: string): Promise<number> {
  let latest = 0;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      try {
        latest = Math.max(latest, (await stat(join(dir, entry.name))).mtimeMs);
      } catch {
        // File disappeared between readdir and stat; ignore the race.
      }
    }
  }

  await walk(root);
  return latest;
}

export async function checkBrainHotFiles(brainPath: string): Promise<BrainDoctorCheck> {
  const missing: string[] = [];
  for (const rel of BRAIN_HOT_FILES) {
    if (!(await fileExists(join(brainPath, rel)))) missing.push(rel);
  }

  if (missing.length) {
    return {
      id: 'brain.hot-files',
      status: 'fail',
      message: `Missing ${missing.length} required second-brain file${missing.length === 1 ? '' : 's'}.`,
      path: brainPath,
      details: missing,
    };
  }

  return {
    id: 'brain.hot-files',
    status: 'pass',
    message: 'Required second-brain hot files are present.',
    path: brainPath,
  };
}

export async function checkVaultStructureMap(
  brainPath: string,
  expectedFolders: readonly string[] = FOLDERS.map((f) => f.dir),
): Promise<BrainDoctorCheck> {
  const mapPath = join(brainPath, 'Vault Structure Map.md');
  let map: string;
  try {
    map = await readFile(mapPath, 'utf8');
  } catch {
    return {
      id: 'brain.structure-map',
      status: 'fail',
      message: 'Vault Structure Map.md is missing or unreadable.',
      path: mapPath,
    };
  }

  const folderReferences = extractFolderReferences(map);
  const missing = expectedFolders.filter((dir) => !folderReferences.has(normalizeFolderReference(dir)));
  if (missing.length) {
    return {
      id: 'brain.structure-map',
      status: 'fail',
      message: `Vault Structure Map.md is missing ${missing.length} folder reference${missing.length === 1 ? '' : 's'}.`,
      path: mapPath,
      details: missing,
    };
  }

  return {
    id: 'brain.structure-map',
    status: 'pass',
    message: 'Vault Structure Map.md covers the expected folder manifest.',
    path: mapPath,
  };
}

export async function checkSearchIndexFreshness(
  brainPath: string,
  indexPath: string = INDEX_PATH,
  toleranceMs: number = DEFAULT_INDEX_FRESHNESS_TOLERANCE_MS,
): Promise<BrainDoctorCheck> {
  const latestVaultMtimeMs = await latestMarkdownMtimeMs(brainPath);
  if (latestVaultMtimeMs === 0) {
    return {
      id: 'brain.search-index',
      status: 'warn',
      message: 'No markdown files were found in the configured second-brain vault.',
      path: brainPath,
    };
  }

  let indexMtimeMs = 0;
  try {
    indexMtimeMs = (await stat(indexPath)).mtimeMs;
  } catch {
    return {
      id: 'brain.search-index',
      status: 'warn',
      message: 'Search index is missing; run `sanook index` to build it.',
      path: indexPath,
    };
  }

  if (indexMtimeMs + toleranceMs < latestVaultMtimeMs) {
    return {
      id: 'brain.search-index',
      status: 'warn',
      message: 'Search index is older than the second-brain markdown files.',
      path: indexPath,
      details: [`index_mtime_ms=${Math.round(indexMtimeMs)}`, `vault_latest_mtime_ms=${Math.round(latestVaultMtimeMs)}`],
    };
  }

  return {
    id: 'brain.search-index',
    status: 'pass',
    message: 'Search index is present and fresh enough for the vault.',
    path: indexPath,
  };
}

export async function checkBrainMcpWiring(
  brainPath: string,
  mcpConfigPath: string = appHomePath('mcp.json'),
): Promise<BrainDoctorCheck> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(mcpConfigPath, 'utf8')) as unknown;
  } catch {
    return {
      id: 'brain.mcp',
      status: 'warn',
      message: 'MCP config is missing or unreadable; `sanook brain init` can wire the vault.',
      path: mcpConfigPath,
    };
  }

  const servers = isRecord(raw) && isRecord(raw.mcpServers) ? raw.mcpServers : undefined;
  const server = servers && isRecord(servers['second-brain']) ? servers['second-brain'] : undefined;
  const args = server && Array.isArray(server.args) ? server.args : [];
  if (!args.includes(brainPath)) {
    return {
      id: 'brain.mcp',
      status: 'warn',
      message: 'MCP server `second-brain` is not wired to the configured vault path.',
      path: mcpConfigPath,
    };
  }

  return {
    id: 'brain.mcp',
    status: 'pass',
    message: 'MCP server `second-brain` points at the configured vault path.',
    path: mcpConfigPath,
  };
}

export async function checkBrain(options: BrainDoctorOptions = {}): Promise<BrainDoctorReport> {
  const checks: BrainDoctorCheck[] = [];
  const brainPath = options.brainPath;
  if (!brainPath) {
    checks.push({
      id: 'brain.configured',
      status: 'fail',
      message: 'No second-brain path is configured.',
    });
    return { ok: false, checks };
  }

  try {
    if (!(await stat(brainPath)).isDirectory()) {
      checks.push({
        id: 'brain.path',
        status: 'fail',
        message: 'Configured second-brain path is not a directory.',
        path: brainPath,
      });
      return { ok: false, checks };
    }
  } catch {
    checks.push({
      id: 'brain.path',
      status: 'fail',
      message: 'Configured second-brain path does not exist.',
      path: brainPath,
    });
    return { ok: false, checks };
  }

  checks.push({
    id: 'brain.path',
    status: 'pass',
    message: 'Configured second-brain path exists.',
    path: brainPath,
  });
  checks.push(await checkBrainHotFiles(brainPath));
  checks.push(await checkVaultStructureMap(brainPath, options.expectedFolders));
  checks.push(
    await checkSearchIndexFreshness(
      brainPath,
      options.indexPath,
      options.indexFreshnessToleranceMs ?? DEFAULT_INDEX_FRESHNESS_TOLERANCE_MS,
    ),
  );
  checks.push(await checkBrainMcpWiring(brainPath, options.mcpConfigPath));

  return { ok: !checks.some((check) => check.status === 'fail'), checks };
}
