import { useState, useRef } from 'react';
import type { Key } from 'ink';

// line editor เล็กๆ สำหรับ REPL — cursor, multiline, history nav, readline shortcut
// (เลียน shell/readline) คืน action ให้ app ตัดสินใจ submit/interrupt
export type EditorAction = 'submit' | 'handled' | 'interrupt' | 'none';

export interface Editor {
  value: string;
  cursor: number;
  pasteSnips: PasteSnippet[];
  expandValue: (v?: string) => string;
  setValue: (v: string) => void;
  reset: () => void;
  handleKey: (input: string, key: Key) => EditorAction;
}

export interface PasteSnippet {
  label: string;
  text: string;
}

export const PASTE_COLLAPSE_LINES = 5;
export const PASTE_COLLAPSE_CHARS = 2000;
export const PASTE_SNIPPET_RE = /\[\[ paste [^\n]*?\]\]/g;

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const BRACKETED_PASTE_RE = /\x1b?\[20[01]~/g;
const BRACKETED_PASTE_TEST_RE = /\x1b?\[20[01]~/;
const COMPACT_NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, notation: 'compact' });

function compactNumber(n: number): string {
  return COMPACT_NUMBER.format(n).replace(/[KMBT]$/, (suffix) => suffix.toLowerCase());
}

function oneLinePreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/\]\]/g, '] ]');
}

export function stripTrailingPasteNewlines(text: string): string {
  return /[^\n]/.test(text) ? text.replace(/\n+$/, '') : text;
}

export function normalizePastedInput(input: string): string {
  return stripTrailingPasteNewlines(input.replace(BRACKETED_PASTE_RE, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
}

export function isPasteLikeInput(input: string): boolean {
  return BRACKETED_PASTE_TEST_RE.test(input) || input.includes('\n');
}

export function pasteTokenLabel(text: string, lineCount: number): string {
  const preview = oneLinePreview(text);
  const count = `${compactNumber(lineCount)} lines`;
  if (!preview) return `[[ paste ${count} ]]`;

  const headWidth = 20;
  const tailWidth = 28;
  const body =
    preview.length <= headWidth + tailWidth + 5
      ? preview
      : `${preview.slice(0, headWidth).trimEnd()}.. ${preview.slice(-tailWidth).trimStart()}`;

  return `[[ paste ${count} · ${body} ]]`;
}

function insertToken(value: string, cursor: number, token: string): { cursor: number; value: string } {
  const lead = cursor > 0 && !/\s/.test(value[cursor - 1] ?? '') ? ' ' : '';
  const tail = cursor < value.length && !/\s/.test(value[cursor] ?? '') ? ' ' : '';
  const insert = `${lead}${token}${tail}`;
  return { cursor: cursor + insert.length, value: value.slice(0, cursor) + insert + value.slice(cursor) };
}

export function trimPasteSnips(snips: PasteSnippet[]): PasteSnippet[] {
  const maxCount = 32;
  const maxChars = 4 * 1024 * 1024;
  const out: PasteSnippet[] = [];
  let chars = 0;

  for (let i = snips.length - 1; i >= 0; i -= 1) {
    const snip = snips[i]!;
    if (out.length >= maxCount || chars + snip.text.length > maxChars) break;
    chars += snip.text.length;
    out.unshift(snip);
  }

  return out.length === snips.length ? snips : out;
}

export function applyPasteInput(
  value: string,
  cursor: number,
  input: string,
  pasteSnips: PasteSnippet[],
): { cursor: number; pasteSnips: PasteSnippet[]; value: string } {
  const text = normalizePastedInput(input);
  if (!text) return { cursor, pasteSnips, value };

  const lineCount = text.split('\n').length;
  const shouldCollapse = lineCount >= PASTE_COLLAPSE_LINES || text.length >= PASTE_COLLAPSE_CHARS;
  if (!shouldCollapse) {
    return {
      cursor: cursor + text.length,
      pasteSnips,
      value: value.slice(0, cursor) + text + value.slice(cursor),
    };
  }

  const label = pasteTokenLabel(text, lineCount);
  const inserted = insertToken(value, cursor, label);
  return {
    ...inserted,
    pasteSnips: trimPasteSnips([...pasteSnips, { label, text }]),
  };
}

export function expandPasteSnippets(value: string, pasteSnips: PasteSnippet[]): string {
  const byLabel = new Map<string, string[]>();
  for (const { label, text } of pasteSnips) {
    const matches = byLabel.get(label);
    if (matches) matches.push(text);
    else byLabel.set(label, [text]);
  }
  return value.replace(PASTE_SNIPPET_RE, (token) => byLabel.get(token)?.shift() ?? token);
}

export function graphemeBoundaries(text: string): number[] {
  const boundaries = [0];
  if (segmenter) {
    for (const segment of segmenter.segment(text)) boundaries.push(segment.index + segment.segment.length);
  } else {
    let index = 0;
    for (const point of Array.from(text)) {
      index += point.length;
      boundaries.push(index);
    }
  }
  return boundaries.at(-1) === text.length ? boundaries : [...boundaries, text.length];
}

export function clampCursorToGrapheme(text: string, cursor: number): number {
  const target = Math.max(0, Math.min(cursor, text.length));
  const boundaries = graphemeBoundaries(text);
  let best = 0;
  for (const boundary of boundaries) {
    if (boundary > target) break;
    best = boundary;
  }
  return best;
}

export function previousGraphemeCursor(text: string, cursor: number): number {
  const target = clampCursorToGrapheme(text, cursor);
  let previous = 0;
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary >= target) return previous;
    previous = boundary;
  }
  return previous;
}

