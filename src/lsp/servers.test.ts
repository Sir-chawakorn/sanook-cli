import { describe, it, expect } from 'vitest';
import { serverDefForFile, findBinary, resolveServer } from './servers.js';

describe('serverDefForFile', () => {
  it('maps TS/JS extensions to the typescript server with the right languageId', () => {
    expect(serverDefForFile('src/a.ts')).toMatchObject({ def: { id: 'typescript' }, languageId: 'typescript' });
    expect(serverDefForFile('src/a.tsx')?.languageId).toBe('typescriptreact');
    expect(serverDefForFile('x.jsx')?.languageId).toBe('javascriptreact');
  });
  it('maps other ecosystems', () => {
    expect(serverDefForFile('m.py')?.def.id).toBe('python');
    expect(serverDefForFile('m.go')?.def.id).toBe('go');
    expect(serverDefForFile('m.rs')?.def.id).toBe('rust');
  });
  it('returns null for an unsupported extension', () => {
    expect(serverDefForFile('readme.md')).toBeNull();
    expect(serverDefForFile('noext')).toBeNull();
  });
});

describe('findBinary', () => {
  it('finds a binary that exists on PATH (node)', async () => {
    const p = await findBinary('node');
    expect(p).toBeTruthy();
    expect(p).toContain('node');
  });
  it('finds a project-local binary in node_modules/.bin (tsc)', async () => {
    const p = await findBinary('tsc'); // present as a devDependency bin
    expect(p).toContain('node_modules/.bin/tsc');
  });
  it('returns null for a binary that does not exist', async () => {
    expect(await findBinary('definitely-not-a-real-binary-xyz123')).toBeNull();
  });
});

describe('resolveServer', () => {
  it('reports an unsupported extension cleanly', async () => {
    const r = await resolveServer('notes.md');
    expect(r).toHaveProperty('unavailable');
    expect((r as { unavailable: string }).unavailable).toContain('นามสกุล');
  });
  it('reports a missing-but-configured server with an install hint', async () => {
    // typescript-language-server is (almost certainly) not installed in CI → graceful message
    const r = await resolveServer('src/a.ts');
    if ('unavailable' in r) {
      expect(r.unavailable).toContain('typescript-language-server');
      expect(r.unavailable).toContain('ติดตั้ง');
    } else {
      // if it IS installed, we get a real resolution with a binary path
      expect(r.binPath).toBeTruthy();
      expect(r.languageId).toBe('typescript');
    }
  });
});
