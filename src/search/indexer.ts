// ============================================================================
// src/search/indexer.ts — incremental, O(delta) vault indexer.
//
// Beats arra-oracle's indexer on three axes:
//   1. NO directory convention. arra requires a `ψ/memory/…` tree; we index the
//      user's EXISTING second-brain vault via getBrainPath(), any layout.
//   2. TRUE incremental. arra full-re-indexes every pass (guarded only by a >50%
//      delete abort). We diff a per-file manifest: an unchanged file costs ONE
//      stat(); only changed files are read+sha256+re-chunked; deleted files have
//      their chunks evicted precisely (manifest stores each file's chunk ids).
//   3. ONE unified surface. Vault chunks, active memory Facts, recent session
//      turns, and skills all land in the SAME ranked index — the unification arra
//      never did (its memory store and search index use divorced formats).
//
// The file-walk is injected (VaultFS) so the core logic unit-tests against an
// in-memory fs + clock with zero disk, exactly like memory-store.ts.
// ============================================================================
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { appHomePath } from '../brand.js';
import { getBrainPath } from '../memory.js';
import { loadSkills } from '../skills.js';
import { activeFacts, effImportance, loadStore, type Fact } from '../memory-store.js';
import { chunkMarkdown } from './chunk.js';
import { addDoc, removeDoc, removeSource, type Doc, type InvertedIndex } from './index-core.js';
import { loadIndex, saveIndex, type Manifest } from './store.js';
import { buildVectorIndex, embedTexts, getEmbedder, saveVectors, type VectorIndex } from './embed-store.js';

/** injected filesystem boundary — real impl walks disk; tests pass an in-memory map. */
export interface VaultFS {
  /** vault-relative paths of every indexable .md file (already ignore-filtered). */
  listMarkdown(): Promise<string[]>;
  /** {mtimeMs,size} for a file, or null if it vanished (race-safe). */
  fingerprint(rel: string): Promise<{ mtimeMs: number; size: number } | null>;
  read(rel: string): Promise<string>;
  /** content hash (sha256 hex). */
  hash(content: string): string;
}

export interface VaultDiff {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}

export interface IndexReport extends VaultDiff {
  memory: number;
  sessions: number;
  skills: number;
  vectors: number;
  vaultPath: string | null;
}

/** strip a .md path to a human title fallback when a chunk has no heading. */
function fileTitle(rel: string): string {
  return (rel.split('/').pop() ?? rel).replace(/\.md$/i, '');
}

/**
 * Incremental vault pass. Mutates `index`, returns the NEXT manifest + a diff.
 * Pure w.r.t. the injected fs/clock — no disk access of its own.
 */
export async function indexVaultFiles(
  index: InvertedIndex,
  manifest: Manifest,
  fs: VaultFS,
): Promise<{ manifest: Manifest; diff: VaultDiff }> {
  const next: Manifest = {};
  const diff: VaultDiff = { added: 0, updated: 0, removed: 0, skipped: 0 };

  const paths = await fs.listMarkdown();
  const seenExisting = new Set<string>();
  for (const rel of paths) {
    const fp = await fs.fingerprint(rel);
    if (!fp) continue; // vanished between listing and stat → treat as deletion below
    seenExisting.add(rel);
    const prev = manifest[rel];

    // cheap path: mtime + size unchanged ⇒ skip without reading the file
    if (prev && prev.mtimeMs === fp.mtimeMs && prev.size === fp.size) {
      next[rel] = prev;
      diff.skipped++;
      continue;
    }

    const content = await fs.read(rel);
    const sha = fs.hash(content);

    // touched but content identical (mtime bumped by a sync) ⇒ refresh fingerprint, keep chunks
    if (prev && prev.sha === sha) {
      next[rel] = { ...prev, mtimeMs: fp.mtimeMs, size: fp.size };
      diff.skipped++;
      continue;
    }

    // changed or new ⇒ evict old chunks, re-chunk, re-add
    if (prev) for (const id of prev.ids) removeDoc(index, id);
    const parsed = chunkMarkdown(rel, content);
    const title0 = fileTitle(rel);
    const ids: string[] = [];
    for (const c of parsed.chunks) {
      const doc: Doc = {
        id: c.id,
        source: 'vault',
        title: c.heading || title0,
        text: c.text,
        path: rel,
        noteType: parsed.frontmatter.noteType,
        tags: parsed.frontmatter.tags,
        links: parsed.links,
        updatedMs: fp.mtimeMs,
      };
      addDoc(index, doc);
      ids.push(c.id);
    }
    next[rel] = { mtimeMs: fp.mtimeMs, size: fp.size, sha, ids };
    if (prev) diff.updated++;
    else diff.added++;
  }

  // deletions: present last time, absent now ⇒ evict their chunks
  for (const rel of Object.keys(manifest)) {
    if (seenExisting.has(rel)) continue;
    for (const id of manifest[rel].ids) removeDoc(index, id);
    diff.removed++;
  }

  return { manifest: next, diff };
}

/** refresh the live memory corpus: drop old memory docs, re-add active Facts with an importance prior. */
export function foldFacts(index: InvertedIndex, facts: Fact[], now: number): number {
  removeSource(index, 'memory');
  const searchable = facts.filter((f) => f.status === 'active' && f.tier !== 'inbox');
  for (const f of searchable) {
    addDoc(index, {
      id: f.id, // memory-store deriveId — stable, dedups against itself
      source: 'memory',
      title: '',
      text: f.text,
      noteType: f.noteType,
      tags: f.tags,
      importance: effImportance(f, now),
      updatedMs: f.updated,
    });
  }
  return searchable.length;
}

export interface SessionDoc {
  id: string;
  text: string;
  updatedMs: number;
}

