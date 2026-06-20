import { describe, it, expect } from 'vitest';
import { graphemesOf, cursorGraphemeIndex, inputViewport, SCROLL_LEAD, SCROLL_TAIL } from './input-view.js';

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

describe('cursorGraphemeIndex — code-unit cursor → grapheme index', () => {
  it('maps a mid-string code-unit cursor to its cluster index', () => {
    // 'ที่นี่' = ['ที่'(3 code units), 'นี่'(3)]; cursor=3 is the start of the 2nd cluster
    expect(cursorGraphemeIndex('ที่นี่', 3)).toBe(1);
    expect(cursorGraphemeIndex('ที่นี่', 0)).toBe(0);
    expect(cursorGraphemeIndex('ที่นี่', 6)).toBe(2); // end → past last cluster
  });
});

describe('inputViewport — Thai-safe single-line render', () => {
  it('cursor in the middle highlights a WHOLE cluster (not a split mark)', () => {
    // regression: old code sliced 1 code unit → at='น', after='ี่' (orphaned marks)
    const vp = inputViewport('ที่นี่', 3, 80);
    expect(vp.before).toBe('ที่');
    expect(vp.at).toBe('นี่'); // full cluster, marks attached
    expect(vp.after).toBe('');
    expect(vp.lead).toBe(false);
    expect(vp.tail).toBe(false);
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
    expect(vp.at).toBe('i'); // cursor=1 → on 'i'
    expect(vp.before).toBe('h');
  });

  it('long line scrolls: cursor at end keeps tail visible with a ‹ lead marker', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz'; // 26 cells
    const vp = inputViewport(value, value.length, 10);
    expect(vp.lead).toBe(true); // content scrolled off left
    expect(vp.tail).toBe(false); // we are at the end
    // visible window (before+at) must fit in width incl. the lead marker
    expect((vp.before + vp.at).length).toBeLessThanOrEqual(10);
    expect(value.endsWith(vp.before)).toBe(true); // shows the tail of the string
  });

  it('long line scrolls: cursor at start keeps head visible with a › tail marker', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz';
    const vp = inputViewport(value, 0, 10);
    expect(vp.lead).toBe(false);
    expect(vp.tail).toBe(true);
    expect(vp.at).toBe('a');
  });

  it('cursor in the middle of a long line shows both markers', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz';
    const vp = inputViewport(value, 13, 10);
    expect(vp.lead).toBe(true);
    expect(vp.tail).toBe(true);
    expect(vp.at).toBe('n'); // index 13
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
});
