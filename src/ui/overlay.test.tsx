import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { modelPickerOptions, modelProviderEntries } from '../model-picker.js';
import { TOOL_CATALOG } from '../tool-catalog.js';
import {
  CompletionOverlay,
  FloatingOverlay,
  COMPLETION_OVERLAY_SLOT_LINES,
  completionOverlayLines,
  completionOverlaySlotLines,
  hotkeyOverlayLines,
  mcpOverlayLines,
  modelOverlayLines,
  pagerOverlayLines,
  sessionsOverlayLines,
  shouldReserveCompletionSlot,
  skillsOverlayLines,
  tasksOverlayLines,
  toolsOverlayLines,
} from './overlay.js';

function frameLineCount(frame: string | undefined): number {
  return (frame ?? '').split('\n').length;
}

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
    enabled: true,
    risk: 'file-write' as const,
  },
  {
    config: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token' } },
    name: 'github',
    transport: 'http' as const,
    target: 'https://example.com/mcp',
    secretSummary: '1 header',
    enabled: true,
    risk: 'network-write' as const,
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

  it('pads completion slots to a fixed line count', () => {
    const padded = completionOverlaySlotLines([{ text: '/help', display: '/help', meta: 'commands' }], 0, 62);
    expect(padded).toHaveLength(COMPLETION_OVERLAY_SLOT_LINES);
    expect(padded.filter(Boolean)).toHaveLength(2);
  });

  it('reserves completion slot for slash and mention prefixes', () => {
    expect(shouldReserveCompletionSlot('/', [])).toBe(true);
    expect(shouldReserveCompletionSlot('@src', [])).toBe(true);
    expect(shouldReserveCompletionSlot('hello', [])).toBe(false);
    expect(shouldReserveCompletionSlot('hello', [{ text: '/help', display: '/help', meta: 'x' }])).toBe(true);
  });

  it('renders a fixed-height completion slot while reserved', () => {
    const empty = render(<CompletionOverlay columns={62} items={[]} reserved selected={0} />);
    const filled = render(
      <CompletionOverlay
        columns={62}
        items={[
          { text: '/skills', display: '/skills', meta: 'browse loaded skills' },
          { text: '/sessions', display: '/sessions', meta: 'resume saved sessions' },
        ]}
        reserved
        selected={1}
      />,
    );

    expect(frameLineCount(empty.lastFrame())).toBe(frameLineCount(filled.lastFrame()));
    expect(frameLineCount(filled.lastFrame())).toBeGreaterThan(0);
    expect(filled.lastFrame()).toContain('> /sessions');
    empty.unmount();
    filled.unmount();
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

  it('renders a model picker overlay with provider phase', () => {
    const providers = modelProviderEntries();
    const options = modelPickerOptions('sonnet');
    const overlay = {
      kind: 'model' as const,
      phase: 'provider' as const,
      providers,
      options,
      selected: 0,
    };
    const { lastFrame, unmount } = render(<FloatingOverlay columns={96} overlay={overlay} />);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Sanook model picker');
    expect(frame).toContain('choose provider');
    unmount();
  });

  it('keeps model picker lines within the overlay width', () => {
    const lines = modelOverlayLines(
      {
        kind: 'model',
        phase: 'model',
        providerFilter: 'anthropic',
        providers: modelProviderEntries(),
        options: modelPickerOptions('openai:gpt-5.5'),
        selected: 8,
      },
      52,
    );

    expect(lines[0]).toContain('Sanook model picker');
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

  it('renders a background tasks overlay list', () => {
    const lines = tasksOverlayLines(
      {
        detail: false,
        kind: 'tasks',
        selected: 0,
        tasks: [
          { id: 't1', description: 'scan repo', state: 'running', startedMs: Date.now() - 5000 },
          { id: 't2', description: 'research docs', state: 'done', startedMs: 1000, endedMs: 9000, text: 'found 3 hits' },
        ],
      },
      82,
    );
    expect(lines.join('\n')).toContain('Sanook background tasks');
    expect(lines.join('\n')).toContain('t1');
    expect(lines.join('\n')).toContain('running');
  });

  it('renders a tools hub overlay list and details', () => {
    const selected = TOOL_CATALOG.findIndex((tool) => tool.group === 'Agents');
    const list = toolsOverlayLines({ detail: false, kind: 'tools', selected, tools: TOOL_CATALOG }, 82);
    const detail = toolsOverlayLines({ detail: true, kind: 'tools', selected, tools: TOOL_CATALOG }, 82);

    expect(list).toContain('Sanook tools hub');
    expect(list.join('\n')).toContain('agent orchestration');
    expect(list.join('\n')).toContain('Enter inspect');
    expect(detail.join('\n')).toContain('Agents / agent orchestration');
    expect(detail.join('\n')).toContain('task_spawn');
    expect(detail.join('\n')).toContain('/mcp');
    expect(Math.max(...list.map((line) => line.length))).toBeLessThanOrEqual(82);
  });

  it('clips oversized tools hub detail rows to the overlay width', () => {
    const lines = toolsOverlayLines(
      {
        detail: true,
        kind: 'tools',
        selected: 0,
        tools: [
          {
            detail: 'x'.repeat(100),
            group: 'VeryLongToolCatalogGroupName',
            name: 'VeryLongToolCatalogEntryName',
            summary: 'summary '.repeat(20),
          },
        ],
      },
      42,
    );

    expect(lines[0]).toBe('Sanook tools hub');
    expect(lines.some((line) => line.endsWith('…'))).toBe(true);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(42);
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
          tools: [
            { name: 'issues_list', description: 'List repository issues' },
            { name: 'issues_get', description: 'Get one issue' },
          ],
          transport: 'http',
        },
        toolSelected: 1,
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
    expect(pass.join('\n')).toContain('test: PASS (2 tools)');
    expect(pass.join('\n')).toContain('catalog: 2 tools');
    expect(pass.join('\n')).toContain('  issues_list');
    expect(pass.join('\n')).toContain('> issues_get');
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
    const lines = sessionsOverlayLines({ currentCwd: '/project', kind: 'sessions', selected: 1, sessions: sampleSessions }, 68);

    expect(lines).toContain('Sanook sessions');
    expect(lines.join('\n')).toContain('all projects');
    expect(lines.join('\n')).toContain('Audit');
    expect(lines.join('\n')).toContain('Gateway cleanup');
    expect(lines.join('\n')).toContain('Enter resume');
    expect(lines.join('\n')).toContain('r rename');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(96);
  });

  it('marks sessions from other projects in the list', () => {
    const lines = sessionsOverlayLines(
      {
        currentCwd: '/project',
        kind: 'sessions',
        selected: 0,
        sessions: [{ ...sampleSessions[0], cwd: '/elsewhere' }, sampleSessions[1]],
      },
      96,
    );

    expect(lines.join('\n')).toContain('≠ Audit');
  });

  it('renders rename mode with the editable title draft', () => {
    const lines = sessionsOverlayLines(
      {
        currentCwd: '/project',
        kind: 'sessions',
        renaming: 'New launch title',
        selected: 1,
        sessions: sampleSessions,
      },
      72,
    );

    expect(lines.join('\n')).toContain('rename:');
    expect(lines.join('\n')).toContain('title: New launch title');
    expect(lines.join('\n')).toContain('Enter save');
  });

  it('renders session detail and delete confirmation hints', () => {
    const detail = sessionsOverlayLines({ detail: true, kind: 'sessions', selected: 0, sessions: sampleSessions }, 72);
    const armed = sessionsOverlayLines(
      { detail: true, kind: 'sessions', pendingDeleteId: '2026-06-18-session-a', selected: 0, sessions: sampleSessions },
      72,
    );

    expect(detail.join('\n')).toContain('id: 2026-06-18-session-a');
    expect(detail.join('\n')).toContain('model: sonnet');
    expect(detail.join('\n')).toContain('first: Audit');
    expect(detail.join('\n')).toContain('d delete');
    expect(armed.join('\n')).toContain('press d again');
    expect(Math.max(...armed.map((line) => line.length))).toBeLessThanOrEqual(72);
  });
});