/** refresh the session corpus (first-user-message per recent session). */
export function foldSessions(index: InvertedIndex, sessions: SessionDoc[]): number {
  removeSource(index, 'session');
  for (const s of sessions) {
    addDoc(index, { id: s.id, source: 'session', title: '', text: s.text, updatedMs: s.updatedMs });
  }
  return sessions.length;
}

export interface SkillDoc {
  id: string;
  name: string;
  text: string;
}

/** refresh the skill corpus (name + description + whenToUse). */
export function foldSkills(index: InvertedIndex, skills: SkillDoc[]): number {
  removeSource(index, 'skill');
  for (const s of skills) {
    addDoc(index, { id: s.id, source: 'skill', title: s.name, text: s.text });
  }
  return skills.length;
}

function docEmbeddingText(doc: { title?: string; text: string }): string {
  return [doc.title?.trim(), doc.text.trim()].filter(Boolean).join('\n').slice(0, 4000);
}

export async function vectorizeIndex(
  index: InvertedIndex,
  tag: string,
  embed: (texts: string[]) => Promise<number[][]>,
): Promise<VectorIndex> {
  const docs = [...index.docs.values()]
    .filter((d) => d.text.trim())
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!docs.length) return buildVectorIndex(tag, []);

  const vectors = await embed(docs.map(docEmbeddingText));
  if (vectors.length !== docs.length) {
    throw new Error(`embedding count mismatch: expected ${docs.length}, got ${vectors.length}`);
  }
  return buildVectorIndex(
    tag,
    docs.map((d, i) => ({ id: d.id, vec: vectors[i] })),
  );
}

// ---- real-filesystem wiring ------------------------------------------------

const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.next', '.cache', '.git',
  '.obsidian', 'vendor', '.turbo', '.vercel',
]);

/** node:fs implementation of VaultFS — recursive .md walk with the default-ignore set. */
export function nodeVaultFS(root: string): VaultFS {
  async function walk(dir: string, rel: string, out: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        await walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, out);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  }
  return {
    async listMarkdown() {
      const out: string[] = [];
      await walk(root, '', out);
      return out.sort();
    },
    async fingerprint(relPath) {
      try {
        const s = await stat(join(root, relPath));
        return { mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        return null;
      }
    },
    read: (relPath) => readFile(join(root, relPath), 'utf8'),
    hash: (content) => createHash('sha256').update(content).digest('hex'),
  };
}

const SESSIONS_DIR = appHomePath('sessions');

async function configEmbeddingModel(): Promise<string | undefined> {
  try {
    const cfg = JSON.parse(await readFile(appHomePath('config.json'), 'utf8')) as { embeddingModel?: string };
    return cfg.embeddingModel;
  } catch {
    return undefined;
  }
}

/** load first-user-message of the most recent sessions (bounded) for the session corpus. */
export async function loadRecentSessions(limit = 60): Promise<SessionDoc[]> {
  const out: SessionDoc[] = [];
  let candidates: { file: string; full: string; mtimeMs: number }[];
  try {
    const files = (await readdir(SESSIONS_DIR)).filter((f) => f.endsWith('.json'));
    const withStats = await Promise.all(
      files.map(async (file) => {
        const full = join(SESSIONS_DIR, file);
        try {
          return { file, full, mtimeMs: (await stat(full)).mtimeMs };
        } catch {
          return null;
        }
      }),
    );
    candidates = withStats
      .filter((c): c is { file: string; full: string; mtimeMs: number } => c !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file))
      .slice(0, limit);
  } catch {
    return out;
  }
  for (const { file, full, mtimeMs } of candidates) {
    try {
      const s = JSON.parse(await readFile(full, 'utf8')) as {
        id?: string;
        messages?: { role: string; content: unknown }[];
      };
      const firstUser = (s.messages ?? []).find((m) => m.role === 'user');
      const text = typeof firstUser?.content === 'string' ? firstUser.content : '';
      if (!text.trim()) continue;
      out.push({ id: `sess:${s.id ?? file}`, text: text.slice(0, 2000), updatedMs: mtimeMs });
    } catch {
      /* skip a corrupt session file */
    }
  }
  return out;
}

/**
 * Full incremental reindex: vault (via getBrainPath) + memory + sessions + skills,
 * persisted atomically. Returns a change report. This is what `sanook index` and
 * the MCP `sanook_index` tool call.
 */
export async function reindex(now: number = Date.now()): Promise<IndexReport> {
  const { index, manifest } = await loadIndex();

  let diff: VaultDiff = { added: 0, updated: 0, removed: 0, skipped: 0 };
  let nextManifest = manifest;
  const brain = await getBrainPath();
  if (brain) {
    const r = await indexVaultFiles(index, manifest, nodeVaultFS(brain));
    nextManifest = r.manifest;
    diff = r.diff;
  }

  const memory = foldFacts(index, activeFacts(await loadStore(now)), now);
  const sessions = foldSessions(index, await loadRecentSessions());
  const skills = foldSkills(
    index,
    (await loadSkills()).map((s) => ({
      id: `skill:${s.name}`,
      name: s.name,
      text: `${s.description} ${s.whenToUse ?? ''}`.trim(),
    })),
  );

  await saveIndex(index, nextManifest);

  let vectors = 0;
  const embedder = getEmbedder(process.env.SANOOK_EMBEDDING_MODEL ?? (await configEmbeddingModel()));
  if (embedder) {
    try {
      const vi = await vectorizeIndex(index, embedder.tag, (texts) => embedTexts(embedder, texts));
      await saveVectors(vi);
      vectors = vi.ids.length;
    } catch {
      // Semantic search is optional. A provider/network failure must never break
      // the BM25 floor; the engine will degrade until the next successful index.
    }
  }

  return { ...diff, memory, sessions, skills, vectors, vaultPath: brain ?? null };
}
