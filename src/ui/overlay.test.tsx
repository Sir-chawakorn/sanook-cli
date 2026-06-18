import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { FloatingOverlay, hotkeyOverlayLines } from './overlay.js';

describe('FloatingOverlay', () => {
  it('renders the Sanook hotkeys overlay', () => {
    const { lastFrame, unmount } = render(<FloatingOverlay columns={90} overlay={{ kind: 'hotkeys' }} />);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Sanook hotkeys');
    expect(frame).toContain('Ctrl+C');
    expect(frame).toContain('type while busy + Enter');
    expect(frame).toContain('Esc / Enter / q');
    unmount();
  });

  it('compacts hotkey descriptions to the overlay width', () => {
    const lines = hotkeyOverlayLines(44);

    expect(lines[0]).toBe('Sanook hotkeys');
    expect(lines.join('\n')).toContain('Ctrl+C');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(44);
  });
});
