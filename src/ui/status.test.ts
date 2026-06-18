import { describe, expect, it } from 'vitest';
import { footerStatus, formatCwd, formatElapsed, statusRuleWidths, statusSegments } from './status.js';

describe('footerStatus', () => {
  it('shows richer hints on wide terminals', () => {
    const status = footerStatus({
      columns: 150,
      branch: 'feature/tui-status',
      contextTokens: 42_000,
      costHint: '$0.01',
      cwd: '/Users/me/dev/sanook-cli',
      model: 'openai:gpt-5.5',
      mode: 'ask',
    });

    expect(status).toContain('SANOOK');
    expect(status).toContain('ready');
    expect(status).toContain('ctx');
    expect(status).toContain('/hotkeys');
    expect(status).toContain('cost $0.01');
    expect(status).toContain('dev/sanook-cli');
    expect(status).toContain('(feature/tui-status)');
    expect(status.length).toBeLessThanOrEqual(150);
  });

  it('drops lower-priority hints on narrow terminals', () => {
    const status = footerStatus({
      columns: 36,
      contextTokens: 42_000,
      costHint: '$0.01',
      cwd: '/Users/me/dev/sanook-cli',
      model: 'openai:gpt-5.5',
      mode: 'auto',
    });

    expect(status).toContain('openai:gpt-5.5');
    expect(status).toContain('auto');
    expect(status).not.toContain('/hotkeys');
    expect(status).not.toContain('$0.01');
    expect(status).not.toContain('sanook-cli');
    expect(status.length).toBeLessThanOrEqual(36);
  });

  it('shows busy and queued state before secondary hints', () => {
    const status = footerStatus({
      busy: true,
      columns: 80,
      contextTokens: 1200,
      model: 'anthropic:claude-sonnet-4-5',
      mode: 'ask',
      queuedCount: 3,
    });

    expect(status).toContain('working');
    expect(status).toContain('q 3');
    expect(status).toContain('ctx 1.2k');
    expect(status.length).toBeLessThanOrEqual(80);
  });

  it('reserves left status content so cwd yields first', () => {
    const widths = statusRuleWidths(70, '~/very/deep/path/to/sanook-cli', 52);

    expect(widths.leftWidth).toBeGreaterThanOrEqual(52);
    expect(widths.leftWidth + widths.separatorWidth + widths.rightWidth).toBeLessThanOrEqual(70);
    expect(widths.rightWidth).toBeLessThan('~/very/deep/path/to/sanook-cli'.length);
  });

  it('formats cwd with compact branch labels', () => {
    expect(formatCwd('/Users/me/dev/sanook-cli', 'feature/tui-status')).toBe('/dev/sanook-cli (feature/tui-status)');
    expect(formatCwd('/Users/me/dev/sanook-cli', 'feature/extremely-long-status-rule-branch')).toContain('…status-rule-branch)');
  });

  it('sheds status segments in a stable priority order', () => {
    expect(statusSegments(120)).toEqual({
      contextBar: true,
      cost: true,
      cwd: true,
      elapsed: true,
      hints: true,
      hotkeys: true,
      queue: true,
    });
    expect(statusSegments(44)).toMatchObject({
      contextBar: false,
      cost: false,
      cwd: false,
      elapsed: false,
      hints: false,
      hotkeys: false,
      queue: true,
    });
  });

  it('shows elapsed time while busy on roomy terminals', () => {
    const status = footerStatus({
      busy: true,
      columns: 90,
      elapsedSeconds: 125,
      model: 'sonnet',
      mode: 'ask',
    });

    expect(status).toContain('working');
    expect(status).toContain('time 2m 05s');
    expect(status.length).toBeLessThanOrEqual(90);
  });

  it('formats elapsed time compactly', () => {
    expect(formatElapsed(7)).toBe('7s');
    expect(formatElapsed(65)).toBe('1m 05s');
    expect(formatElapsed(3670)).toBe('1h 01m');
  });
});