export function nextGraphemeCursor(text: string, cursor: number): number {
  const target = clampCursorToGrapheme(text, cursor);
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary > target) return boundary;
  }
  return text.length;
}

export function useEditor(history: string[]): Editor {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [pasteSnips, setPasteSnips] = useState<PasteSnippet[]>([]);
  const histIndex = useRef<number | null>(null); // null = กำลังแก้ draft (ไม่ได้อยู่ในประวัติ)
  const draft = useRef('');

  const set = (v: string, c = v.length): void => {
    setValue(v);
    setCursor(clampCursorToGrapheme(v, c));
  };
  const reset = (): void => {
    histIndex.current = null;
    setPasteSnips([]);
    set('');
  };

  const insert = (s: string): void => set(value.slice(0, cursor) + s + value.slice(cursor), cursor + s.length);

  const historyPrev = (): void => {
    if (!history.length) return;
    if (histIndex.current === null) {
      draft.current = value;
      histIndex.current = history.length - 1;
    } else {
      histIndex.current = Math.max(0, histIndex.current - 1);
    }
    set(history[histIndex.current]);
  };
  const historyNext = (): void => {
    if (histIndex.current === null) return;
    if (histIndex.current >= history.length - 1) {
      histIndex.current = null;
      set(draft.current);
    } else {
      histIndex.current += 1;
      set(history[histIndex.current]);
    }
  };

  const handleKey = (input: string, key: Key): EditorAction => {
    if (key.return) {
      // Alt/Option+Enter หรือบรรทัดลงท้าย "\" → ขึ้นบรรทัดใหม่ (multiline) ไม่ submit
      if (key.meta) return insert('\n'), 'handled';
      if (value.slice(0, cursor).endsWith('\\')) return set(value.slice(0, cursor - 1) + '\n' + value.slice(cursor), cursor), 'handled';
      return 'submit';
    }
    if (key.upArrow) return historyPrev(), 'handled';
    if (key.downArrow) return historyNext(), 'handled';
    if (key.leftArrow) return setCursor(previousGraphemeCursor(value, cursor)), 'handled';
    if (key.rightArrow) return setCursor(nextGraphemeCursor(value, cursor)), 'handled';

    if (key.ctrl) {
      switch (input) {
        case 'a': return setCursor(0), 'handled';
        case 'e': return setCursor(value.length), 'handled';
        case 'u': return set(value.slice(cursor), 0), 'handled'; // ลบจากต้นบรรทัดถึง cursor
        case 'k': return set(value.slice(0, cursor), cursor), 'handled'; // ลบจาก cursor ถึงท้าย
        case 'w': { // ลบ word ก่อน cursor (รวมกรณีเหลือแต่ whitespace)
          const left = value.slice(0, cursor).replace(/\s+$|\s*\S+\s*$/, '');
          return set(left + value.slice(cursor), left.length), 'handled';
        }
        case 'c': return 'interrupt';
        default: return 'handled';
      }
    }
    if (key.backspace || key.delete) {
      if (cursor === 0) return 'handled';
      const previous = previousGraphemeCursor(value, cursor);
      return set(value.slice(0, previous) + value.slice(cursor), previous), 'handled';
    }
    if (input && !key.meta) {
      histIndex.current = null; // เริ่มพิมพ์ = ออกจากโหมดดูประวัติ
      if (isPasteLikeInput(input)) {
        const pasted = applyPasteInput(value, cursor, input, pasteSnips);
        setPasteSnips(pasted.pasteSnips);
        return set(pasted.value, pasted.cursor), 'handled';
      }
      return insert(input), 'handled';
    }
    return 'none';
  };

  return { value, cursor, pasteSnips, expandValue: (v = value) => expandPasteSnippets(v, pasteSnips), setValue: (v) => set(v), reset, handleKey };
}
