import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('./bin.ts', import.meta.url));

async function runCli(args: string[], home: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', bin, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CI: '1',
      HOME: home,
      SANOOK_DISABLE_UPDATE_CHECK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out: ${args.join(' ')}`));
    }, 12_000);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode);
    });
  });

  return { code, stdout, stderr };
}

describe('session store management', () => {
  let home: string;
  let realHome: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    realHome = process.env.HOME;
    home = await mkdtemp(join(tmpdir(), 'sanook-session-'));
    process.env.HOME = home;
  });

  afterEach(async () => {
    vi.resetModules();
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    await rm(home, { recursive: true, force: true });
  });

  it('lists, filters, limits, finds latest, and removes sessions', async () => {
    const {
      latestSession,
      listSessions,
      pruneSessions,
      removeSession,
      renameSession,
      sanitizeSessionForExport,
      saveSession,
      sessionStorePath,
    } = await import('./session.js');
    const project = join(home, 'project');
    const other = join(home, 'other');

    await saveSession({
      id: 'old-project',
      created: '2026-06-14T00:00:00.000Z',
      updated: '2026-06-14T00:00:01.000Z',
      model: 'sonnet',
      cwd: project,
      messages: [{ role: 'user', content: 'old' }],
    });
    await saveSession({
      id: 'new-project',
      created: '2026-06-14T00:00:00.000Z',
      updated: '2026-06-14T00:00:03.000Z',
      model: 'openai:gpt-5.3-codex',
      cwd: project,
      messages: [{ role: 'user', content: 'new' }],
    });
    await saveSession({
      id: 'other-project',
      created: '2026-06-14T00:00:00.000Z',
      updated: '2026-06-14T00:00:02.000Z',
      model: 'gemini',
      cwd: other,
      messages: [{ role: 'user', content: 'other' }],
    });

    expect(sessionStorePath()).toBe(join(home, '.sanook', 'sessions'));
    expect((await listSessions({ cwd: project })).map((s) => s.id)).toEqual(['new-project', 'old-project']);
    expect((await listSessions({ cwd: null, limit: 2 })).map((s) => s.id)).toEqual(['new-project', 'other-project']);
    expect((await latestSession(project))?.id).toBe('new-project');

    await expect(removeSession('../bad')).rejects.toThrow(/session id/);
    expect(await removeSession('old-project')).toBe(true);
    expect(await removeSession('old-project')).toBe(false);
    expect((await listSessions({ cwd: project })).map((s) => s.id)).toEqual(['new-project']);

    const renamed = await renameSession('new-project', 'Launch sk-test1234567890abcdef');
    expect(renamed?.title).toBe('Launch sk-test1234567890abcdef');
    expect((await latestSession(project))?.title).toBe('Launch sk-t…ef');

    const safe = sanitizeSessionForExport({
      id: 'secret-session',
      title: 'Title sk-test1234567890abcdef',
      created: '2026-06-14T00:00:00.000Z',
      updated: '2026-06-14T00:00:00.000Z',
      model: 'sonnet',
      cwd: project,
      messages: [{ role: 'user', content: 'key sk-test1234567890abcdef' }],
    });
    expect(JSON.stringify(safe)).toContain('sk-t…ef');
    expect(JSON.stringify(safe)).not.toContain('sk-test1234567890abcdef');

    const pruned = await pruneSessions({ cwd: null, keep: 1 });
    expect(pruned.map((s) => s.id)).toEqual(['other-project']);
    expect((await listSessions({ cwd: null })).map((s) => s.id)).toEqual(['new-project']);
  });

  it('skips malformed session files when listing sessions for a cwd', async () => {
    const { listSessions, loadSession, saveSession, sessionStorePath } = await import('./session.js');
    const project = join(home, 'project');

    await saveSession({
      id: 'valid-project',
      created: '2026-06-14T00:00:00.000Z',
      updated: '2026-06-14T00:00:01.000Z',
      model: 'sonnet',
      cwd: project,
      messages: [{ role: 'user', content: 'valid' }],
    });
    await writeFile(
      join(sessionStorePath(), 'malformed.json'),
      JSON.stringify({
        id: 'malformed',
        updated: '2026-06-14T00:00:02.000Z',
        messages: [],
      }),
    );
    await writeFile(
      join(sessionStorePath(), 'mismatched.json'),
      JSON.stringify({
        id: 'other-id',
        created: '2026-06-14T00:00:00.000Z',
        updated: '2026-06-14T00:00:02.000Z',
        model: 'sonnet',
        cwd: project,
        messages: [{ role: 'user', content: 'wrong file' }],
      }),
    );
    await writeFile(
      join(sessionStorePath(), 'bad-messages.json'),
      JSON.stringify({
        id: 'bad-messages',
        created: '2026-06-14T00:00:00.000Z',
        updated: '2026-06-14T00:00:03.000Z',
        model: 'sonnet',
        cwd: project,
        messages: ['not a model message'],
      }),
    );
    await writeFile(
      join(sessionStorePath(), 'bad-content.json'),
      JSON.stringify({
        id: 'bad-content',
        created: '2026-06-14T00:00:00.000Z',
        updated: '2026-06-14T00:00:04.000Z',
        model: 'sonnet',
        cwd: project,
        messages: [{ role: 'user', content: null }],
      }),
    );
    await writeFile(
      join(sessionStorePath(), 'bad-tool-content.json'),
      JSON.stringify({
        id: 'bad-tool-content',
        created: '2026-06-14T00:00:00.000Z',
        updated: '2026-06-14T00:00:05.000Z',
        model: 'sonnet',
        cwd: project,
        messages: [{ role: 'tool', content: 'not tool parts' }],
      }),
    );

    expect((await loadSession('valid-project'))?.id).toBe('valid-project');
    expect(await loadSession('mismatched')).toBeNull();
    expect(await loadSession('bad-messages')).toBeNull();
    expect(await loadSession('bad-content')).toBeNull();
    expect(await loadSession('bad-tool-content')).toBeNull();
    expect((await listSessions({ cwd: project })).map((s) => s.id)).toEqual(['valid-project']);
  });

  it('rejects missing or empty CLI session limits', async () => {
    await expect(runCli(['sessions', 'list', '--limit', '--all'], home)).resolves.toMatchObject({
      code: 2,
      stdout: '',
      stderr: expect.stringContaining('--limit ต้องเป็น integer บวก'),
    });
    await expect(runCli(['sessions', 'list', '--limit='], home)).resolves.toMatchObject({
      code: 2,
      stdout: '',
      stderr: expect.stringContaining('--limit ต้องเป็น integer บวก'),
    });
  });
});
