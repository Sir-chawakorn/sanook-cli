export const DEFAULT_TRANSCRIPT_WINDOW = 30;

/** Window into conversation turns — scrollFromBottom=0 pins to the latest messages. */
export function getTranscriptWindow(
  totalLength: number,
  windowSize: number,
  scrollFromBottom = 0,
): { end: number; scrollFromBottom: number; showNewer: boolean; showOlder: boolean; start: number } {
  if (totalLength <= 0) {
    return { end: 0, scrollFromBottom: 0, showNewer: false, showOlder: false, start: 0 };
  }

  const size = Math.max(1, Math.min(windowSize, totalLength));
  const maxScroll = Math.max(0, totalLength - size);
  const scroll = Math.max(0, Math.min(scrollFromBottom, maxScroll));
  const end = totalLength - scroll;
  const start = Math.max(0, end - size);

  return {
    end,
    scrollFromBottom: scroll,
    showNewer: scroll > 0,
    showOlder: start > 0,
    start,
  };
}

export function transcriptWindowSize(rows: number | undefined, min = 8, max = 40): number {
  const terminalRows = rows ?? 24;
  return Math.max(min, Math.min(max, terminalRows - 12));
}

export function transcriptScrollStep(windowSize: number): number {
  return Math.max(3, Math.floor(windowSize / 2));
}
