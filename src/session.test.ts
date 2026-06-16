import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
});
