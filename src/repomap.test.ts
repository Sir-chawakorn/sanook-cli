import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRepoMap, clearRepoMapCache } from './repomap.js';

let dirs: string[] = [];

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
function tmpRepo(): string {
  const dir = tmpDir('sanook-repomap-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('repo map', () => {
  beforeEach(() => {
    dirs = [];
    clearRepoMapCache(); // cache เป็น process-global → เคลียร์ก่อนทุก test
  });

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('ดึง exported symbol จากไฟล์ TS (function/class)', async () => {
    const dir = tmpRepo();
    writeFileSync(join(dir, 'a.ts'), 'export function foo() {}\nexport class Bar {}\nconst x = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    const map = await loadRepoMap(dir);
    expect(map).toContain('a.ts');
    expect(map).toContain('foo');
    expect(map).toContain('Bar');
  });

  it('คืน "" เมื่อไม่ใช่ git repo', async () => {
    expect(await loadRepoMap(tmpDir('sanook-nogit-'))).toBe('');
  });

  it('คืน "" เมื่อ git repo มีแต่ non-source (เช่น vault markdown)', async () => {
    const dir = tmpRepo();
    writeFileSync(join(dir, 'note.md'), '# hello\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    expect(await loadRepoMap(dir)).toBe('');
  });

  it('cap ที่ maxChars (ไม่ระเบิด context)', async () => {
    const dir = tmpRepo();
    for (let i = 0; i < 50; i++) writeFileSync(join(dir, `f${i}.ts`), `export function fn${i}() {}\n`);
    execFileSync('git', ['add', '.'], { cwd: dir });
    const map = await loadRepoMap(dir, 200);
    expect(map.length).toBeLessThan(400); // 200 budget + wrapper tag
    expect(map).toContain('…');
  });
});
