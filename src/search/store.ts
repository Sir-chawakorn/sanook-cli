// ============================================================================
// src/search/store.ts — the ONLY disk-touching module of the search subsystem.
//
// Mirrors memory-store.ts's FS discipline exactly: atomic tmp+rename writes,
// 0o600 permissions, honors persistenceEnabled(), and loadIndex() NEVER writes
// (read paths stay pure). The persisted payload is one JSON file next to
// memory.json under ~/.sanook/search/index.json — no SQLite file, no native db.
// Vectors live in their own sidecar (embed-store.ts) so the BM25 floor never
// pays to read them.
// ============================================================================
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { appHomePath, persistenceEnabled } from '../brand.js';
import {
  emptyIndex,
  indexFromJSON,
  indexToJSON,
  type InvertedIndex,
} from './index-core.js';

export interface ManifestEntry {
  mtimeMs: number;
  size: number;
  sha: string; // sha256 of file content — only read when mtime/size differ (cheap incremental)
  ids: string[]; // chunk doc-ids this file produced → precise eviction on change/delete
}
/** vault-relative path → file fingerprint. The incremental indexer diffs against this. */
export type Manifest = Record<string, ManifestEntry>;

export interface PersistedIndex {
  index: InvertedIndex;
  manifest: Manifest;
}

export const SEARCH_DIR = appHomePath('search');
export const INDEX_PATH = join(SEARCH_DIR, 'index.json');

interface IndexFileJSON {
  v: number;
  index: ReturnType<typeof indexToJSON>;
  manifest: Manifest;
}
const FILE_VERSION = 1;

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** mtime of the on-disk index (ms) or 0 if absent — lets the engine cache-invalidate cheaply. */
export async function indexMtimeMs(): Promise<number> {
  try {
    return (await stat(INDEX_PATH)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Load the persisted index + manifest. Pure read: a missing or malformed file
 * degrades to an empty index rather than throwing, so a corrupt cache never
 * bricks search — the next index() rebuilds it.
 */
export async function loadIndex(): Promise<PersistedIndex> {
  try {
    const raw = JSON.parse(await readFile(INDEX_PATH, 'utf8')) as IndexFileJSON;
    if (raw && raw.v === FILE_VERSION) {
      return { index: indexFromJSON(raw.index), manifest: raw.manifest ?? {} };
    }
  } catch {
    /* no file yet, or malformed → fall through to empty */
  }
  return { index: emptyIndex(), manifest: {} };
}

/**
 * Persist index + manifest atomically (tmp+rename), 0o600. No-op when persistence
 * is disabled (the in-memory index still works for the process, just uncached).
 */
export async function saveIndex(index: InvertedIndex, manifest: Manifest): Promise<void> {
  if (!persistenceEnabled()) return;
  await mkdir(SEARCH_DIR, { recursive: true });
  const payload: IndexFileJSON = { v: FILE_VERSION, index: indexToJSON(index), manifest };
  const tmp = join(SEARCH_DIR, `index.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    await chmod(tmp, 0o600).catch(() => {});
    await rename(tmp, INDEX_PATH);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/** true if a persisted index already exists on disk. */
export function hasIndex(): Promise<boolean> {
  return pathExists(INDEX_PATH);
}
