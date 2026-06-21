import { clipToWidth } from './text-width.js';

export type DetailsDisplayMode = 'collapsed' | 'expanded' | 'hidden';

const THINKING_CHAR_LIMIT = 2_000;
const THINKING_LINE_LIMIT = 6;

// display-width aware: the panel body is the model's Thai reasoning — .length-based clipping under-fills
// the line and can split a cluster (orphaned tone mark)
function clip(text: string, width: number): string {
  return clipToWidth(text, width, '...');
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function snapshotThinking(text: string): string | undefined {
  const clean = text.trim();
  if (!clean) return undefined;
  const chars = Array.from(clean);
  return chars.length > THINKING_CHAR_LIMIT ? `${chars.slice(0, THINKING_CHAR_LIMIT).join('')}\n[thinking truncated]` : clean;
}

export function thinkingPanelLines(text: string | undefined, columns: number, mode: DetailsDisplayMode = 'collapsed'): string[] {
  const clean = (text ?? '').trim();
  if (!clean || mode === 'hidden') return [];
  const width = Math.max(24, Math.min(Math.max(30, columns - 4), 96));
  const header = `Sanook thinking (${clean.length} chars)`;
  const hint = `view: ${mode} | /details thinking hidden|collapsed|expanded`;

  if (mode === 'collapsed') {
    return [header, hint, clip(normalize(clean), width)].map((line) => clip(line, width));
  }

  const lines = clean
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, THINKING_LINE_LIMIT)
    .map((line) => clip(line, width));
  const omitted = clean.split('\n').filter((line) => line.trim()).length - lines.length;
  return [header, hint, ...lines, omitted > 0 ? `... ${omitted} more thinking lines` : ''].filter(Boolean).map((line) => clip(line, width));
}
