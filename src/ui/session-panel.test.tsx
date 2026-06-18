import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { SessionPanel, sessionPanelLines } from './session-panel.js';

describe('SessionPanel', () => {
  it('renders Sanook service sections on wide terminals', () => {
    const { lastFrame, unmount } = render(
      <SessionPanel columns={100} model="openai:gpt-5.5" mode="ask" cwd="/tmp/sanook-cli" />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Sanook AI services');
    expect(frame).toContain('Tools');
    expect(frame).toContain('read/edit/run');
    expect(frame).toContain('Brain');
    expect(frame).toContain('second-brain context');
    expect(frame).toContain('Skills');
    expect(frame).toContain('reusable workflows');
    expect(frame).toContain('MCP');
    expect(frame).toContain('registry search/install');
    expect(frame).toContain('System');
    expect(frame).toContain('/hotkeys');
    expect(frame).toContain('openai:gpt-5.5 · ask-mode');
    unmount();
  });

  it('uses compact copy on medium terminals', () => {
    const lines = sessionPanelLines({ columns: 60, model: 'sonnet', mode: 'auto', cwd: '/tmp/sanook-cli' });

    expect(lines.join('\n')).toContain('Services: Tools · Brain · Skills · MCP · System');
    expect(lines.join('\n')).toContain('context · remember · worklog');
    expect(lines.join('\n')).toContain('find/create reusable workflows');
    expect(lines.join('\n')).toContain('search/install · doctor');
    expect(lines.join('\n')).toContain('sonnet · auto-mode');
  });

  it('hides itself on tiny terminals so the prompt stays usable', () => {
    expect(sessionPanelLines({ columns: 36, model: 'sonnet', mode: 'ask' })).toEqual([]);
  });
});
