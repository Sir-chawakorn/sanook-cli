import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { SessionPanel, sessionPanelLines } from './session-panel.js';

describe('SessionPanel', () => {
  it('renders Sanook service sections on wide terminals', () => {
    const { lastFrame, unmount } = render(
      <SessionPanel columns={100} model="openai:gpt-5.5" mode="ask" cwd="/tmp/sanook-cli" />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Sanook AI service routes');
    expect(frame).toContain('Code');
    expect(frame).toContain('read/edit/run');
    expect(frame).toContain('Brain');
    expect(frame).toContain('second-brain context');
    expect(frame).toContain('/skills');
    expect(frame).toContain('reusable workflows');
    expect(frame).toContain('Connect');
    expect(frame).toContain('registry search/install');
    expect(frame).toContain('Ship');
    expect(frame).toContain('/copy handoff');
    expect(frame).toContain('System');
    expect(frame).toContain('/hotkeys');
    expect(frame).toContain('openai:gpt-5.5 · ask-mode');
    unmount();
  });

  it('uses compact copy on medium terminals', () => {
    const lines = sessionPanelLines({ columns: 60, model: 'sonnet', mode: 'auto', cwd: '/tmp/sanook-cli' });

    expect(lines.join('\n')).toContain('Routes: Code · Brain · Connect · Ship');
    expect(lines.join('\n')).toContain('@file · /tools · git diff/undo');
    expect(lines.join('\n')).toContain('context · remember · /skills');
    expect(lines.join('\n')).toContain('search/install · doctor');
    expect(lines.join('\n')).toContain('/copy · cost guard · final proof');
    expect(lines.join('\n')).toContain('sonnet · auto-mode');
  });

  it('hides itself on tiny terminals so the prompt stays usable', () => {
    expect(sessionPanelLines({ columns: 36, model: 'sonnet', mode: 'ask' })).toEqual([]);
  });
});
