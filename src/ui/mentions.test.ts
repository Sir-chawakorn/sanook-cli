import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentContext } from '../agentContext.js';
import { expandMentions } from './mentions.js';

const dirs: string[] = [];

async function tempCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sanook-mentions-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('expandMentions', () => {
  it('falls back to process cwd when no threaded agent cwd is active', async () => {
    const originalCwd = process.cwd();
    const cwd = await tempCwd();
    await writeFile(join(cwd, 'local-note.txt'), 'process cwd note\n', 'utf8');

    try {
      process.chdir(cwd);
      const result = await expandMentions('read @local-note.txt');

      expect(result.errors).toEqual([]);
      expect(result.images).toEqual([]);
      expect(result.text).toContain('read @local-note.txt');
      expect(result.text).toContain('<file path="local-note.txt">\nprocess cwd note\n\n</file>');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('resolves relative text mentions against the threaded agent cwd', async () => {
    const cwd = await tempCwd();
    await writeFile(join(cwd, 'note.txt'), 'scoped note\n', 'utf8');

    const result = await agentContext.run({ model: 'x', depth: 1, cwd }, () => expandMentions('read @note.txt'));

    expect(result.errors).toEqual([]);
    expect(result.images).toEqual([]);
    expect(result.text).toContain('read @note.txt');
    expect(result.text).toContain('<file path="note.txt">\nscoped note\n\n</file>');
  });

  it('resolves relative image mentions against the threaded agent cwd', async () => {
    const cwd = await tempCwd();
    const imagePath = join(cwd, 'diagram.png');
    await writeFile(imagePath, 'fake image bytes', 'utf8');
    const canonicalImagePath = await realpath(imagePath);

    const result = await agentContext.run({ model: 'x', depth: 1, cwd }, () => expandMentions('inspect @diagram.png'));

    expect(result.errors).toEqual([]);
    expect(result.images).toEqual([canonicalImagePath]);
    expect(result.text).toBe('inspect @diagram.png');
  });

  it('preserves absolute text mentions inside a threaded agent cwd', async () => {
    const cwd = await tempCwd();
    const notePath = join(cwd, 'absolute-note.txt');
    await writeFile(notePath, 'absolute note\n', 'utf8');

    const result = await agentContext.run({ model: 'x', depth: 1, cwd }, () => expandMentions(`read @${notePath}`));

    expect(result.errors).toEqual([]);
    expect(result.images).toEqual([]);
    expect(result.text).toContain(`<file path="${notePath}">\nabsolute note\n\n</file>`);
  });

  it('blocks relative text mentions that resolve outside the threaded agent cwd', async () => {
    const cwd = await tempCwd();
    const outside = await tempCwd();
    await writeFile(join(outside, 'secret.txt'), 'secret\n', 'utf8');
    await symlink(join(outside, 'secret.txt'), join(cwd, 'escape.txt'));

    const result = await agentContext.run({ model: 'x', depth: 1, cwd }, () => expandMentions('read @escape.txt'));

    expect(result.images).toEqual([]);
    expect(result.text).toBe('read @escape.txt');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('@escape.txt');
    expect(result.errors[0]).toContain('นอก workspace');
  });
});
