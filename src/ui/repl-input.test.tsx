import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import { Root } from './render.js';

vi.mock('../loop.js', () => ({
  runAgent: async (opts: { prompt: string; history?: unknown[] }) => ({
    cost: { summary: () => 'tokens: 1' },
    messages: [...(opts.history ?? []), { content: opts.prompt, role: 'user' }, { content: 'REPLY_LAYOUT_STABLE', role: 'assistant' }],
    text: 'REPLY_LAYOUT_STABLE',
  }),
}));

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (cond()) return;
    await tick();
  }
}

function frameLineCount(frame: string | undefined): number {
  return (frame ?? '').split('\n').length;
}

describe('REPL input wiring', () => {
  beforeAll(() => {
    process.env.SANOOK_DISABLE_PERSISTENCE = '1';
  });

  afterAll(() => {
    delete process.env.SANOOK_DISABLE_PERSISTENCE;
  });

  it('App receives typed characters into the input box (useInput → editor)', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="anthropic:claude-opus-4-8" />);
    await tick();
    stdin.write('hello');
    await tick();
    expect(lastFrame()).toContain('hello'); // ถ้า useInput ไม่ทำงาน ช่องจะว่าง (= bug เดิม)
    unmount();
  });

  it('typed input is editable (backspace removes a char)', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="anthropic:claude-opus-4-8" />);
    await tick();
    stdin.write('abc');
    await tick();
    stdin.write(''); // DEL / backspace
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ab');
    expect(frame).not.toContain('abc');
    unmount();
  });

  it('keeps frozen transcript stable while typing after a completed turn', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="anthropic:claude-opus-4-8" permissionMode="auto" />);
    await tick();

    stdin.write('ping');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('REPLY_LAYOUT_STABLE'));

    const marker = /REPLY_LAYOUT_STABLE/g;
    expect((lastFrame() ?? '').match(marker)).toHaveLength(1);

    for (const ch of 'typing') {
      stdin.write(ch);
      await tick(10);
    }

    const frame = lastFrame() ?? '';
    expect(frame).toContain('typing');
    expect(frame).toContain('› ping');
    expect(frame.match(marker)).toHaveLength(1);
    unmount();
  });

  it('keeps terminal height stable while expanding a slash completion prefix', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="anthropic:claude-opus-4-8" />);
    await tick();

    stdin.write('/');
    await tick();
    const afterSlash = frameLineCount(lastFrame());

    stdin.write('hel');
    await tick();
    expect(frameLineCount(lastFrame())).toBe(afterSlash);
    expect(lastFrame()).toContain('/hel');

    stdin.write('p');
    await tick();
    expect(frameLineCount(lastFrame())).toBe(afterSlash);
    unmount();
  });
});

describe('Root phase routing (single Ink render)', () => {
  it('needsSetup=false → goes straight to the REPL (no wizard)', async () => {
    const { lastFrame, unmount } = render(
      <Root needsSetup={false} appProps={{ initialModel: 'anthropic:claude-opus-4-8' }} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('เลือก AI provider'); // wizard ไม่โผล่
    unmount();
  });

  it('needsSetup=true → shows the setup wizard first', async () => {
    const { lastFrame, unmount } = render(
      <Root needsSetup={true} appProps={{ initialModel: 'anthropic:claude-opus-4-8' }} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Choose language|เลือกภาษา/);
    unmount();
  });
});
