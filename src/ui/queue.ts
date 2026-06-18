export const QUEUE_WINDOW = 3;

export function compactPreview(text: string, width: number): string {
  const max = Math.max(8, width);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

export function getQueueWindow(queueLength: number, activeIndex: number | null = null) {
  const start =
    activeIndex === null ? 0 : Math.max(0, Math.min(activeIndex - 1, Math.max(0, queueLength - QUEUE_WINDOW)));
  const end = Math.min(queueLength, start + QUEUE_WINDOW);
  return { end, showLead: start > 0, showTail: end < queueLength, start };
}
