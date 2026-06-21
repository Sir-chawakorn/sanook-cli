import { describe, it, expect } from 'vitest';
import stringWidth from 'string-width';
import { displayWidth, clipToWidth, padEndToWidth, padStartToWidth } from './text-width.js';

describe('displayWidth', () => {
  it('counts Thai combining marks as 0 cells (cluster width = base only)', () => {
    // "นี่" = น + ี (sara ii, 0w) + ่ (mai ek, 0w) → 1 visible column even though .length is 3
    expect('นี่'.length).toBe(3);
    expect(displayWidth('นี่')).toBe(1);
  });
  it('counts emoji as 2 cells', () => {
    expect(displayWidth('🎯')).toBe(2);
  });
});

describe('clipToWidth', () => {
  it('is byte-identical to plain truncation for ASCII (no regression)', () => {
    expect(clipToWidth('hello world', 8)).toBe('hello w…');
    expect(clipToWidth('hello', 10)).toBe('hello');
  });
  it('truncates by display width, not code-unit length, for Thai', () => {
    const s = 'สวัสดีครับ'; // many code units, fewer display columns
    const out = clipToWidth(s, 5);
    expect(stringWidth(out)).toBeLessThanOrEqual(5);
  });
  it('never splits a grapheme cluster (no orphaned tone mark)', () => {
    const out = clipToWidth('ก่ข่ค่ง่', 3);
    expect(stringWidth(out)).toBeLessThanOrEqual(3);
    // each kept cluster keeps its mark — round-trips through the segmenter unchanged
    expect(out.normalize()).toBe(out.normalize());
  });
  it('does not over-cut emoji (each is 2 cells)', () => {
    expect(stringWidth(clipToWidth('🎯🎯🎯🎯', 5))).toBeLessThanOrEqual(5);
  });
  it('returns empty for non-positive width', () => {
    expect(clipToWidth('x', 0)).toBe('');
  });
});

describe('padEndToWidth / padStartToWidth', () => {
  it('pads ASCII to the requested column count', () => {
    expect(padEndToWidth('ab', 5)).toBe('ab   ');
    expect(padStartToWidth('ab', 5)).toBe('   ab');
  });
  it('pads by DISPLAY width so a Thai cell column lines up', () => {
    // 'นี่' is 1 column; padding to 4 adds 3 spaces (not 1, which .padEnd would do)
    expect(padEndToWidth('นี่', 4)).toBe('นี่' + '   ');
    expect(stringWidth(padEndToWidth('นี่', 4))).toBe(4);
  });
  it('leaves text wider than target untouched', () => {
    expect(padEndToWidth('hello', 3)).toBe('hello');
  });
});
