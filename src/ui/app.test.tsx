import { afterEach, describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './app.js';

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('App (Ink REPL)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('mount + render prompt cursor ได้ (ไม่ crash)', () => {
    const { lastFrame, unmount } = render(<App initialModel="sonnet" />);
    expect(lastFrame()).toContain('›');
    unmount();
  });

  it('/model gpt แสดง canonical spec และไม่ redraw banner ซ้ำหลังมี history', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const { stdin, lastFrame, unmount } = render(<App initialModel="openai:gpt-5.5" />);

    stdin.write('/model gpt');
    await tick();
    stdin.write('\r');
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('เปลี่ยน model → openai:gpt-5.5');
    expect(frame).toContain('openai:gpt-5.5 · ask-mode');
    expect(frame).toContain('/model codex');
    expect(frame).not.toContain('gpt · ask-mode');
    expect(frame).not.toContain('terminal coding agent');
    unmount();
  });
});
