import { afterEach, describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './app.js';

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await tick();
  }
}

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
    expect(frame).not.toContain('terminal AI agent');
    expect(frame).not.toContain('Sanook AI services');
    unmount();
  });

  it('/hotkeys opens a floating overlay that Esc closes', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/hotkeys');
    await tick();
    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('Sanook hotkeys');
    expect(lastFrame()).toContain('Esc / Enter / q');

    stdin.write('\x1B');
    await tick();

    expect(lastFrame()).not.toContain('Sanook hotkeys');
    expect(lastFrame()).toContain('/hotkeys');
    unmount();
  });

  it('/hotkeys overlay consumes q and Enter as close commands', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/hotkeys');
    await tick();
    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('Sanook hotkeys');

    stdin.write('q');
    await tick();

    expect(lastFrame()).not.toContain('Sanook hotkeys');

    stdin.write('/hotkeys');
    await tick();
    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('Sanook hotkeys');

    stdin.write('\r');
    await tick();

    expect(lastFrame()).not.toContain('Sanook hotkeys');
    unmount();
  });

  it('/help opens a paged overlay that can page forward and close', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/help');
    await tick();
    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('Sanook help');
    expect(lastFrame()).toContain('/model');
    expect(lastFrame()).toContain('Enter/Space/PgDn');

    for (let i = 0; i < 4 && !(lastFrame() ?? '').includes('นอก REPL'); i += 1) {
      stdin.write('\r');
      await tick();
    }

    expect(lastFrame()).toContain('นอก REPL');

    stdin.write('q');
    await tick();

    expect(lastFrame()).not.toContain('Sanook help');
    expect(lastFrame()).toContain('/help');
    unmount();
  });

  it('shows slash completion suggestions and Enter fills the selected command first', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/ses');
    await tick();

    expect(lastFrame()).toContain('/sessions');
    expect(lastFrame()).toContain('Tab/Enter complete');

    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('/sessions');
    expect(lastFrame()).not.toContain('Sanook sessions');

    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('Sanook sessions'));

    expect(lastFrame()).toContain('Sanook sessions');
    unmount();
  });

  it('shows @file path completion and Enter fills the path before submit', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('@src/hotk');
    await tick();

    expect(lastFrame()).toContain('@src/hotkeys.ts');
    expect(lastFrame()).toContain('Tab/Enter complete');

    stdin.write('\r');
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('@src/hotkeys.ts');
    expect(frame).not.toContain('ERROR:');
    unmount();
  });

  it('/model without args opens a picker overlay and Enter selects the highlighted model', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/model ');
    await tick();
    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('choose provider');

    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('anthropic:sonnet');

    stdin.write('\r');
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('เปลี่ยน model → anthropic:claude-sonnet-4-6');
    expect(frame).toContain('anthropic:claude-sonnet-4-6 · ask-mode');
    expect(frame).not.toContain('Sanook model picker');
    unmount();
  });

  it('/model picker supports j/k style navigation before selecting', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/model ');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('\r');
    await tick();

    stdin.write('j');
    await tick();
    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('เปลี่ยน model → anthropic:claude-haiku-4-5');
    unmount();
  });

  it('/skills opens a Skills Hub overlay and Enter inspects the highlighted skill', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/skills');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('Sanook skills hub'));

    expect(lastFrame()).toContain('Enter inspect');

    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('path:');

    stdin.write('\x1B');
    await tick();

    expect(lastFrame()).toContain('Enter inspect');
    unmount();
  });

  it('/tools opens a Tools Hub overlay and Enter inspects the highlighted lane', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/tools');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('Sanook tools hub'));

    expect(lastFrame()).toContain('built-in lanes');
    expect(lastFrame()).not.toContain('tools ที่ agent ใช้ได้');

    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('detail:');
    expect(lastFrame()).toContain('/mcp');

    stdin.write('\x1B');
    await tick();

    expect(lastFrame()).toContain('built-in lanes');
    unmount();
  });

  it('/sessions opens a Session Switcher overlay', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/sessions');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('Sanook sessions'));

    expect(lastFrame()).toContain('Sanook sessions');
    expect(lastFrame()).not.toContain('saved sessions — จัดการ');
    unmount();
  });
});
