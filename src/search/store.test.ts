import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let S: typeof import('./store.js');
let I: typeof import('./index-core.js');
let HOME: string;

beforeAll(async () => {
  HOME = mkdtempSync(join(tmpdir(), 'sanook-search-home-'));
  vi.stubEnv('HOME', HOME);
  S = await import('./store.js');
  I = await import('./index-core.js');
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(HOME, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(S.SEARCH_DIR, { recursive: true, force: true });
});

describe('search index store', () => {
  it('save/load round-trips index + manifest with 0600 permissions', async () => {
    const idx = I.addDoc(I.emptyIndex(), {
      id: 'doc1',
      source: 'vault',
      title: 'Deploy',
      text: 'deploy to vercel',
    });
    await S.saveIndex(idx, { 'Deploy.md': { mtimeMs: 1, size: 2, sha: 'abc', ids: ['doc1'] } });

    expect((await stat(S.INDEX_PATH)).mode & 0o777).toBe(0o600);
    const loaded = await S.loadIndex();
    expect(loaded.index.docs.get('doc1')?.title).toBe('Deploy');
    expect(loaded.manifest['Deploy.md']?.sha).toBe('abc');
  });

  it('concurrent saves use isolated temp files and leave no tmp behind', async () => {
    const a = I.addDoc(I.emptyIndex(), { id: 'a', source: 'memory', title: 'A', text: 'alpha' });
    const b = I.addDoc(I.emptyIndex(), { id: 'b', source: 'memory', title: 'B', text: 'beta' });

    await Promise.all([S.saveIndex(a, {}), S.saveIndex(b, {})]);

    expect((await readdir(S.SEARCH_DIR)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect((await S.loadIndex()).index.docs.size).toBe(1);
  });

  it('malformed persisted JSON degrades to empty', async () => {
    await S.saveIndex(I.emptyIndex(), {});
    await import('node:fs/promises').then((fs) => fs.writeFile(S.INDEX_PATH, '{ nope'));
    expect((await S.loadIndex()).index.docs.size).toBe(0);
  });

  it('sanitizes malformed manifest entries without losing a valid index', async () => {
    const idx = I.addDoc(I.emptyIndex(), { id: 'doc1', source: 'vault', title: 'Deploy', text: 'deploy' });
    await S.saveIndex(idx, {});

    const raw = JSON.parse(await readFile(S.INDEX_PATH, 'utf8')) as Record<string, unknown>;
    raw.manifest = {
      'Deploy.md': { mtimeMs: 1, size: 2, sha: 'abc', ids: ['doc1'] },
      'Bad.md': { mtimeMs: 'nope', size: 2, sha: 'abc', ids: ['doc2'] },
      '__proto__': { mtimeMs: 1, size: 2, sha: 'polluted', ids: ['pwn'] },
      constructor: { mtimeMs: 1, size: 2, sha: 'polluted', ids: ['pwn'] },
    };
    await writeFile(S.INDEX_PATH, `${JSON.stringify(raw)}\n`);

    const loaded = await S.loadIndex();
    expect(loaded.index.docs.get('doc1')?.title).toBe('Deploy');
    expect(Object.keys(loaded.manifest)).toEqual(['Deploy.md']);
    expect(loaded.manifest['Deploy.md']?.ids).toEqual(['doc1']);
    expect((loaded.manifest as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(loaded.manifest)).toBeNull();
  });

  it('saveIndex is a no-op when persistence is disabled', async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
    try {
      await S.saveIndex(I.emptyIndex(), {});
      await expect(readFile(S.INDEX_PATH, 'utf8')).rejects.toThrow();
    } finally {
      vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
    }
  });
});
