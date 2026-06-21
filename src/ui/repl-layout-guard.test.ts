import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Regression guards for REPL layout stability.
 *
 * Symptom we prevent: the chat transcript + input "bounce" on every keystroke because Ink
 * redraws the whole tree. Fix lives in app.tsx (<Static> transcript + fixed input dock) and
 * input-view.ts (single-row horizontal viewport + gap cursor for Thai).
 *
 * If you change REPL layout, read those comments first and update these assertions intentionally.
 */
const APP_SOURCE = readFileSync(new URL('./app.tsx', import.meta.url), 'utf8');
const INPUT_VIEW_SOURCE = readFileSync(new URL('./input-view.ts', import.meta.url), 'utf8');
const INPUT_VIEW_IN_APP = readFileSync(new URL('./app.tsx', import.meta.url), 'utf8');

const OVERLAY_SOURCE = readFileSync(new URL('./overlay.tsx', import.meta.url), 'utf8');

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

describe('REPL layout regression guards (source)', () => {
  it('freezes completed transcript in Ink Static when pinned to bottom', () => {
    expect(APP_SOURCE).toMatch(/import \{[^}]*\bStatic\b[^}]*\} from 'ink';/);
    expect(APP_SOURCE).toContain('const pinnedToBottom = transcriptScroll === 0');
    expect(APP_SOURCE).toContain('<Static items={history}');
    expect(APP_SOURCE).toContain('pinnedToBottom ?');
  });

  it('only renders a dynamic windowed transcript while scrolled up', () => {
    expect(countMatches(APP_SOURCE, /visibleHistory\.map\(/g)).toBe(1);
    expect(APP_SOURCE).toMatch(/pinnedToBottom \?[\s\S]*<Static items=\{history\}/);
    expect(APP_SOURCE).toMatch(/:\s*\(\s*<>[\s\S]*visibleHistory\.map\(/);
  });

  it('anchors the live input dock so typing does not shift the footer', () => {
    expect(APP_SOURCE).toContain('<Box flexDirection="column" flexShrink={0}>');
    expect(APP_SOURCE).toContain('flexDirection="row" flexShrink={0}');
  });

  it('remounts frozen transcript when history grows (not on keystrokes)', () => {
    expect(APP_SOURCE).toMatch(
      /const addTurn =[\s\S]*setHistoryResetKey\(\(key\) => key \+ 1\);[\s\S]*setHistory\(\(h\) => \[/,
    );
  });

  it('documents Static remount trade-offs where modes change frozen turns', () => {
    expect(APP_SOURCE).toContain('transcript lives in <Static>');
    expect(APP_SOURCE).toContain('setToolTrailMode');
    expect(APP_SOURCE).toContain('setHistoryResetKey((key) => key + 1)');
  });
});

describe('REPL input regression guards (source)', () => {
  it('uses a fixed-width horizontal viewport for single-line input', () => {
    expect(INPUT_VIEW_SOURCE).toContain('inputViewport');
    expect(INPUT_VIEW_SOURCE).toContain('gap cursor');
    expect(INPUT_VIEW_IN_APP).toContain('inputViewport(value, cursor');
    expect(INPUT_VIEW_IN_APP).toContain('wrap="truncate-end"');
  });

  it('does not invert Thai graphemes under the block cursor', () => {
    expect(INPUT_VIEW_IN_APP).toContain('<Text inverse>{vp.at}</Text>');
    expect(INPUT_VIEW_IN_APP).not.toMatch(/<Text inverse>\{graphemes\[.*\]\}<\/Text>/);
  });
});

describe('REPL completion overlay regression guards (source)', () => {
  it('reserves a fixed-height slot for slash and @ completions', () => {
    expect(APP_SOURCE).toContain('shouldReserveCompletionSlot');
    expect(APP_SOURCE).toContain('reserveCompletionSlot');
    expect(APP_SOURCE).toContain('reserved={reserveCompletionSlot}');
    expect(OVERLAY_SOURCE).toContain('COMPLETION_OVERLAY_RESERVED_ROWS');
    expect(OVERLAY_SOURCE).toContain('completionOverlaySlotLines');
  });
});
