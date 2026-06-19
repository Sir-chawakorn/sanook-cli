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
    expect(frame).toContain('งานหนักให้เบาลง');
    expect(frame).toContain('Flow plan -> patch -> prove -> remember');
    expect(frame).toContain('Promise readable · recoverable · remembered');
    expect(frame).toContain('Routes 1 Code | 2 Brain | 3 Connect | 4 Ship');
    expect(frame).toContain('/tools');
    expect(frame).toContain('1 Code');
    expect(frame).toContain('@file · /tools · /diff');
    expect(frame).toContain('2 Brain');
    expect(frame).toContain('brain context · /skills · /compress');
    expect(frame).toContain('3 Connect');
    expect(frame).toContain('/mcp · serve · webhooks');
    expect(frame).toContain('4 Ship');
    expect(frame).toContain('/cost · /copy · /undo');
    unmount();
  });

  it('uses a compact launchpad instead of wide ASCII art on medium terminals', () => {
    const { lastFrame, unmount } = render(
      <Banner columns={64} model="sonnet" version="9.9.9" account="BYOK" cwd="/tmp/sanook-cli" mode="auto" />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('SANOOK AI v9.9.9');
    expect(frame).toContain('Flow plan -> patch -> prove -> remember');
    expect(frame).toContain('routes: Code · Brain · Connect · Ship');
    expect(frame).toContain('connect: /mcp · serve');
    expect(frame).toContain('ship: /copy · /cost · /undo');
    expect(frame).not.toContain('███████');
    unmount();
  });

  it('renders live brand signals when the app passes readiness state', () => {
    const { lastFrame, unmount } = render(
      <Banner
        columns={96}
        model="sonnet"
        version="9.9.9"
        account="BYOK"
        cwd="/tmp/sanook-cli"
        mode="ask"
        signals={[
          { label: 'brain', tone: 'ready', value: 'ready' },
          { label: 'mcp', tone: 'warn', value: 'none' },
          { label: 'skills', tone: 'ready', value: '42' },
          { label: 'git', tone: 'ready', value: 'main' },
        ]}
      />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Signals + brain ready · ! mcp none · + skills 42 · + git main');
    unmount();
  });

  it('keeps a tiny terminal readable with a text-only launchpad', () => {
    const { lastFrame, unmount } = render(
      <Banner columns={36} model="sonnet" version="9.9.9" account="BYOK" cwd="/tmp/sanook-cli" mode="ask" />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('SANOOK AI v9.9.9');
    expect(frame).toContain('sonnet · ask');
    expect(frame).toContain('/help · /tools · /mcp');
    expect(frame).not.toContain('local-first BYOK');
    expect(frame).not.toContain('███████');
    unmount();
  });
});
