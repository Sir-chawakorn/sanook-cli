import { inspect } from 'node:util';
import { describeToolCall, type ToolActivity } from './tool-activity.js';
import { clipToWidth, padEndToWidth } from './text-width.js';

export type ToolTrailStatus = 'done' | 'error' | 'running';
export type ToolTrailDisplayMode = 'compact' | 'expanded' | 'hidden';

export interface ToolTrailItem {
  detail?: string;
  id: number;
  name: string;
  status: ToolTrailStatus;
  /** human-friendly activity (title + colored diff) computed from the tool input */
  activity?: ToolActivity;
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

// display-width aware (Thai filenames / emoji activity titles) so the trail columns stay aligned
function clip(text: string, width: number): string {
  return clipToWidth(text, width, '...');
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
            return inspect(detail, { breakLength: Infinity, depth: 2 });
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
      items: trimItems([
        ...items,
        { detail: compactToolDetail(event.detail), id: nextId, name, status: 'running', activity: describeToolCall(name, event.detail) },
      ]),
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

/** the 2 header lines (title + view/status meta) shared by string + rich rendering */
export function toolTrailHeader(items: ToolTrailItem[], mode: ToolTrailDisplayMode): string[] {
  return [`Sanook tool trail (${items.length})`, `view: ${mode} | ${statusSummary(items)} | Ctrl+T / /trail`];
}

/** width budget for a rich activity row (mirrors toolTrailLines clipping) */
export function toolTrailWidth(columns: number): number {
  return Math.max(24, Math.min(Math.max(30, columns - 4), 96));
}

export function toolTrailLines(items: ToolTrailItem[], columns: number, mode: ToolTrailDisplayMode = 'expanded'): string[] {
  if (mode === 'hidden') return [];
  if (!items.length) return [];
  const width = toolTrailWidth(columns);
  const nameWidth = Math.max(8, Math.min(24, Math.floor(width * 0.34)));
  const detailWidth = Math.max(0, width - nameWidth - 18);
  const lines = toolTrailHeader(items, mode);
  if (mode === 'compact') {
    lines.push(`tools: ${items.map((item) => `${markerForStatus(item.status)}${item.name}`).join(' ')}`);
    return lines.map((line) => clip(line, width));
  }
  for (const item of items) {
    const marker = markerForStatus(item.status);
    const detail = item.detail ? ` ${clip(item.detail, detailWidth)}` : '';
    lines.push(`${marker} ${padEndToWidth(clip(item.name, nameWidth), nameWidth)} ${item.status.padEnd(7)}${detail}`);
  }
  return lines.map((line) => clip(line, width));
}
