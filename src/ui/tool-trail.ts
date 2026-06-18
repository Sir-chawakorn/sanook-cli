export type ToolTrailStatus = 'done' | 'error' | 'running';
export type ToolTrailDisplayMode = 'compact' | 'expanded' | 'hidden';

export interface ToolTrailItem {
  detail?: string;
  id: number;
  name: string;
  status: ToolTrailStatus;
}

export interface ToolTrailEvent {
  detail?: unknown;
  text?: string;
  tool?: string;
  type: 'error' | 'tool-call' | 'tool-result';
}

export interface ToolTrailUpdate {
  items: ToolTrailItem[];
  nextId: number;
}

export const TOOL_TRAIL_LIMIT = 6;

function clip(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length > width ? `${text.slice(0, Math.max(0, width - 3))}...` : text;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function compactToolDetail(detail: unknown, width = 64): string {
  if (detail === undefined || detail === null) return '';
  const text =
    typeof detail === 'string'
      ? detail
      : (() => {
          try {
            return JSON.stringify(detail);
          } catch {
            return String(detail);
          }
        })();
  return clip(normalizeWhitespace(text), width);
}

function trimItems(items: ToolTrailItem[]): ToolTrailItem[] {
  return items.slice(Math.max(0, items.length - TOOL_TRAIL_LIMIT));
}

function latestRunningToolIndex(items: ToolTrailItem[], tool?: string): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.status !== 'running') continue;
    if (!tool || item.name === tool) return i;
  }
  return -1;
}

export function updateToolTrailOnEvent(items: ToolTrailItem[], event: ToolTrailEvent, nextId: number): ToolTrailUpdate {
  if (event.type === 'tool-call') {
    const name = event.tool?.trim() || 'tool';
    return {
      items: trimItems([...items, { detail: compactToolDetail(event.detail), id: nextId, name, status: 'running' }]),
      nextId: nextId + 1,
    };
  }

  if (event.type === 'tool-result') {
    const index = latestRunningToolIndex(items, event.tool);
    const detail = compactToolDetail(event.detail);
    if (index === -1) {
      const name = event.tool?.trim() || 'tool';
      return {
        items: trimItems([...items, { detail, id: nextId, name, status: 'done' }]),
        nextId: nextId + 1,
      };
    }
    const next = [...items];
    next[index] = { ...next[index], detail: detail || next[index].detail, status: 'done' };
    return { items: trimItems(next), nextId };
  }

  const index = latestRunningToolIndex(items);
  const detail = compactToolDetail(event.detail ?? event.text);
  if (index === -1) return { items, nextId };
  const next = [...items];
  next[index] = { ...next[index], detail: detail || next[index].detail, status: 'error' };
  return { items: trimItems(next), nextId };
}

function markerForStatus(status: ToolTrailStatus): string {
  return status === 'running' ? '>' : status === 'done' ? '+' : '!';
}

function statusSummary(items: ToolTrailItem[]): string {
  const running = items.filter((item) => item.status === 'running').length;
  const done = items.filter((item) => item.status === 'done').length;
  const error = items.filter((item) => item.status === 'error').length;
  return [`${done} done`, running ? `${running} running` : '', error ? `${error} error` : ''].filter(Boolean).join(' / ');
}

export function toolTrailLines(items: ToolTrailItem[], columns: number, mode: ToolTrailDisplayMode = 'expanded'): string[] {
  if (mode === 'hidden') return [];
  if (!items.length) return [];
  const width = Math.max(24, Math.min(Math.max(30, columns - 4), 96));
  const nameWidth = Math.max(8, Math.min(24, Math.floor(width * 0.34)));
  const detailWidth = Math.max(0, width - nameWidth - 18);
  const lines = [`Sanook tool trail (${items.length})`, `view: ${mode} | ${statusSummary(items)} | Ctrl+T / /trail`];
  if (mode === 'compact') {
    lines.push(`tools: ${items.map((item) => `${markerForStatus(item.status)}${item.name}`).join(' ')}`);
    return lines.map((line) => clip(line, width));
  }
  for (const item of items) {
    const marker = markerForStatus(item.status);
    const detail = item.detail ? ` ${clip(item.detail, detailWidth)}` : '';
    lines.push(`${marker} ${clip(item.name, nameWidth).padEnd(nameWidth)} ${item.status.padEnd(7)}${detail}`);
  }
  return lines.map((line) => clip(line, width));
}
