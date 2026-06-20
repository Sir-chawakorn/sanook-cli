import stringWidth from 'string-width';
import { graphemeBoundaries } from './useEditor.js';

// ────────────────────────────────────────────────────────────────────────────
// Stable, Thai-safe rendering of the REPL input line.
//
// Two bugs this fixes (เทียบกับ CLI เจ้าอื่นที่ "นิ่ง"):
//  1) cursor split a grapheme cluster — the old code did value.slice(cursor, cursor+1),
//     which on Thai cuts a base char away from its combining vowel/tone mark (สระ/วรรณยุกต์
//     เป็น zero-width). The orphaned mark then renders on its own cell → "อักษรห่างเกินไป".
//     Fix: the cursor highlights a WHOLE grapheme cluster (base + all its marks).
//  2) the line bounced between 1 and 2 rows while typing — a wrapping <Text> grows the box
//     vertically the moment content crosses the right edge, shoving the footer down on every
//     keystroke. Fix: a fixed-width horizontal viewport (readline-style) so the input box is
//     always exactly one row; long lines scroll left with ‹ / › markers instead of wrapping.
//
// Display width is measured with string-width (the same lib Ink wraps with), so Thai combining
// marks count as 0 and the window math matches what the terminal actually paints.
// ────────────────────────────────────────────────────────────────────────────

export const SCROLL_LEAD = '‹';
export const SCROLL_TAIL = '›';

export interface InputViewport {
  /** show the ‹ left-truncation marker (content scrolled off to the left) */
  lead: boolean;
  /** text left of the cursor that is within the visible window */
  before: string;
  /** the single grapheme cluster under the cursor (rendered inverse); ' ' at end of line */
  at: string;
  /** text right of the cursor that is within the visible window */
  after: string;
  /** show the › right-truncation marker (content scrolled off to the right) */
  tail: boolean;
}

/** split a string into grapheme clusters (base char + its combining marks stay together) */
export function graphemesOf(value: string): string[] {
  const bounds = graphemeBoundaries(value);
  const out: string[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) out.push(value.slice(bounds[i], bounds[i + 1]));
  return out;
}

/** grapheme-cluster index that a code-unit cursor sits at (0..graphemeCount) */
export function cursorGraphemeIndex(value: string, cursor: number): number {
  const bounds = graphemeBoundaries(value);
  let index = 0;
  for (let i = 0; i < bounds.length; i += 1) {
    if (bounds[i] <= cursor) index = i;
    else break;
  }
  return index;
}

/** display width of one grapheme, never less than 1 cell (so the cursor always has a cell) */
function cellWidth(grapheme: string): number {
  return Math.max(1, stringWidth(grapheme));
}

/**
 * Compute the visible window for a single physical line.
 * `width` = number of terminal columns available to the value (caller subtracts prefix/border/padding).
 * Returns the slice around the cursor that fits, plus whether truncation markers are needed.
 */
export function inputViewport(value: string, cursor: number, width: number): InputViewport {
  const w = Math.max(4, Math.floor(width));
  const graphemes = graphemesOf(value);
  const ci = cursorGraphemeIndex(value, cursor);
  // a trailing sentinel cell so a cursor parked at end-of-line still has somewhere to sit
  const units = [...graphemes.map((g) => ({ text: g, width: cellWidth(g) })), { text: ' ', width: 1 }];
  const cursorUnit = Math.min(ci, units.length - 1);

  const totalWidth = units.reduce((sum, u) => sum + u.width, 0);
  if (totalWidth <= w) {
    return {
      lead: false,
      before: graphemes.slice(0, cursorUnit).join(''),
      at: cursorUnit < graphemes.length ? graphemes[cursorUnit] : ' ',
      after: cursorUnit < graphemes.length ? graphemes.slice(cursorUnit + 1).join('') : '',
      tail: false,
    };
  }

  // overflow → slide a window that always contains the cursor unit; reserve 1 cell for each
  // truncation marker that will actually be shown.
  let start = cursorUnit;
  let end = cursorUnit + 1;
  let used = units[cursorUnit].width;

  // extend right first (so typing at end keeps the tail in view), then backfill left context.
  // the marker reservations (start>0 ⇒ ‹, end<len ⇒ ›) are folded into each fit check.
  while (end < units.length) {
    const next = units[end].width;
    if (used + next + (start > 0 ? 1 : 0) + (end + 1 < units.length ? 1 : 0) <= w) {
      used += next;
      end += 1;
    } else break;
  }
  while (start > 0) {
    const prev = units[start - 1].width;
    if (used + prev + (start - 1 > 0 ? 1 : 0) + (end < units.length ? 1 : 0) <= w) {
      used += prev;
      start -= 1;
    } else break;
  }

  const slice = (from: number, to: number): string =>
    units
      .slice(from, to)
      .map((u) => u.text)
      .join('');

  const atUnit = units[cursorUnit];
  return {
    lead: start > 0,
    before: slice(start, cursorUnit),
    at: cursorUnit === units.length - 1 ? ' ' : atUnit.text,
    after: slice(cursorUnit + 1, end),
    tail: end < units.length,
  };
}
