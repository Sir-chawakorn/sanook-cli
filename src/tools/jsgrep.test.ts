import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsGrep } from './search.js';

// the pure-JS grep fallback used cross-platform when ripgrep (rg) isn't installed
describe('jsGrep (ripgrep-less fallback)', () => {
  let dir: string;
  const NUL = String.fromCharCode(0);
  beforeEach(async () => {
    vi.stubEnv('SANOOK_ALLOW_OUTSIDE_WORKSPACE', '1');
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
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('finds matches with file:line:text across nested dirs', async () => {
    const out = await jsGrep('needleHere', dir, '.');
    expect(out).toContain('a.ts:2:');
    expect(out).toContain('src/c.ts:1:'); // relative path, nested
    expect(out).toContain('JS fallback'); // hint to install ripgrep
  });

  it('returns matches in deterministic path order', async () => {
    await writeFile(join(dir, 'z-order.ts'), 'orderedNeedle in z\n');
    await mkdir(join(dir, 'm-order'), { recursive: true });
    await writeFile(join(dir, 'm-order', 'a.ts'), 'orderedNeedle in nested\n');
    await writeFile(join(dir, 'a-order.ts'), 'orderedNeedle in a\n');

    const matches = (await jsGrep('orderedNeedle', dir, '.'))
      .split('\n')
      .filter((line) => line.includes('orderedNeedle'));

    expect(matches).toEqual([
      'a-order.ts:1:orderedNeedle in a',
      'm-order/a.ts:1:orderedNeedle in nested',
      'z-order.ts:1:orderedNeedle in z',
    ]);
  });

  it('reports global truncation when fallback matches exceed the result cap', async () => {
    for (let i = 0; i < 201; i += 1) {
      await writeFile(join(dir, `many-${String(i).padStart(3, '0')}.ts`), 'manyNeedle\n');
    }

    const out = await jsGrep('manyNeedle', dir, '.');
    const matches = out.split('\n').filter((line) => line.includes('manyNeedle'));

    expect(matches).toHaveLength(200);
    expect(out).toContain('... [>200 matches, truncated]');
    expect(out).toContain('JS fallback');
  });

  it('caps matches per file while continuing to later files', async () => {
    const noisyLines = Array.from({ length: 55 }, (_v, i) => `perFileNeedle ${i + 1}`).join('\n');
    await writeFile(join(dir, 'noisy.ts'), `${noisyLines}\n`);
    await writeFile(join(dir, 'after-noisy.ts'), 'perFileNeedle after\n');

    const out = await jsGrep('perFileNeedle', dir, '.');
    const matches = out.split('\n').filter((line) => line.includes('perFileNeedle'));

    expect(matches.filter((line) => line.startsWith('noisy.ts:'))).toHaveLength(50);
    expect(out).not.toContain('noisy.ts:51:perFileNeedle 51');
    expect(out).toContain('after-noisy.ts:1:perFileNeedle after');
    expect(out).not.toContain('truncated');
  });

  it('does not report global truncation when fallback matches exactly the result cap', async () => {
    for (let i = 0; i < 200; i += 1) {
      await writeFile(join(dir, `cap-${String(i).padStart(3, '0')}.ts`), 'capNeedle\n');
    }

    const out = await jsGrep('capNeedle', dir, '.');
    const matches = out.split('\n').filter((line) => line.includes('capNeedle'));

    expect(matches).toHaveLength(200);
    expect(out).not.toContain('truncated');
    expect(out).toContain('JS fallback');
  });

  it('does not count protected fallback matches toward truncation', async () => {
    await writeFile(join(dir, '.env'), 'SECRET=capSafeNeedle\n');
    await writeFile(join(dir, '.env.local'), 'SECRET=capSafeNeedle\n');
    for (let i = 0; i < 200; i += 1) {
      await writeFile(join(dir, `cap-safe-${String(i).padStart(3, '0')}.ts`), 'capSafeNeedle\n');
    }

    const out = await jsGrep('capSafeNeedle', dir, '.');
    const matches = out.split('\n').filter((line) => line.includes('capSafeNeedle'));

    expect(matches).toHaveLength(200);
    expect(out).not.toMatch(/(^|\n)\.env/);
    expect(out).not.toContain('truncated');
    expect(out).toContain('JS fallback');
  });

  it('skips ignored dirs (node_modules) and binary files', async () => {
    const out = await jsGrep('needleHere', dir, '.');
    expect(out).not.toContain('node_modules');
    expect(out).not.toContain('blob.dat'); // null byte → treated as binary, skipped
  });

  it('skips ignored generated dirs regardless of directory casing', async () => {
    await mkdir(join(dir, 'NODE_MODULES'), { recursive: true });
    await writeFile(join(dir, 'NODE_MODULES', 'upper.ts'), 'needleHere should be ignored\n');
    await mkdir(join(dir, 'DIST'), { recursive: true });
    await writeFile(join(dir, 'DIST', 'bundle.ts'), 'needleHere should be ignored\n');

    const out = await jsGrep('needleHere', dir, '.');

    expect(out).not.toContain('NODE_MODULES');
    expect(out).not.toContain('DIST');
    expect(out).toContain('a.ts:2:');
  });

  it('skips OS metadata files during broad fallback searches', async () => {
    await writeFile(join(dir, '.DS_Store'), 'needleHere should be ignored\n');
    await writeFile(join(dir, '.localized'), 'needleHere should be ignored\n');
    await writeFile(join(dir, '._a.ts'), 'needleHere should be ignored\n');
    await writeFile(join(dir, 'Desktop.ini'), 'needleHere should be ignored\n');
    await writeFile(join(dir, 'Thumbs.db'), 'needleHere should be ignored\n');
    await writeFile(join(dir, 'thumbs.db'), 'needleHere should be ignored\n');
    await writeFile(join(dir, 'THUMBS.DB'), 'needleHere should be ignored\n');

    const out = await jsGrep('needleHere', dir, '.');

    expect(out).not.toContain('.DS_Store');
    expect(out).not.toContain('.localized');
    expect(out).not.toContain('._a.ts');
    expect(out).not.toContain('Desktop.ini');
    expect(out).not.toContain('Thumbs.db');
    expect(out).not.toContain('thumbs.db');
    expect(out).not.toContain('THUMBS.DB');
    expect(out).toContain('a.ts:2:');
  });

  it('does not follow symlinked directories during broad fallback searches', async () => {
    const linkedTarget = await mkdtemp(join(tmpdir(), 'jsgrep-linked-'));
    try {
      await writeFile(join(linkedTarget, 'outside.ts'), 'linkedNeedle should not be searched\n');
      try {
        await symlink(linkedTarget, join(dir, 'linked-dir'));
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') return;
        throw err;
      }

      expect(await jsGrep('linkedNeedle', dir, '.')).toBe('(no matches)');
    } finally {
      await rm(linkedTarget, { recursive: true, force: true });
    }
  });

  it('skips protected env files during broad fallback searches', async () => {
    await writeFile(join(dir, '.env'), 'SECRET=needleHere\n');
    await writeFile(join(dir, '.env.local'), 'SECRET=needleHere\n');
    await writeFile(join(dir, '.env.example'), 'SAFE=needleHere\n');

    const out = await jsGrep('needleHere', dir, '.');
    expect(out).toContain('.env.example:1:');
    expect(out).not.toMatch(/(^|\n)\.env:/);
    expect(out).not.toContain('.env.local');
  });

  it('blocks an unreadable root before scanning fallback entries', async () => {
    vi.unstubAllEnvs();

    const out = await jsGrep('needleHere', dir, '.');
    expect(out).toMatch(/^BLOCKED:/);
    expect(out).toContain('นอก workspace');
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

  it('supports ripgrep-style leading (?i) case-insensitive patterns', async () => {
    const out = await jsGrep('(?i)needlehere', dir, '.');
    expect(out).toContain('a.ts:2:function needleHere() {}');
    expect(out).toContain('src/c.ts:1:deep needleHere again');
  });

  it('supports scoped (?i:...) groups after a leading (?i) flag', async () => {
    const out = await jsGrep('(?i)function (?i:needlehere)', dir, 'a.ts');
    expect(out).toContain('a.ts:2:function needleHere() {}');
  });

  it('supports ripgrep-style scoped (?i:...) case-insensitive patterns', async () => {
    const out = await jsGrep('(?i:needlehere)', dir, '.');
    expect(out).toContain('a.ts:2:function needleHere() {}');
    expect(out).toContain('src/c.ts:1:deep needleHere again');
  });

  it('supports scoped (?i:...) groups inside larger case-sensitive patterns', async () => {
    await writeFile(join(dir, 'scoped.ts'), 'prefix needleHere suffix\nPREFIX needleHere suffix\n');

    const out = await jsGrep('prefix (?i:needlehere) suffix', dir, 'scoped.ts');
    expect(out).toContain('scoped.ts:1:prefix needleHere suffix');
    expect(out).not.toContain('scoped.ts:2:PREFIX needleHere suffix');
  });

  it('folds ASCII ranges inside scoped case-insensitive character classes', async () => {
    await writeFile(join(dir, 'class-range.ts'), 'word A\nword m\nword _\n');

    const out = await jsGrep('word (?i:[a-z])', dir, 'class-range.ts');
    expect(out).toContain('class-range.ts:1:word A');
    expect(out).toContain('class-range.ts:2:word m');
    expect(out).not.toContain('class-range.ts:3:word _');
  });

  it('supports leading literal right brackets inside scoped character classes', async () => {
    await writeFile(join(dir, 'class-literal-bracket.ts'), ') Marker\n] marker\nx marker\n');

    const out = await jsGrep('(?i:[])] marker)', dir, 'class-literal-bracket.ts');
    expect(out).toContain('class-literal-bracket.ts:1:) Marker');
    expect(out).toContain('class-literal-bracket.ts:2:] marker');
    expect(out).not.toContain('class-literal-bracket.ts:3:x marker');
  });

  it('does not rewrite (?i:...) text inside character classes', async () => {
    await writeFile(join(dir, 'charclass.ts'), '? marker\nx marker\nX marker\n');

    const out = await jsGrep('[(?i:x)] marker', dir, 'charclass.ts');
    expect(out).toContain('charclass.ts:1:? marker');
    expect(out).toContain('charclass.ts:2:x marker');
    expect(out).not.toContain('charclass.ts:3:X marker');
  });
});
