import stringWidth from 'string-width';
import { describe, it, expect } from 'vitest';
import {
  graphemesOf,
  cursorGraphemeIndex,
  cursorInsertGraphemeIndex,
  formatInputLineDisplay,
  formatMultilineInputDisplay,
  inputCursorCell,
  inputViewport,
  SCROLL_LEAD,
  SCROLL_TAIL,
} from './input-view.js';

function viewportDisplayWidth(vp: ReturnType<typeof inputViewport>): number {
  return (vp.lead ? 1 : 0) + stringWidth(vp.before) + 1 + stringWidth(vp.after) + (vp.tail ? 1 : 0);
}

describe('graphemesOf — Thai grapheme clusters', () => {
  it('keeps base char + combining marks together', () => {
    expect(graphemesOf('ที่นี่')).toEqual(['ที่', 'นี่']);
    expect(graphemesOf('ปิ๊ก')).toEqual(['ปิ๊', 'ก']);
  });

  it('ASCII = one grapheme per char', () => {
    expect(graphemesOf('hello')).toEqual(['h', 'e', 'l', 'l', 'o']);
  });

  it('empty string → no graphemes', () => {
    expect(graphemesOf('')).toEqual([]);
  });
});

describe('cursorInsertGraphemeIndex — gap cursor position', () => {
  it('maps boundaries to insert positions', () => {
    expect(cursorInsertGraphemeIndex('ที่นี่', 0)).toBe(0);
    expect(cursorInsertGraphemeIndex('ที่นี่', 3)).toBe(1);
    expect(cursorInsertGraphemeIndex('ที่นี่', 6)).toBe(2);
  });

  it('cursorGraphemeIndex stays compatible for legacy callers', () => {
    expect(cursorGraphemeIndex('ที่นี่', 3)).toBe(1);
  });
});

describe('inputViewport — Thai-safe single-line render (gap cursor)', () => {
  it('cursor between clusters is an inverse space, not overlaid on a letter', () => {
    const vp = inputViewport('ที่นี่', 3, 80);
    expect(vp.before).toBe('ที่');
    expect(vp.at).toBe(' ');
    expect(vp.after).toBe('นี่');
    expect(vp.lead).toBe(false);
    expect(vp.tail).toBe(false);
  });

  it('Thai greeting at end-of-line — cursor after text, not on last letter', () => {
    const value = 'สวัสดี';
    const vp = inputViewport(value, value.length, 80);
    expect(vp.before).toBe(value);
    expect(vp.at).toBe(' ');
    expect(vp.after).toBe('');
  });

  it('cursor at end of line sits on a trailing space cell', () => {
    const vp = inputViewport('hello', 5, 80);
    expect(vp.before).toBe('hello');
    expect(vp.at).toBe(' ');
    expect(vp.after).toBe('');
  });

  it('short line fits without truncation markers', () => {
    const vp = inputViewport('hi', 1, 80);
    expect(vp.lead).toBe(false);
    expect(vp.tail).toBe(false);
    expect(vp.at).toBe(' ');
    expect(vp.before).toBe('h');
    expect(vp.after).toBe('i');
  });

  it('long line scrolls: cursor at end keeps tail visible with a ‹ lead marker', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz';
    const vp = inputViewport(value, value.length, 10);
    expect(vp.lead).toBe(true);
    expect(vp.tail).toBe(false);
    expect(vp.at).toBe(' ');
    expect(value.endsWith(vp.before)).toBe(true);
  });

  it('long line scrolls: cursor at start keeps head visible with a › tail marker', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz';
    const vp = inputViewport(value, 0, 10);
    expect(vp.lead).toBe(false);
    expect(vp.tail).toBe(true);
    expect(vp.at).toBe(' ');
    expect(vp.before).toBe('');
    expect(value.startsWith(vp.after)).toBe(true);
  });

  it('cursor in the middle of a long line shows both markers', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz';
    const vp = inputViewport(value, 13, 10);
    expect(vp.lead).toBe(true);
    expect(vp.tail).toBe(true);
    expect(vp.at).toBe(' ');
  });

  it('markers exist as exported constants', () => {
    expect(SCROLL_LEAD).toBe('‹');
    expect(SCROLL_TAIL).toBe('›');
  });

  it('empty value → cursor on a single space, no markers', () => {
    const vp = inputViewport('', 0, 80);
    expect(vp.before).toBe('');
    expect(vp.at).toBe(' ');
    expect(vp.after).toBe('');
    expect(vp.lead).toBe(false);
    expect(vp.tail).toBe(false);
  });

  it('renders cursor in one ANSI string (no split Ink nodes over Thai text)', () => {
    const vp = inputViewport('สวัสดี', 3, 80);
    const line = formatInputLineDisplay(vp);
    expect(line).toContain('สวั');
    expect(line).toContain('สดี');
    expect(line).toContain(inputCursorCell());
    expect(line.indexOf(inputCursorCell())).toBeGreaterThan(line.indexOf('สวั'));
    expect(line.indexOf('สดี')).toBeGreaterThan(line.indexOf(inputCursorCell()));
  });

  it('visible slice never exceeds allotted width (prevents 1↔2 row input bounce)', () => {
    const samples = ['สวัสดีครับ', 'abcdefghijklmnopqrstuvwxyz', 'ที่นี่', 'ช่วยได้มั้ยว่าฉันชื่ออะไร'];
    for (const value of samples) {
      const cursors = value.length ? [0, Math.min(3, value.length), value.length] : [0];
      for (const cursor of cursors) {
        for (const width of [8, 12, 24, 80]) {
          const vp = inputViewport(value, cursor, width);
          expect(viewportDisplayWidth(vp)).toBeLessThanOrEqual(width);
        }
      }
    }
  });
});

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('cursor on a Thai leading vowel (เ แ โ ใ ไ) — block, not a gap that hides it', () => {
  it('cursor before ไหม keeps ไ visible with no inserted gap (reported "ได้█หม" bug)', () => {
    const vp = { lead: false, before: 'ได้', at: ' ', after: 'ไหม', tail: false };
    const out = stripAnsi(formatInputLineDisplay(vp));
    expect(out).toContain('ได้ไหม'); // ไ present, sits right after ได้ (cursor blocks ON the vowel)
    expect(out).not.toContain('ได้ ไหม'); // old gap cursor inserted a space here → vowel overrun
  });

  it('non-leading-vowel cursor still uses the gap cursor (unchanged for combining marks)', () => {
    const vp = { lead: false, before: 'ที่', at: ' ', after: 'นี่', tail: false };
    const out = stripAnsi(formatInputLineDisplay(vp));
    expect(out).toContain('ที่ นี่'); // น is not a leading vowel → gap space remains
  });

  it('end-of-line cursor is a trailing gap space (no leading vowel to block)', () => {
    const vp = { lead: false, before: 'สวัสดี', at: ' ', after: '', tail: false };
    const out = stripAnsi(formatInputLineDisplay(vp));
    expect(out).toBe('สวัสดี '); // trailing space cursor, unchanged
  });

  it('multiline: cursor on a leading vowel highlights it (no leading gap space)', () => {
    const out = stripAnsi(formatMultilineInputDisplay('ไหม', 0));
    expect(out.startsWith('ไ')).toBe(true);
    expect(out.startsWith(' ')).toBe(false);
  });
});
