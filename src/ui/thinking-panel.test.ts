import { describe, expect, it } from 'vitest';
import { snapshotThinking, thinkingPanelLines } from './thinking-panel.js';

describe('thinking panel', () => {
  it('renders collapsed and expanded thinking details within terminal width', () => {
    const text = 'Plan next tool\nRead package.json\nRun focused tests';
    const collapsed = thinkingPanelLines(text, 52, 'collapsed');
    const expanded = thinkingPanelLines(text, 52, 'expanded');

    expect(collapsed[0]).toContain('Sanook thinking');
    expect(collapsed.join('\n')).toContain('view: collapsed');
    expect(expanded.join('\n')).toContain('Read package.json');
    expect(Math.max(...expanded.map((line) => line.length))).toBeLessThanOrEqual(52);
  });

  it('hides empty or hidden thinking and caps snapshots', () => {
    expect(thinkingPanelLines('thinking', 80, 'hidden')).toEqual([]);
    expect(thinkingPanelLines('', 80, 'expanded')).toEqual([]);
    expect(snapshotThinking('x'.repeat(2100))).toContain('[thinking truncated]');
  });

  it('truncates snapshots without splitting surrogate pairs', () => {
    const snapshot = snapshotThinking(`${'x'.repeat(1999)}🙂tail`) ?? '';

    expect(snapshot).toContain(`🙂\n[thinking truncated]`);
    expect(snapshot).not.toContain('\uFFFD');
  });
});
