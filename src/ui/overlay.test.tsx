import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { modelPickerOptions } from '../model-picker.js';
import {
  FloatingOverlay,
  completionOverlayLines,
  hotkeyOverlayLines,
  mcpOverlayLines,
  modelOverlayLines,
  pagerOverlayLines,
  sessionsOverlayLines,
  skillsOverlayLines,
} from './overlay.js';

const sampleSkills = [
  { name: 'build-cli-tool', description: 'Build a polished CLI workflow', path: '/skills/build-cli-tool/SKILL.md' },
  {
    name: 'debug-root-cause',
    description: 'Find and fix the real cause of a bug',
    path: '/skills/debug-root-cause/SKILL.md',
    whenToUse: 'Use when behavior is confusing or flaky',
  },
];

const sampleSessions = [
  {
    id: '2026-06-18-session-a',
    created: '2026-06-18T01:00:00.000Z',
    updated: '2026-06-18T01:05:00.000Z',
    model: 'sonnet',
    cwd: '/project',
    messages: [{ role: 'user' as const, content: 'Audit' }],
  },
  {
    id: '2026-06-18-session-b',
    title: 'Gateway cleanup',
    created: '2026-06-18T02:00:00.000Z',
    updated: '2026-06-18T02:05:00.000Z',
    model: 'openai:gpt-5.5',
    cwd: '/project',
    messages: [],
  },
];

const sampleMcpServers = [
  {
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
    name: 'filesystem',
    transport: 'stdio' as const,
    target: 'npx -y @modelcontextprotocol/server-filesystem .',
    secretSummary: 'no secrets',
  },
  {
    config: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token' } },
    name: 'github',
    transport: 'http' as const,
    target: 'https://example.com/mcp',
    secretSummary: '1 header',
  },
];

describe('FloatingOverlay', () => {
  it('renders slash completion lines with an active row', () => {
    const lines = completionOverlayLines(
      [
        { text: '/skills', display: '/skills', meta: 'browse loaded skills' },
        { text: '/sessions', display: '/sessions', meta: 'resume saved sessions' },
      ],
      1,
      62,
    );

    expect(lines.join('\n')).toContain('> /sessions');
    expect(lines.join('\n')).toContain('Tab/Enter complete');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(62);
  });

  it('renders the Sanook hotkeys overlay', () => {
    const { lastFrame, unmount } = render(<FloatingOverlay columns={90} overlay={{ kind: 'hotkeys' }} />);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Sanook hotkeys');
    expect(frame).toContain('Ctrl+C');
    expect(frame).toContain('type while busy + Enter');
    expect(frame).toContain('Esc / Enter / q');
    unmount();
  });

  it('compacts hotkey descriptions to the overlay width', () => {
    const lines = hotkeyOverlayLines(44);

    expect(lines[0]).toBe('Sanook hotkeys');
    expect(lines.join('\n')).toContain('Ctrl+C');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(44);
  });

  it('renders a model picker overlay with active and current markers', () => {
    const options = modelPickerOptions('sonnet');
    const overlay = { kind: 'model' as const, options, selected: options.findIndex((option) => option.current) };
    const { lastFrame, unmount } = render(<FloatingOverlay columns={96} overlay={overlay} />);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Sanook model picker');
    expect(frame).toContain('anthropic:sonnet');
    expect(frame).toContain('↑↓/jk select');
    unmount();
  });

  it('keeps model picker lines within the overlay width', () => {
    const lines = modelOverlayLines({ kind: 'model', options: modelPickerOptions('openai:gpt-5.5'), selected: 8 }, 52);

    expect(lines[0]).toBe('Sanook model picker');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(52);
  });

  it('renders paged help lines with progress and compact width', () => {
    const lines = pagerOverlayLines(
      {
        kind: 'pager',
        lines: Array.from({ length: 18 }, (_, index) => `line ${index + 1} with enough copy to clip in narrow terminals`),
        offset: 5,
        title: 'Sanook help',
      },
      58,
      5,
    );

    expect(lines[0]).toBe('Sanook help');
    expect(lines.join('\n')).toContain('line 6');
    expect(lines.some((line) => line.startsWith('line 1 with'))).toBe(false);
    expect(lines.join('\n')).toContain('Enter/Space/PgDn');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(58);
  });

  it('renders a skills hub overlay list', () => {
    const { lastFrame, unmount } = render(
      <FloatingOverlay columns={90} overlay={{ detail: false, kind: 'skills', selected: 1, skills: sampleSkills }} />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Sanook skills hub');
    expect(frame).toContain('debug-root-cause');
    expect(frame).toContain('Enter inspect');
    unmount();
  });

  it('renders an MCP hub list and details', () => {
    const list = mcpOverlayLines({ detail: false, kind: 'mcp', notes: [], selected: 1, servers: sampleMcpServers }, 82);
    const detail = mcpOverlayLines({ detail: true, kind: 'mcp', notes: [], selected: 1, servers: sampleMcpServers }, 82);

    expect(list).toContain('Sanook MCP hub');
    expect(list.join('\n')).toContain('github');
    expect(list.join('\n')).toContain('Enter inspect');
    expect(detail.join('\n')).toContain('https://example.com/mcp');
    expect(detail.join('\n')).toContain('sanook mcp test github');
    expect(detail.join('\n')).toContain('t test');
    expect(Math.max(...list.map((line) => line.length))).toBeLessThanOrEqual(82);
  });

  it('renders MCP probe progress and tool results', () => {
    const running = mcpOverlayLines(
      { detail: true, kind: 'mcp', notes: [], probe: { serverName: 'github', status: 'running' }, selected: 1, servers: sampleMcpServers },
      82,
    );
    const pass = mcpOverlayLines(
      {
        detail: true,
        kind: 'mcp',
        notes: [],
        probe: {
          serverName: 'github',
          status: 'pass',
          tools: [{ name: 'issues_list', description: 'List repository issues' }],
          transport: 'http',
        },
        selected: 1,
        servers: sampleMcpServers,
      },
      82,
    );
    const fail = mcpOverlayLines(
      {
        detail: true,
        kind: 'mcp',
        notes: [],
        probe: { error: 'missing token', serverName: 'github', status: 'fail', transport: 'http' },
        selected: 1,
        servers: sampleMcpServers,
      },
      82,
    );

    expect(running.join('\n')).toContain('test: running...');
    expect(pass.join('\n')).toContain('test: PASS (1 tools)');
    expect(pass.join('\n')).toContain('issues_list');
    expect(fail.join('\n')).toContain('test: FAIL (http) missing token');
  });

  it('renders skill details and keeps lines compact', () => {
    const lines = skillsOverlayLines({ detail: true, kind: 'skills', selected: 1, skills: sampleSkills }, 56);

    expect(lines).toContain('Sanook skills hub');
    expect(lines).toContain('debug-root-cause');
    expect(lines.join('\n')).toContain('when:');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(56);
  });

  it('renders session switcher lines with titles and prompt fallback', () => {
    const lines = sessionsOverlayLines({ kind: 'sessions', selected: 1, sessions: sampleSessions }, 68);

    expect(lines).toContain('Sanook sessions');
    expect(lines.join('\n')).toContain('Audit');
    expect(lines.join('\n')).toContain('Gateway cleanup');
    expect(lines.join('\n')).toContain('Enter resume');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(68);
  });
});
