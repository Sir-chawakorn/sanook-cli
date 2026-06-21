import chalk from 'chalk';
import stringWidth from 'string-width';
import { clampCursorToGrapheme, graphemeBoundaries } from './useEditor.js';

// ────────────────────────────────────────────────────────────────────────────
// Stable, Thai-safe rendering of the REPL input line.
// Regression guards: repl-layout-guard.test.ts + input-view.test.ts (width + block cursor matrix).
//
// CURSOR MODEL — block cursor (highlight the cell the cursor is on), NOT a gap cell inserted between
// clusters. This is the definitive fix for "the cursor hides a Thai character":
//  • A gap cursor INSERTS a styled space between clusters. Placed immediately before a Thai pre-base
//    vowel (เ แ โ ใ ไ, which render to the LEFT of their consonant) the vowel paints onto the inserted
//    cell and looks swallowed ("ได้ไหม" → "ได้█หม"). Any inserted cell is overrun-able.
//  • A block cursor only HIGHLIGHTS an existing grapheme cluster (or a trailing space at end-of-line).
//    It never inserts and never removes a cell, so it is structurally impossible for it to hide,
//    drop, or shift a character — every glyph is always painted, the one under the cursor just gets a
//    background. This is what the terminal's own block cursor does, and what ink-text-input / readline
//    do. We render the whole line as ONE ANSI string with bgCyan + black fg (NOT inverse, which can
//    hide a mark whose colour matches, and NOT split <Text> nodes, which break grapheme shaping) —
//    the two failure modes the earlier gap-cursor design was working around.
//
// The other fix kept from before: a fixed-width horizontal viewport (readline-style) so the input box
// is always exactly one row; long lines scroll left with ‹ / › markers instead of wrapping. Display
// width is measured with string-width (the same lib Ink wraps with) so Thai combining marks count as 0
// and the window math matches what the terminal paints.
// ────────────────────────────────────────────────────────────────────────────

export const SCROLL_LEAD = '‹';
export const SCROLL_TAIL = '›';

export interface InputViewport {
  /** show the ‹ left-truncation marker (content scrolled off to the left) */
  lead: boolean;
  /** text left of the cursor that is within the visible window */
  before: string;
  /** the grapheme cluster UNDER the cursor (block-highlighted by the renderer), or a single space at
   * end-of-line. Never an inserted gap — it is always an existing cell, so it can't hide a character. */
  at: string;
  /** text right of the cursor that is within the visible window (excludes the `at` cluster) */
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

  // Block cursor: it sits ON the grapheme cluster to its right (`graphemes[insertAt]`), or on a trailing
  // space cell at end-of-line. No synthetic cell is inserted, so the cursor can never overrun a Thai
  // pre-base vowel or hide any character — it only flags an existing cell to highlight.
  const atEol = insertAt >= graphemes.length;
  const cursorText = atEol ? ' ' : graphemes[insertAt]!;

  type Unit = { text: string; width: number; isCursor: boolean };
  const units: Unit[] = graphemes.map((g, i) => ({ text: g, width: cellWidth(g), isCursor: i === insertAt }));
  if (atEol) units.push({ text: ' ', width: 1, isCursor: true }); // trailing cursor cell at EOL

  const cursorUnit = insertAt; // == units.length - 1 when atEol (trailing space pushed at this index)
  const totalWidth = units.reduce((sum, u) => sum + u.width, 0);
  if (totalWidth <= w) {
    return {
      lead: false,
      before: graphemes.slice(0, insertAt).join(''),
      at: cursorText,
      after: atEol ? '' : graphemes.slice(insertAt + 1).join(''),
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
    at: cursorText,
    after: slice(cursorUnit + 1, end),
    tail: end < units.length,
  };
}

/** Styled block cursor: background highlight (NOT inverse video — which can hide a Thai mark whose
 * colour matches the swapped background). Highlights the actual cluster under the cursor; empty → a
 * single space (end-of-line cell), so there is always a visible cursor. */
export function highlightCursor(text: string): string {
  return chalk.bgCyan.black(text || ' ');
}

/** @deprecated end-of-line cursor cell — kept for callers/tests; use highlightCursor for the on-char block. */
export function inputCursorCell(): string {
  return chalk.bgCyan.black(' ');
}

/**
 * Render the whole input line as one ANSI string so Thai clusters are shaped once (no split Text nodes).
 * The cursor is a BLOCK on the cluster under it (`vp.at`) — never an inserted gap — so เ แ โ ใ ไ and
 * combining marks are always painted, just with a background where the cursor is.
 */
export function formatInputLineDisplay(vp: InputViewport, opts?: { queueHint?: string }): string {
  const lead = vp.lead ? chalk.dim(SCROLL_LEAD) : '';
  const tail = vp.tail ? chalk.dim(SCROLL_TAIL) : '';
  const queue = opts?.queueHint ? chalk.dim(opts.queueHint) : '';
  return `${lead}${vp.before}${highlightCursor(vp.at)}${vp.after}${tail}${queue}`;
}

/** Multiline input: same single-string block cursor at the grapheme insert point. */
export function formatMultilineInputDisplay(value: string, cursor: number, opts?: { queueHint?: string }): string {
  const insertAt = cursorInsertGraphemeIndex(value, cursor);
  const graphemes = graphemesOf(value);
  const atEol = insertAt >= graphemes.length;
  const before = graphemes.slice(0, insertAt).join('');
  const at = atEol ? ' ' : graphemes[insertAt]!;
  const after = atEol ? '' : graphemes.slice(insertAt + 1).join('');
  const queue = opts?.queueHint ? chalk.dim(opts.queueHint) : '';
  return `${before}${highlightCursor(at)}${after}${queue}`;
}
