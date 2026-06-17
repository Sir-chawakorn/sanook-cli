import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('prompt history persistence', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sanook-history-home-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  });

  function writeHistory(text: string): void {
    mkdirSync(join(home, '.sanook'), { recursive: true });
    writeFileSync(join(home, '.sanook', 'history'), text, { mode: 0o600 });
  }

  function historyPath(): string {
    return join(home, '.sanook', 'history');
  }

  it('loads only the newest prompt history entries', async () => {
    writeHistory(`${Array.from({ length: 505 }, (_, i) => `prompt ${i}`).join('\n')}\n\n`);
    const { loadHistory } = await import('./history.js');

    const history = loadHistory();

    expect(history).toHaveLength(500);
    expect(history[0]).toBe('prompt 5');
    expect(history.at(-1)).toBe('prompt 504');
  });

  it('ignores blank-looking prompt history entries', async () => {
    writeHistory('first prompt\n   \n\t\nsecond prompt\n');
    const { loadHistory } = await import('./history.js');

    expect(loadHistory()).toEqual(['first prompt', 'second prompt']);
  });

  it('does not load prompt history when persistence is disabled', async () => {
    writeHistory('private prompt\n');
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
    vi.resetModules();
    const { loadHistory } = await import('./history.js');

    expect(loadHistory()).toEqual([]);
  });

  it('appends normal prompts while skipping empty, duplicate, and slash-command entries', async () => {
    const { appendHistory } = await import('./history.js');

    appendHistory('  first prompt  ');
    appendHistory('');
    appendHistory('/help');
    appendHistory('first prompt', 'first prompt');
    appendHistory('second\nprompt');

    expect(readFileSync(historyPath(), 'utf8')).toBe('first prompt\nsecond prompt\n');
  });

  it('normalizes all pasted newline variants before persisting prompts', async () => {
    const { appendHistory } = await import('./history.js');

    appendHistory('first\r\nsecond\rthird\nfourth');

    expect(readFileSync(historyPath(), 'utf8')).toBe('first second third fourth\n');
  });

  it('normalizes the in-memory last prompt before duplicate checks', async () => {
    const { appendHistory } = await import('./history.js');

    appendHistory('first\nprompt', 'first\nprompt');

    expect(existsSync(historyPath())).toBe(false);
  });

  it('does not duplicate the last persisted prompt after a skipped slash command', async () => {
    const { appendHistory } = await import('./history.js');

    appendHistory('first prompt');
    appendHistory('/help', 'first prompt');
    appendHistory('first prompt', '/help');

    expect(readFileSync(historyPath(), 'utf8')).toBe('first prompt\n');
  });

  it('compacts prompt history after append and keeps the file private', async () => {
    writeHistory(`${Array.from({ length: 500 }, (_, i) => `prompt ${i}`).join('\n')}\n`);
    const { appendHistory } = await import('./history.js');

    appendHistory('prompt 500', 'prompt 499');

    const lines = readFileSync(historyPath(), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(500);
    expect(lines[0]).toBe('prompt 1');
    expect(lines.at(-1)).toBe('prompt 500');
    expect(statSync(historyPath()).mode & 0o777).toBe(0o600);
  });

  it('does not create prompt history when persistence is disabled', async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
    vi.resetModules();
    const { appendHistory } = await import('./history.js');

    appendHistory('private prompt');

    expect(existsSync(historyPath())).toBe(false);
  });
});
