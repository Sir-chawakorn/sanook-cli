import stringWidth from 'string-width';

// Display-WIDTH-aware text helpers. The REPL renders Thai (combining vowels/tone marks = 0 cells),
// emoji (2 cells), and CJK (2 cells); measuring those with String.prototype.length / .slice / .padEnd
// counts UTF-16 code units, not terminal columns, so fixed-width layouts (banner box, status bar,
// tool-trail columns, transcript truncation) drift, the right edge misaligns, and borders look broken
// — differently across terminals. These helpers measure with string-width (the same table Ink uses to
// wrap) and cut on grapheme boundaries, so a base char and its marks never split. For pure ASCII the
// output is byte-identical to the old .length math (display width == length), so capable terminals are
// unaffected; only Thai/emoji/CJK lines change — toward correct alignment.

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** split into grapheme clusters (base char + combining marks / emoji ZWJ sequences stay together) */
function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/** terminal display width in columns (Thai marks 0, emoji/CJK 2) */
export function displayWidth(text: string): number {
  return stringWidth(text);
}

/**
 * Truncate `text` to at most `maxWidth` DISPLAY columns, appending `ellipsis` when content is cut.
 * Cuts on grapheme boundaries (never splits a Thai cluster or emoji). When maxWidth is too small even
 * for the ellipsis, fills with as many whole clusters as fit (no ellipsis).
 */
export function clipToWidth(text: string, maxWidth: number, ellipsis = '…'): string {
  if (maxWidth <= 0) return '';
  if (stringWidth(text) <= maxWidth) return text;
  const ellW = stringWidth(ellipsis);
  const budget = maxWidth > ellW ? maxWidth - ellW : maxWidth;
  const withEllipsis = maxWidth > ellW;
  let out = '';
  let w = 0;
  for (const g of graphemes(text)) {
    const gw = Math.max(1, stringWidth(g)); // guard: a stray 0-width cluster still consumes one slot
    if (w + gw > budget) break;
    out += g;
    w += gw;
  }
  return withEllipsis ? out + ellipsis : out;
}

/** Pad the END with spaces to a target DISPLAY width (returns text unchanged if already ≥ target). */
export function padEndToWidth(text: string, target: number): string {
  const pad = target - stringWidth(text);
  return pad > 0 ? text + ' '.repeat(pad) : text;
}

/** Pad the START with spaces to a target DISPLAY width (returns text unchanged if already ≥ target). */
export function padStartToWidth(text: string, target: number): string {
  const pad = target - stringWidth(text);
  return pad > 0 ? ' '.repeat(pad) + text : text;
}
