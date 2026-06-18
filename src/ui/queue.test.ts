import { describe, expect, it } from 'vitest';
import { compactPreview, getQueueWindow } from './queue.js';

describe('queue window', () => {
  it('shows the first window and tail count for long queues', () => {
    expect(getQueueWindow(5)).toEqual({ start: 0, end: 3, showLead: false, showTail: true });
  });

  it('centers around an active edit index when provided', () => {
    expect(getQueueWindow(5, 3)).toEqual({ start: 2, end: 5, showLead: true, showTail: false });
  });

  it('compacts previews with an ellipsis', () => {
    expect(compactPreview('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefghi…');
  });
});
