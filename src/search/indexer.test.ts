import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDoc, emptyIndex, bm25Search, indexStats } from './index-core.js';
import {
  indexVaultFiles,
  foldFacts,
  foldSessions,
  foldSkills,
  vectorizeIndex,
  type VaultFS,
} from './indexer.js';
import { cosineTopK } from './embed-store.js';
import { emptyStore, mergeFact } from '../memory-store.js';
import type { Manifest } from './store.js';

interface MemFile {
  content: string;
  mtimeMs: number;
}

/** in-memory VaultFS with a read counter, so we can assert O(delta) behavior. */
function memFS(files: Map<string, MemFile>): VaultFS & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async listMarkdown() {
      return [...files.keys()].sort();
    },
    async fingerprint(rel) {
      const f = files.get(rel);
      return f ? { mtimeMs: f.mtimeMs, size: f.content.length } : null;
    },
    async read(rel) {
      reads.push(rel);
      return files.get(rel)!.content;
    },
    hash: (c) => `${c.length}:${c}`, // identity-ish: stable per content, differs on change
  };
}

const body = (s: string): string => `${s} ${'padding words to clear the min chunk size threshold. '.repeat(3)}`;

describe('indexVaultFiles — incremental', () => {
  it('first pass indexes everything; second pass with one change re-reads only that file', async () => {
    const files = new Map<string, MemFile>([
      ['a.md', { content: `# A\n${body('alpha unique')}`, mtimeMs: 1 }],
      ['b.md', { content: `# B\n${body('bravo unique')}`, mtimeMs: 1 }],
      ['c.md', { content: `# C\n${body('charlie unique')}`, mtimeMs: 1 }],
    ]);
    const idx = emptyIndex();
    let manifest: Manifest = {};
    const fs1 = memFS(files);
    const r1 = await indexVaultFiles(idx, manifest, fs1);
    manifest = r1.manifest;
    expect(r1.diff.added).toBe(3);
    expect(fs1.reads.sort()).toEqual(['a.md', 'b.md', 'c.md']);
    expect(bm25Search(idx, 'bravo')[0]).toBeTruthy();

    // change only b.md (new content + bumped mtime)
    files.set('b.md', { content: `# B\n${body('bravo CHANGED delta')}`, mtimeMs: 2 });
    const fs2 = memFS(files);
    const r2 = await indexVaultFiles(idx, manifest, fs2);
    manifest = r2.manifest;
    expect(r2.diff).toMatchObject({ added: 0, updated: 1, removed: 0, skipped: 2 });
    expect(fs2.reads).toEqual(['b.md']); // ← only the changed file was read
    expect(bm25Search(idx, 'delta')[0]).toBeTruthy();
  });

  it('deleting a file evicts its chunks', async () => {
    const files = new Map<string, MemFile>([
      ['keep.md', { content: `# Keep\n${body('keepterm')}`, mtimeMs: 1 }],
      ['gone.md', { content: `# Gone\n${body('goneterm')}`, mtimeMs: 1 }],
    ]);
    const idx = emptyIndex();
    let manifest: Manifest = {};
    manifest = (await indexVaultFiles(idx, manifest, memFS(files))).manifest;
    expect(bm25Search(idx, 'goneterm')[0]).toBeTruthy();

    files.delete('gone.md');
    const r = await indexVaultFiles(idx, manifest, memFS(files));
    expect(r.diff.removed).toBe(1);
    expect(bm25Search(idx, 'goneterm')).toEqual([]);
    expect(bm25Search(idx, 'keepterm')[0]).toBeTruthy();
  });

  it('treats a file that vanishes after listing as deleted', async () => {
    const idx = emptyIndex();
    const manifest: Manifest = {
      'gone.md': { mtimeMs: 1, size: 10, sha: 'old', ids: ['old:gonghost'] },
    };
    idx.docs.set('old:gonghost', {
      id: 'old:gonghost',
      source: 'vault',
      title: 'Gone',
      text: 'gonghost',
      tags: [],
      links: [],
      dl: 1,
    });
    idx.postings.set('gonghost', [{ docId: 'old:gonghost', tf: 1 }]);
    idx.totalDl = 1;

    const fs: VaultFS = {
      async listMarkdown() {
        return ['gone.md'];
      },
      async fingerprint() {
        return null;
      },
      async read() {
        throw new Error('read should not be called');
      },
      hash: () => '',
    };

    const r = await indexVaultFiles(idx, manifest, fs);
    expect(r.diff.removed).toBe(1);
    expect(r.manifest).toEqual({});
    expect(bm25Search(idx, 'gonghost')).toEqual([]);
  });

  it('mtime bumped but content identical → skipped (sha match), no re-chunk', async () => {
    const files = new Map<string, MemFile>([['a.md', { content: `# A\n${body('stable')}`, mtimeMs: 1 }]]);
    const idx = emptyIndex();
    let manifest: Manifest = {};
    manifest = (await indexVaultFiles(idx, manifest, memFS(files))).manifest;
    const docsAfter1 = indexStats(idx).docs;

    files.set('a.md', { content: `# A\n${body('stable')}`, mtimeMs: 999 }); // same content, new mtime
    const r = await indexVaultFiles(idx, manifest, memFS(files));
    expect(r.diff.skipped).toBe(1);
    expect(r.diff.updated).toBe(0);
    expect(indexStats(idx).docs).toBe(docsAfter1);
  });

  it('unchanged file (same mtime+size) is skipped without reading', async () => {
    const files = new Map<string, MemFile>([['a.md', { content: `# A\n${body('same')}`, mtimeMs: 5 }]]);
    const idx = emptyIndex();
    const manifest = (await indexVaultFiles(idx, {}, memFS(files))).manifest;
    const fs2 = memFS(files);
    const r = await indexVaultFiles(idx, manifest, fs2);
    expect(r.diff.skipped).toBe(1);
    expect(fs2.reads).toEqual([]); // never opened the file
  });
});

