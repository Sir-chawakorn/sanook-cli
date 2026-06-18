import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { completionForInput, clampCompletionIndex, completionReplaceValue, slashCompletionItems } from './slash-completion.js';

describe('slash completion', () => {
  let home: string | undefined;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (home) rmSync(home, { force: true, recursive: true });
    home = undefined;
  });

  it('suggests built-in slash commands by prefix', () => {
    expect(slashCompletionItems('/s').map((item) => item.text)).toEqual(['/skills', '/sessions', '/status', '/stop']);
    expect(slashCompletionItems('/m').map((item) => item.text)).toEqual(['/model', '/mcp']);
  });

  it('stays quiet for arguments or normal text', () => {
    expect(slashCompletionItems('/model sonnet')).toEqual([]);
    expect(slashCompletionItems('hello')).toEqual([]);
  });

  it('suggests local paths for trailing path-like tokens', () => {
    const result = completionForInput('@src/hotk', process.cwd());

    expect(result.replaceFrom).toBe(0);
    expect(result.items.map((item) => item.text)).toContain('@src/hotkeys.ts');
  });

  it('replaces only the trailing path token', () => {
    const result = completionForInput('read src/hotk', process.cwd());
    const item = result.items.find((candidate) => candidate.text === 'src/hotkeys.ts');

    expect(result.replaceFrom).toBe('read '.length);
    expect(completionReplaceValue('read src/hotk', item, result.replaceFrom)).toBe('read src/hotkeys.ts');
  });

  it('suggests home-relative paths from bare tilde tokens', () => {
    home = mkdtempSync(join(tmpdir(), 'sanook-completion-home-'));
    mkdirSync(join(home, 'notes'));
    vi.stubEnv('HOME', home);

    expect(completionForInput('~', process.cwd()).items.map((item) => item.text)).toContain('~/notes/');
    expect(completionForInput('open @~', process.cwd()).items.map((item) => item.text)).toContain('@~/notes/');
  });

  it('wraps completion selection index', () => {
    expect(clampCompletionIndex(-1, 4)).toBe(3);
    expect(clampCompletionIndex(4, 4)).toBe(0);
  });

  it('only replaces when the selected item differs from the current input', () => {
    const [item] = slashCompletionItems('/hel');
    expect(completionReplaceValue('/hel', item)).toBe('/help');
    expect(completionReplaceValue('/help', item)).toBeNull();
  });
});
