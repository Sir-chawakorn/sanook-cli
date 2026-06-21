import stringWidth from 'string-width';
import { describe, it, expect } from 'vitest';
import {
  graphemesOf,
  cursorGraphemeIndex,
  cursorInsertGraphemeIndex,
  formatInputLineDisplay,
  formatMultilineInputDisplay,
  highlightCursor,
  inputViewport,
  SCROLL_LEAD,
  SCROLL_TAIL,
} from './input-view.js';

function viewportDisplayWidth(vp: ReturnType<typeof inputViewport>): number {
  return (vp.lead ? 1 : 0) + stringWidth(vp.before) + stringWidth(vp.at) + stringWidth(vp.after) + (vp.tail ? 1 : 0);
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

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

describe('inputViewport — Thai-safe single-line render (block cursor)', () => {
  it('cursor between clusters sits ON the next cluster (block), not an inserted gap', () => {
    const vp = inputViewport('ที่นี่', 3, 80);
    expect(vp.before).toBe('ที่');
    expect(vp.at).toBe('นี่'); // block on the cluster to the right
    expect(vp.after).toBe('');
    expect(vp.lead).toBe(false);
    expect(vp.tail).toBe(false);
  });

  it('Thai greeting at end-of-line — cursor on a trailing space cell', () => {
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

  it('cursor in mid-line blocks on the character under it', () => {
    const vp = inputViewport('hi', 1, 80);
    expect(vp.lead).toBe(false);
    expect(vp.tail).toBe(false);
    expect(vp.before).toBe('h');
    expect(vp.at).toBe('i'); // on the 'i', not a gap between
    expect(vp.after).toBe('');
  });

  it('long line scrolls: cursor at end keeps tail visible with a ‹ lead marker', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz';
    const vp = inputViewport(value, value.length, 10);
    expect(vp.lead).toBe(true);
    expect(vp.tail).toBe(false);
    expect(vp.at).toBe(' '); // EOL trailing cursor
    expect(value.endsWith(vp.before)).toBe(true);
  });

  it('long line scrolls: cursor at start blocks on the first char with a › tail marker', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz';
    const vp = inputViewport(value, 0, 10);
    expect(vp.lead).toBe(false);
    expect(vp.tail).toBe(true);
    expect(vp.before).toBe('');
    expect(vp.at).toBe('a'); // cursor on first char
    expect(value.startsWith(`a${vp.after}`)).toBe(true);
  });

  it('cursor in the middle of a long line blocks on that char with both markers', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz';
    const vp = inputViewport(value, 13, 10);
    expect(vp.lead).toBe(true);
    expect(vp.tail).toBe(true);
    expect(vp.at).toBe('n'); // value[13]
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
    const vp = inputViewport('สวัสดี', 3, 80); // cursor on the 3rd cluster 'ส'
    expect(vp.before).toBe('สวั');
    expect(vp.at).toBe('ส');
    expect(vp.after).toBe('ดี');
    const line = formatInputLineDisplay(vp);
    expect(stripAnsi(line)).toBe('สวัสดี'); // every glyph painted, order intact
    expect(line).toContain(highlightCursor('ส')); // the cursor block is on 'ส'
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

describe('block cursor never hides / drops / reorders a character (the definitive guarantee)', () => {
  // The whole point of the block cursor: at EVERY cursor position over ANY Thai input, the rendered
  // line (minus colour codes) reproduces the original text exactly — only a trailing space is added at
  // end-of-line. A gap cursor could not satisfy this (it inserts a cell that overruns leading vowels).
  const samples = [
    'สวัสดี',
    'จำชื่อฉันได้ไหม', // the reported sentence (leading vowel ไ in ไหม)
    'ปิ๊กชอบเขียนโค้ด', // tone marks + leading vowel เ
    'ไปไหนมาสามวัน', // leading vowel ไ at index 0
    'เเแแโโใใไไ', // every Thai pre-base vowel, doubled
    'แม่น้ำเจ้าพระยา',
    'ก่ำจิ้มจุ่ม',
    'hello world 123',
  ];
  for (const value of samples) {
    it(`"${value}" — cursor at every grapheme position keeps the text intact`, () => {
      const graphemes = graphemesOf(value);
      for (let g = 0; g <= graphemes.length; g += 1) {
        const codeUnit = graphemes.slice(0, g).join('').length; // start of grapheme g
        const vp = inputViewport(value, codeUnit, 80); // wide → no horizontal scroll
        const rendered = stripAnsi(formatInputLineDisplay(vp));
        const atEol = g >= graphemes.length;
        expect(rendered).toBe(atEol ? `${value} ` : value);
      }
    });
  }

  it('cursor on a leading vowel ไ blocks ON it (reported "ได้█หม" bug is structurally impossible now)', () => {
    const value = 'กไก'; // ก · ไ(leading vowel) · ก — put the cursor on the ไ
    const vp = inputViewport(value, 'ก'.length, 80);
    expect(vp.at).toBe('ไ');
    expect(stripAnsi(formatInputLineDisplay(vp))).toBe('กไก'); // ไ still painted, nothing lost
  });

  it('multiline: cursor on a leading vowel keeps the whole line intact', () => {
    expect(stripAnsi(formatMultilineInputDisplay('กไก', 'ก'.length))).toBe('กไก');
    expect(stripAnsi(formatMultilineInputDisplay('ไหน', 0))).toBe('ไหน');
  });
});
