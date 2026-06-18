import { describe, expect, it } from 'vitest';
import { clampQueueActiveIndex, compactPreview, getQueueWindow, queueActiveIndexAfterDelete } from './queue.js';

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

  it('clamps active queue indexes', () => {
    expect(clampQueueActiveIndex(null, 3)).toBe(0);
    expect(clampQueueActiveIndex(9, 3)).toBe(2);
    expect(clampQueueActiveIndex(0, 0)).toBeNull();
  });

  it('keeps the active queue index valid after deleting a row', () => {
    expect(queueActiveIndexAfterDelete(0, 3)).toBe(0);
    expect(queueActiveIndexAfterDelete(2, 3)).toBe(1);
    expect(queueActiveIndexAfterDelete(0, 1)).toBeNull();
  });
});
