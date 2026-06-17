import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentContext } from '../agentContext.js';
import { writeFileTool } from './write.js';
import { readFileTool } from './read.js';
import { listDirTool } from './list.js';

// proves the isolation primitive: with a threaded cwd (as set for a worktree
// sub-agent), a RELATIVE path resolves into THAT cwd — not process.cwd() — so
// parallel sub-agents in separate worktrees never write into each other's tree.
const dirs: string[] = [];
async function scopedDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'sanook-cwd-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

// run a tool's execute inside a threaded cwd; coerce its (loose) return to string
const runScoped = (cwd: string, fn: () => unknown): Promise<string> =>
  agentContext.run({ model: 'x', depth: 1, cwd }, async () => String(await (fn() as Promise<unknown>)));

describe('agentCwd scoping of file tools', () => {
  it('write_file with a relative path lands inside the threaded cwd, not process.cwd()', async () => {
    const cwd = await scopedDir();
    const res = await runScoped(cwd, () => writeFileTool.execute!({ path: 'src/rel.txt', content: 'isolated' }, {} as never));
    expect(res).toContain('OK');
    expect(await readFile(join(cwd, 'src', 'rel.txt'), 'utf8')).toBe('isolated');
    // must NOT have leaked into the real process cwd
    await expect(stat(join(process.cwd(), 'src', 'rel.txt'))).rejects.toBeTruthy();
  });

  it('read_file resolves the same relative path against the threaded cwd', async () => {
    const cwd = await scopedDir();
    await runScoped(cwd, () => writeFileTool.execute!({ path: 'note.txt', content: 'hello-scope' }, {} as never));
    const out = await runScoped(cwd, () => readFileTool.execute!({ path: 'note.txt' }, {} as never));
    expect(out).toContain('hello-scope');
  });

  it('list_dir on "." lists the threaded cwd', async () => {
    const cwd = await scopedDir();
    await runScoped(cwd, () => writeFileTool.execute!({ path: 'only.txt', content: 'x' }, {} as never));
    const out = await runScoped(cwd, () => listDirTool.execute!({ path: '.' }, {} as never));
    expect(out).toContain('only.txt');
  });

  it('permission guard ALLOWS writes inside the threaded cwd (isolation root), not outside', async () => {
    const cwd = await scopedDir();
    const other = await scopedDir();
    // writing into the scoped cwd is allowed…
    const ok = await runScoped(cwd, () => writeFileTool.execute!({ path: 'a.txt', content: '1' }, {} as never));
    expect(ok).toContain('OK');
    // …but an absolute path into a DIFFERENT dir (not the scoped cwd / brain) is blocked
    const blocked = await runScoped(cwd, () => writeFileTool.execute!({ path: join(other, 'b.txt'), content: '2' }, {} as never));
    expect(blocked).toContain('BLOCKED');
  });

  it('permission guard blocks writes through symlinks that resolve outside the threaded cwd', async () => {
    const cwd = await scopedDir();
    const outside = await scopedDir();
    await symlink(outside, join(cwd, 'outside-link'));

    const blocked = await runScoped(cwd, () =>
      writeFileTool.execute!({ path: 'outside-link/leak.txt', content: 'secret' }, {} as never),
    );

    expect(blocked).toContain('BLOCKED');
    expect(blocked).toContain('นอก workspace');
  });

  it('permission guard blocks writes through symlinks into protected directories even with outside-workspace opt-in', async () => {
    vi.stubEnv('SANOOK_ALLOW_OUTSIDE_WORKSPACE', '1');
    const cwd = await scopedDir();
    const outside = await scopedDir();
    await mkdir(join(outside, '.ssh'), { recursive: true });
    await symlink(join(outside, '.ssh'), join(cwd, 'ssh-link'));

    const blocked = await runScoped(cwd, () => writeFileTool.execute!({ path: 'ssh-link/config', content: 'secret' }, {} as never));
    expect(blocked).toContain('BLOCKED');
    expect(blocked).toContain('path ที่ป้องกัน');
  });
});
