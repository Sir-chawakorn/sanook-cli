import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Banner } from './banner.js';

describe('Banner', () => {
  it('renders the SANOOK AI wordmark, runtime status, and command hints', () => {
    const { lastFrame, unmount } = render(
      <Banner columns={100} model="openai:gpt-5.5" version="9.9.9" account="BYOK" cwd="/tmp/sanook-cli" mode="ask" />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('SANOOK AI');
    expect(frame).toContain('v9.9.9 · terminal AI agent · BYOK');
    expect(frame).toContain('model openai:gpt-5.5');
    expect(frame).toContain('mode ask');
    expect(frame).toContain('cwd /tmp/sanook-cli');
    expect(frame).toContain('สนุกกับงานหนัก');
    expect(frame).toContain('Flow plan -> patch -> prove -> remember');
    expect(frame).toContain('Promise readable · recoverable · remembered');
    expect(frame).toContain('Launchpad');
    expect(frame).toContain('/tools');
    expect(frame).toContain('code: @file · /tools · /diff');
    expect(frame).toContain('brain: sanook brain context · /compress');
    expect(frame).toContain('ship: /cost · /undo · sanook mcp search');
    unmount();
  });

  it('uses a compact launchpad instead of wide ASCII art on medium terminals', () => {
    const { lastFrame, unmount } = render(
      <Banner columns={64} model="sonnet" version="9.9.9" account="BYOK" cwd="/tmp/sanook-cli" mode="auto" />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('SANOOK AI v9.9.9');
    expect(frame).toContain('Flow plan -> patch -> prove -> remember');
    expect(frame).toContain('brain: sanook brain context');
    expect(frame).not.toContain('███████');
    unmount();
  });

  it('keeps a tiny terminal readable with a text-only launchpad', () => {
    const { lastFrame, unmount } = render(
      <Banner columns={36} model="sonnet" version="9.9.9" account="BYOK" cwd="/tmp/sanook-cli" mode="ask" />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('SANOOK AI v9.9.9');
    expect(frame).toContain('sonnet · ask');
    expect(frame).toContain('/help · @file · /status');
    expect(frame).not.toContain('local-first BYOK');
    expect(frame).not.toContain('███████');
    unmount();
  });
});
