import { describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard, osc52Sequence, writeSystemClipboard } from './clipboard.js';

describe('clipboard helpers', () => {
  it('builds OSC52 clipboard escape sequences', () => {
    expect(osc52Sequence('hello')).toBe('\u001b]52;c;aGVsbG8=\u0007');
  });

  it('writes to pbcopy on macOS', async () => {
    const stdin = { end: vi.fn() };
    const child = {
      once: vi.fn((event: string, cb: (code?: number) => void) => {
        if (event === 'close') cb(0);
        return child;
      }),
      stdin,
    };
    const start = vi.fn().mockReturnValue(child);

    await expect(writeSystemClipboard('hello', { platform: 'darwin', spawn: start })).resolves.toBe('pbcopy');
    expect(start).toHaveBeenCalledWith('pbcopy', [], expect.objectContaining({ windowsHide: true }));
    expect(stdin.end).toHaveBeenCalledWith('hello');
  });

  it('falls back to OSC52 when system clipboard tools fail', async () => {
    const child = {
      once: vi.fn((event: string, cb: (code?: number) => void) => {
        if (event === 'close') cb(1);
        return child;
      }),
      stdin: { end: vi.fn() },
    };
    const start = vi.fn().mockReturnValue(child);
    const writeOsc52 = vi.fn();

    await expect(copyTextToClipboard('hello', { env: {}, platform: 'linux', spawn: start, writeOsc52 })).resolves.toEqual({
      detail: 'OSC52',
      method: 'osc52',
    });
    expect(writeOsc52).toHaveBeenCalledWith(osc52Sequence('hello'));
  });
});
