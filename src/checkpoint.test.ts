import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { snapshotWorkTree, restoreWorkTree } from './checkpoint.js';

let dirs: string[] = [];
function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sanook-cp-'));
  dirs.push(dir);
  const git = (...a: string[]): void => void execFileSync('git', a, { cwd: dir });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'v1\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  return dir;
}

describe('checkpoint', () => {
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  it('snapshot บน clean tree → pin HEAD sha จริง (ไม่ใช่ "CLEAN"/lazy HEAD)', async () => {
    const dir = tmpRepo();
    const ref = await snapshotWorkTree(dir);
    expect(ref).toMatch(/^[0-9a-f]{40}$/); // sha จริง ไม่ใช่ sentinel
  });

  it('restore กลับสู่ snapshot แม้ HEAD ขยับ (commit ใหม่) หลัง snapshot', async () => {
    const dir = tmpRepo();
    const ref = await snapshotWorkTree(dir); // pin commit A (a.txt = v1)
    // จำลอง agent commit: แก้ไฟล์ + commit ใหม่ → HEAD ขยับไป B
    writeFileSync(join(dir, 'a.txt'), 'v2\n');
    execFileSync('git', ['commit', '-aqm', 'B'], { cwd: dir });
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('v2\n');

    const r = await restoreWorkTree(ref!, dir);
    expect(r.ok).toBe(true);
    // ต้องคืนเป็น v1 (snapshot A) ไม่ใช่ v2 (HEAD ปัจจุบัน B) — นี่คือ bug ที่แก้
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('v1\n');
  });

  it('restore ลบ tracked file ที่ถูกเพิ่มหลัง snapshot ด้วย', async () => {
    const dir = tmpRepo();
    const ref = await snapshotWorkTree(dir); // commit A มีแค่ a.txt
    writeFileSync(join(dir, 'b.txt'), 'new\n');
    execFileSync('git', ['add', 'b.txt'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'add b'], { cwd: dir });
    expect(existsSync(join(dir, 'b.txt'))).toBe(true);

    const r = await restoreWorkTree(ref!, dir);
    expect(r.ok).toBe(true);
    expect(existsSync(join(dir, 'b.txt'))).toBe(false);
  });

  it('snapshot คืน null เมื่อไม่ใช่ git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sanook-cp-nogit-'));
    dirs.push(dir);
    expect(await snapshotWorkTree(dir)).toBeNull();
  });
});
