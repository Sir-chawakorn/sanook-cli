import { describe, expect, it } from 'vitest';
import {
  applyPasteInput,
  clampCursorToGrapheme,
  expandPasteSnippets,
  graphemeBoundaries,
  isPasteLikeInput,
  nextGraphemeCursor,
  normalizePastedInput,
  pasteTokenLabel,
  previousGraphemeCursor,
} from './useEditor.js';

describe('useEditor grapheme cursor helpers', () => {
  it('moves across emoji and combining marks as whole grapheme clusters', () => {
    const text = 'A👨‍💻e\u0302B';
    const boundaries = graphemeBoundaries(text);

    expect(boundaries).toEqual([0, 1, 6, 8, 9]);
    expect(nextGraphemeCursor(text, 1)).toBe(6);
    expect(previousGraphemeCursor(text, 8)).toBe(6);
    expect(previousGraphemeCursor(text, 6)).toBe(1);
  });

  it('clamps arbitrary code-unit offsets back to safe boundaries', () => {
    const text = 'ก้🙂x';

    expect(clampCursorToGrapheme(text, 1)).toBe(0);
    expect(clampCursorToGrapheme(text, 3)).toBe(2);
    expect(nextGraphemeCursor(text, 2)).toBe(4);
    expect(previousGraphemeCursor(text, 4)).toBe(2);
  });
});

describe('useEditor paste helpers', () => {
  it('normalizes bracketed paste markers and newline variants', () => {
    const pasted = '\x1b[200~a\r\nb\rc\n\x1b[201~';

    expect(isPasteLikeInput(pasted)).toBe(true);
    expect(normalizePastedInput(pasted)).toBe('a\nb\nc');
  });

  it('keeps short multiline paste inline', () => {
    const result = applyPasteInput('ask ', 4, 'one\ntwo\n', []);

    expect(result.value).toBe('ask one\ntwo');
    expect(result.cursor).toBe('ask one\ntwo'.length);
    expect(result.pasteSnips).toEqual([]);
  });

  it('collapses long paste into a readable token and expands it before submit', () => {
    const text = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n');
    const result = applyPasteInput('summarize ', 'summarize '.length, text, []);

    expect(result.value).toContain('[[ paste 5 lines');
    expect(result.value).toContain('alpha beta');
    expect(result.value).not.toContain('\nepsilon');
    expect(result.pasteSnips).toEqual([{ label: result.value.slice('summarize '.length), text }]);
    expect(expandPasteSnippets(result.value, result.pasteSnips)).toBe(`summarize ${text}`);
  });

  it('expands duplicate paste labels in insertion order', () => {
    const label = pasteTokenLabel('same preview\nx\ny\nz\nq', 5);
    const value = `${label} and ${label}`;

    expect(
      expandPasteSnippets(value, [
        { label, text: 'first\nbody' },
        { label, text: 'second\nbody' },
      ]),
    ).toBe('first\nbody and second\nbody');
  });
});
