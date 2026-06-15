import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsGrep } from './search.js';

// the pure-JS grep fallback used cross-platform when ripgrep (rg) isn't installed
describe('jsGrep (ripgrep-less fallback)', () => {
  let dir: string;
  const NUL = String.fromCharCode(0);
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jsgrep-'));
    await writeFile(join(dir, 'a.ts'), 'const x = 1;\nfunction needleHere() {}\nconst y = 2;\n');
    await writeFile(join(dir, 'b.ts'), 'no match in here\n');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'c.ts'), 'deep needleHere again\n');
    // ignored dir + binary must be skipped
    await mkdir(join(dir, 'node_modules'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'skip.ts'), 'needleHere should be ignored\n');
    await writeFile(join(dir, 'blob.dat'), `needleHere${NUL}withnull`); // null byte → binary
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds matches with file:line:text across nested dirs', async () => {
    const out = await jsGrep('needleHere', dir, '.');
    expect(out).toContain('a.ts:2:');
    expect(out).toContain('src/c.ts:1:'); // relative path, nested
    expect(out).toContain('JS fallback'); // hint to install ripgrep
  });

  it('skips ignored dirs (node_modules) and binary files', async () => {
    const out = await jsGrep('needleHere', dir, '.');
    expect(out).not.toContain('node_modules');
    expect(out).not.toContain('blob.dat'); // null byte → treated as binary, skipped
  });

  it('no match -> (no matches)', async () => {
    expect(await jsGrep('zzz-not-present', dir, '.')).toBe('(no matches)');
  });

  it('invalid regex -> clear error, no throw', async () => {
    expect(await jsGrep('(unclosed', dir, '.')).toMatch(/regex/);
  });

  it('can target a single file', async () => {
    const out = await jsGrep('needleHere', dir, 'a.ts');
    expect(out).toContain('a.ts:2:');
    expect(out).not.toContain('c.ts');
  });

  it('matches CRLF files correctly (Windows line endings)', async () => {
    await writeFile(join(dir, 'crlf.ts'), 'line one\r\nneedleHere on two\r\nline three\r\n');
    const out = await jsGrep('needleHere', dir, 'crlf.ts');
    expect(out).toContain('crlf.ts:2:needleHere on two');
    expect(out).not.toContain('\r'); // \r stripped by split(/\r?\n/)
  });
});
