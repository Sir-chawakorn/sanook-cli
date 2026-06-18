import { describe, expect, it } from 'vitest';
import { compactToolDetail, TOOL_TRAIL_LIMIT, toolTrailLines, updateToolTrailOnEvent, type ToolTrailItem } from './tool-trail.js';

describe('tool trail', () => {
  it('adds a running row for tool-call events', () => {
    const next = updateToolTrailOnEvent([], { detail: { path: 'src/app.tsx' }, tool: 'read_file', type: 'tool-call' }, 0);

    expect(next.nextId).toBe(1);
    expect(next.items).toEqual([{ detail: '{"path":"src/app.tsx"}', id: 0, name: 'read_file', status: 'running' }]);
  });

  it('marks the latest matching running tool as done', () => {
    const started = updateToolTrailOnEvent([], { detail: { path: 'src/app.tsx' }, tool: 'read_file', type: 'tool-call' }, 0);
    const finished = updateToolTrailOnEvent(started.items, { detail: 'ok', tool: 'read_file', type: 'tool-result' }, started.nextId);

    expect(finished.nextId).toBe(1);
    expect(finished.items).toEqual([{ detail: 'ok', id: 0, name: 'read_file', status: 'done' }]);
  });

  it('marks the latest running tool as errored', () => {
    const started = updateToolTrailOnEvent([], { detail: { command: 'npm test' }, tool: 'run_bash', type: 'tool-call' }, 0);
    const errored = updateToolTrailOnEvent(started.items, { detail: 'failed', type: 'error' }, started.nextId);

    expect(errored.items[0]).toMatchObject({ detail: 'failed', name: 'run_bash', status: 'error' });
  });

  it('clips long detail and rendered lines to the terminal width', () => {
    const detail = compactToolDetail({ value: 'x'.repeat(80) }, 24);
    expect(detail.length).toBeLessThanOrEqual(24);
    expect(detail.endsWith('...')).toBe(true);

    const lines = toolTrailLines([{ detail: 'x'.repeat(80), id: 1, name: 'very_long_tool_name_here', status: 'running' }], 36);
    expect(lines[0]).toBe('Sanook tool trail (1)');
    expect(lines.every((line) => line.length <= 36)).toBe(true);
  });

  it('keeps only the latest visible tool rows', () => {
    let items: ToolTrailItem[] = [];
    let nextId = 0;
    for (let i = 0; i < TOOL_TRAIL_LIMIT + 2; i += 1) {
      const next = updateToolTrailOnEvent(items, { tool: `tool_${i}`, type: 'tool-call' }, nextId);
      items = next.items;
      nextId = next.nextId;
    }

    expect(items).toHaveLength(TOOL_TRAIL_LIMIT);
    expect(items[0].name).toBe('tool_2');
  });
});
