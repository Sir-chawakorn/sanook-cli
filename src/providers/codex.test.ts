import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { codexHome, detectCodex, runCodex } from './codex.js';

type MockChild = EventEmitter & {
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function mockSpawnedCodex(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  spawnMock.mockReturnValueOnce(child);
  return child;
}

describe('runCodex', () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.unstubAllEnvs();
  });

  it('flushes the final JSONL event even when stdout has no trailing newline', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-from-sanook-env');
    const child = mockSpawnedCodex();
    const events: unknown[] = [];

    const result = runCodex({ prompt: 'hello', cwd: '/tmp/sanook-worktree', onEvent: (event) => events.push(event) });

    child.stdout.emit('data', Buffer.from('{"type":"thread.started","thread_id":"thread-123"}\n'));
    child.stdout.emit('data', Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"done"}}'));
    child.emit('close', 0);

    await expect(result).resolves.toEqual({ text: 'done', threadId: 'thread-123' });
    expect(events).toEqual([
      { type: 'thread', threadId: 'thread-123' },
      { type: 'text', text: 'done' },
    ]);
    expect(child.stdin.write).toHaveBeenCalledWith('hello');
    expect(child.stdin.end).toHaveBeenCalled();

    const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], { cwd?: string; env: NodeJS.ProcessEnv }];
    expect(command).toBe('codex');
    expect(args).toEqual(['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '-']);
    expect(options.cwd).toBe('/tmp/sanook-worktree');
    expect(options.env.OPENAI_API_KEY).toBeUndefined();
  });

  it('uses the trailing stdout buffer as plain-text fallback output', async () => {
    const child = mockSpawnedCodex();
    const result = runCodex({ prompt: 'fallback please' });

    child.stdout.emit('data', Buffer.from('plain answer without newline'));
    child.emit('close', 0);

    await expect(result).resolves.toEqual({ text: 'plain answer without newline', threadId: undefined });
  });

  it('includes recent stderr output when codex exits unsuccessfully', async () => {
    const child = mockSpawnedCodex();
    const result = runCodex({ prompt: 'fail' });

    child.stderr.emit('data', Buffer.from('auth failed'));
    child.emit('close', 2);

    await expect(result).rejects.toThrow('codex exec จบด้วย exit code 2: auth failed');
  });

  it('caps stderr included in failure messages to recent output', async () => {
    const child = mockSpawnedCodex();
    const result = runCodex({ prompt: 'fail with noisy stderr' });

    child.stderr.emit('data', Buffer.from(`${'x'.repeat(4100)}recent failure`));
    child.emit('close', 1);

    await expect(result).rejects.toThrow(`codex exec จบด้วย exit code 1: ${'x'.repeat(3986)}recent failure`);
  });

  it('kills the child immediately when the signal is already aborted', async () => {
    const child = mockSpawnedCodex();
    const controller = new AbortController();
    controller.abort();

    const result = runCodex({ prompt: 'cancelled', signal: controller.signal });

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).not.toHaveBeenCalled();
    child.emit('close', null);
    await expect(result).rejects.toThrow('codex exec ถูกยกเลิก');
  });

  it('kills the active child when the signal aborts while running', async () => {
    const child = mockSpawnedCodex();
    const controller = new AbortController();

    const result = runCodex({ prompt: 'cancel after start', signal: controller.signal });

    expect(child.stdin.write).toHaveBeenCalledWith('cancel after start');
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.stderr.emit('data', Buffer.from('interrupted'));
    child.emit('close', null);
    await expect(result).rejects.toThrow('codex exec ถูกยกเลิก: interrupted');
  });

  it('removes the abort listener after the child exits', async () => {
    const child = mockSpawnedCodex();
    const controller = new AbortController();

    const result = runCodex({ prompt: 'hello', signal: controller.signal });

    child.stdout.emit('data', Buffer.from('done'));
    child.emit('close', 0);
    await expect(result).resolves.toEqual({ text: 'done', threadId: undefined });

    controller.abort();
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe('detectCodex', () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.unstubAllEnvs();
  });

  it('honors CODEX_HOME when checking ChatGPT login state', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sanook-codex-home-'));
    try {
      await mkdir(home, { recursive: true });
      await writeFile(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }));
      vi.stubEnv('CODEX_HOME', home);
      spawnMock.mockImplementation(() => {
        const child = new EventEmitter() as MockChild & { kill: ReturnType<typeof vi.fn> };
        child.kill = vi.fn();
        child.stderr = new EventEmitter();
        child.stdout = new EventEmitter();
        setImmediate(() => child.emit('close', 0));
        return child;
      });

      await expect(detectCodex()).resolves.toEqual({ installed: true, loggedIn: true, reason: undefined });
      expect(codexHome()).toBe(home);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('reports auth without codex CLI when auth.json exists', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sanook-codex-home-'));
    try {
      await mkdir(home, { recursive: true });
      await writeFile(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'x' } }));
      vi.stubEnv('CODEX_HOME', home);
      spawnMock.mockImplementationOnce(() => {
        const child = new EventEmitter() as MockChild & { kill: ReturnType<typeof vi.fn> };
        child.kill = vi.fn();
        child.stderr = new EventEmitter();
        child.stdout = new EventEmitter();
        setTimeout(() => child.emit('error', new Error('ENOENT')), 0);
        return child;
      });

      await expect(detectCodex()).resolves.toMatchObject({
        installed: false,
        loggedIn: true,
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('reports installed but not logged in when CODEX_HOME has no auth file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sanook-codex-home-'));
    try {
      vi.stubEnv('CODEX_HOME', home);
      spawnMock.mockImplementation(() => {
        const child = new EventEmitter() as MockChild & { kill: ReturnType<typeof vi.fn> };
        child.kill = vi.fn();
        child.stderr = new EventEmitter();
        child.stdout = new EventEmitter();
        setImmediate(() => child.emit('close', 0));
        return child;
      });

      await expect(detectCodex()).resolves.toMatchObject({ installed: true, loggedIn: false });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
