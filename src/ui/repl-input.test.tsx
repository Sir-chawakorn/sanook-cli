import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import { Root } from './render.js';

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('REPL input wiring', () => {
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
    expect(lastFrame() ?? '').toContain('เลือก AI provider'); // wizard step แรก
    unmount();
  });
});
