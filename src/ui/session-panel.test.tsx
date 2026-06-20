import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { SessionPanel, sessionPanelLines } from './session-panel.js';
import { TOOL_CATALOG } from '../tool-catalog.js';

describe('SessionPanel', () => {
  it('renders Sanook service sections on wide terminals', () => {
    const { lastFrame, unmount } = render(
      <SessionPanel
        columns={100}
        cwd="/tmp/sanook-cli"
        mcp={{ count: 2, names: ['filesystem', 'github'] }}
        model="openai:gpt-5.5"
        mode="ask"
        skills={{ count: 1, names: ['debug-root-cause'] }}
      />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Sanook AI service routes');
    expect(frame).toContain('Launchpad 1 tools · 2 skills · 3 MCP');
    expect(frame).toContain('▸ Tools');
    expect(frame).toContain('▸ Skills');
    expect(frame).toContain('▸ MCP');
    expect(frame).toContain('openai:gpt-5.5 · ask-mode');
    unmount();
  });

  it('expands launchpad sections when number keys are pressed', async () => {
    const { stdin, lastFrame, unmount } = render(
      <SessionPanel
        columns={100}
        cwd="/tmp/sanook-cli"
        mcp={{ count: 1, names: ['filesystem'] }}
        model="openai:gpt-5.5"
        mode="ask"
        skills={{ count: 1, names: ['debug-root-cause'] }}
      />,
    );

    stdin.write('1');
    await new Promise((resolve) => setTimeout(resolve, 30));

    const frame = lastFrame() ?? '';
    expect(frame).toContain('▾ Tools');
    expect(frame).toContain('workspace tools');
    expect(frame).toContain('▸ Skills');
    unmount();
  });

  it('shows expanded section previews in line mode', () => {
    const lines = sessionPanelLines({
      columns: 100,
      cwd: '/tmp/sanook-cli',
      expanded: new Set(['tools', 'mcp']),
      mcp: { count: 1, names: ['filesystem'] },
      model: 'openai:gpt-5.5',
      mode: 'ask',
      skills: { count: 0, names: [] },
      tools: { count: TOOL_CATALOG.length, names: TOOL_CATALOG.map((tool) => tool.name) },
    });

    expect(lines.join('\n')).toContain('▾ Tools');
    expect(lines.join('\n')).toContain('workspace tools');
    expect(lines.join('\n')).toContain('▾ MCP');
    expect(lines.join('\n')).toContain('filesystem');
    expect(lines.join('\n')).toContain('▸ Skills');
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