describe('fold live corpora into the shared index', () => {
  it('folds facts (with importance prior), sessions, skills; refresh is idempotent', () => {
    const idx = emptyIndex();
    let store = emptyStore(1000);
    store = mergeFact(store, { text: 'ปิ๊ก uses Playwright not Puppeteer', noteType: 'preference' }, 1000).store;
    store = mergeFact(store, { text: 'deploy target is Vercel edge', noteType: 'decision' }, 1000).store;
    const facts = store.facts.filter((f) => f.status === 'active');

    expect(foldFacts(idx, facts, 1000)).toBe(2);
    foldSessions(idx, [{ id: 'sess:1', text: 'set up the postgres migration', updatedMs: 1 }]);
    foldSkills(idx, [{ id: 'skill:deploy', name: 'deploy', text: 'ship to vercel' }]);

    expect(bm25Search(idx, 'playwright')[0]?.id).toBe(facts[0].id);
    expect(bm25Search(idx, 'postgres migration', 50, new Set(['session']))[0]?.id).toBe('sess:1');

    // re-folding facts must not duplicate (removeSource then re-add)
    const before = indexStats(idx).docs;
    foldFacts(idx, facts, 2000);
    expect(indexStats(idx).docs).toBe(before);
  });

  it('does not expose inbox memory facts to the shared search index', () => {
    const idx = emptyIndex();
    let store = emptyStore(1000);
    store = mergeFact(store, { text: 'visible durable deployment fact', trust: 'agent' }, 1000).store;
    store = mergeFact(store, { text: 'hidden untrusted scraped rumour', trust: 'untrusted' }, 1001).store;
    const facts = store.facts.filter((f) => f.status === 'active');

    expect(facts).toHaveLength(2);
    expect(foldFacts(idx, facts, 1001)).toBe(1);
    expect(bm25Search(idx, 'visible deployment', 50, new Set(['memory']))[0]).toBeTruthy();
    expect(bm25Search(idx, 'hidden scraped', 50, new Set(['memory']))).toEqual([]);
  });
});

describe('vectorizeIndex — semantic sidecar build', () => {
  it('embeds every searchable doc with ids matching the BM25 index', async () => {
    const idx = emptyIndex();
    addDoc(idx, { id: 'b', source: 'vault', title: 'Bravo', text: 'bravo deployment note' });
    addDoc(idx, { id: 'a', source: 'memory', title: '', text: 'automation preference' });

    const vi = await vectorizeIndex(idx, 'fake:model', async (texts) =>
      texts.map((t) => (t.includes('automation') ? [1, 0] : [0, 1])),
    );

    expect(vi.tag).toBe('fake:model');
    expect(vi.ids).toEqual(['a', 'b']); // deterministic by id, not Map insertion order
    expect(cosineTopK(vi, [1, 0])[0]?.id).toBe('a');
  });

  it('rejects embedding providers that return the wrong number of rows', async () => {
    const idx = emptyIndex();
    addDoc(idx, { id: 'a', source: 'vault', title: '', text: 'one doc' });
    await expect(vectorizeIndex(idx, 'fake:model', async () => [])).rejects.toThrow(/embedding count mismatch/);
  });
});

describe('reindex — semantic sidecar invalidation', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-reindex-home-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('SANOOK_EMBEDDING_MODEL', 'missing-provider');
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(home, { recursive: true, force: true });
  });

  it('clears stale saved vectors when no embedding provider resolves', async () => {
    const Embed = await import('./embed-store.js');
    await Embed.saveVectors(Embed.buildVectorIndex('old:model', [{ id: 'stale-doc', vec: [1, 0] }]));
    expect((await Embed.loadVectors()).ids).toEqual(['stale-doc']);

    const { reindex } = await import('./indexer.js');
    const report = await reindex(1234);

    const cleared = await Embed.loadVectors();
    expect(report.vectors).toBe(0);
    expect(cleared.tag).toBe('');
    expect(cleared.dim).toBe(0);
    expect(cleared.ids).toEqual([]);
  });
});
