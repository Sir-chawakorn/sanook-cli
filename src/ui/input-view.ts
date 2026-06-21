import stringWidth from 'string-width';
import { clampCursorToGrapheme, graphemeBoundaries } from './useEditor.js';

// ────────────────────────────────────────────────────────────────────────────
// Stable, Thai-safe rendering of the REPL input line.
// Regression guards: repl-layout-guard.test.ts + input-view.test.ts (width + gap cursor).
//
// Two bugs this fixes (เทียบกับ CLI เจ้าอื่นที่ "นิ่ง"):
//  1) block cursor on Thai text — inverting the grapheme under the caret paints a solid
//     cell over the base char + combining marks and looks like the cursor "covers" the letter.
//     Fix: gap cursor — render an inverse space BETWEEN clusters, never on top of a letter.
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
  /** gap cursor cell (inverse space) — never overlays a letter */
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

/** insert position between grapheme clusters (0 = before first char, n = after last) */
export function cursorInsertGraphemeIndex(value: string, cursor: number): number {
  const clamped = clampCursorToGrapheme(value, cursor);
  const bounds = graphemeBoundaries(value);
  for (let i = 0; i < bounds.length; i += 1) {
    if (bounds[i] === clamped) return i;
  }
  return bounds.length - 1;
}

/** @deprecated use cursorInsertGraphemeIndex — kept for callers that need cluster index */
export function cursorGraphemeIndex(value: string, cursor: number): number {
  const insert = cursorInsertGraphemeIndex(value, cursor);
  return insert >= graphemesOf(value).length ? Math.max(0, insert - 1) : insert;
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
  const insertAt = cursorInsertGraphemeIndex(value, cursor);

  type Unit = { text: string; width: number; isCursor: boolean };
  const units: Unit[] = [];
  for (let i = 0; i < insertAt; i += 1) {
    units.push({ text: graphemes[i]!, width: cellWidth(graphemes[i]!), isCursor: false });
  }
  units.push({ text: ' ', width: 1, isCursor: true });
  for (let i = insertAt; i < graphemes.length; i += 1) {
    units.push({ text: graphemes[i]!, width: cellWidth(graphemes[i]!), isCursor: false });
  }

  const cursorUnit = insertAt;
  const totalWidth = units.reduce((sum, u) => sum + u.width, 0);
  if (totalWidth <= w) {
    return {
      lead: false,
      before: graphemes.slice(0, insertAt).join(''),
      at: ' ',
      after: graphemes.slice(insertAt).join(''),
      tail: false,
    };
  }

  let start = cursorUnit;
  let end = cursorUnit + 1;
  let used = units[cursorUnit]!.width;

  while (end < units.length) {
    const next = units[end]!.width;
    if (used + next + (start > 0 ? 1 : 0) + (end + 1 < units.length ? 1 : 0) <= w) {
      used += next;
      end += 1;
    } else break;
  }
  while (start > 0) {
    const prev = units[start - 1]!.width;
    if (used + prev + (start - 1 > 0 ? 1 : 0) + (end < units.length ? 1 : 0) <= w) {
      used += prev;
      start -= 1;
    } else break;
  }

  const slice = (from: number, to: number): string =>
    units
      .slice(from, to)
      .filter((u) => !u.isCursor)
      .map((u) => u.text)
      .join('');

  return {
    lead: start > 0,
    before: slice(start, cursorUnit),
    at: ' ',
    after: slice(cursorUnit + 1, end),
    tail: end < units.length,
  };
}
