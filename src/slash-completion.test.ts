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
    expect(slashCompletionItems('/s').map((item) => item.text)).toEqual([
      '/setup',
      '/skills',
      '/sessions',
      '/status',
      '/stop',
    ]);
    expect(slashCompletionItems('/m').map((item) => item.text)).toEqual(['/model', '/mcp']);
    expect(slashCompletionItems('/d').map((item) => item.text)).toEqual(['/details', '/dashboard', '/diff']);
    expect(slashCompletionItems('/cop').map((item) => item.text)).toEqual(['/copy']);
    expect(slashCompletionItems('/tr').map((item) => item.text)).toEqual(['/trail']);
  });

  it('stays quiet for arguments or normal text', () => {
    expect(slashCompletionItems('/model sonnet')).toEqual([]);
    expect(slashCompletionItems('hello')).toEqual([]);
  });

  it('suggests focused arguments for detail and trail commands', () => {
    const detailsSection = completionForInput('/details t');
    expect(detailsSection.replaceFrom).toBe('/details '.length);
    expect(detailsSection.items.map((item) => item.display)).toEqual(['thinking', 'tools']);
    expect(completionReplaceValue('/details t', detailsSection.items[0], detailsSection.replaceFrom)).toBe('/details thinking ');

    const detailsMode = completionForInput('/details thinking e');
    expect(detailsMode.replaceFrom).toBe('/details thinking '.length);
    expect(detailsMode.items.map((item) => item.text)).toEqual(['expanded']);
    expect(completionReplaceValue('/details thinking e', detailsMode.items[0], detailsMode.replaceFrom)).toBe(
      '/details thinking expanded',
    );

    const trailMode = completionForInput('/trail c');
    expect(trailMode.replaceFrom).toBe('/trail '.length);
    expect(trailMode.items.map((item) => item.text)).toEqual(['compact']);
    expect(completionReplaceValue('/trail c', trailMode.items[0], trailMode.replaceFrom)).toBe('/trail compact');

    const copyTarget = completionForInput('/copy l');
    expect(copyTarget.replaceFrom).toBe('/copy '.length);
    expect(copyTarget.items.map((item) => item.text)).toEqual(['last']);
    expect(completionReplaceValue('/copy l', copyTarget.items[0], copyTarget.replaceFrom)).toBe('/copy last');
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
