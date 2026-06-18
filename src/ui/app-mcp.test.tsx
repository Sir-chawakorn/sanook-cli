import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';

vi.mock('../mcp.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mcp.js')>();
  return {
    ...actual,
    probeMcpServer: vi.fn(async () => ({
      ok: true,
      tools: [
        { name: 'issues_list', description: 'List repository issues' },
        { name: 'issues_get', description: 'Get one repository issue' },
        { name: 'issues_create', description: 'Create a repository issue' },
      ],
      transport: 'http',
    })),
  };
});

vi.mock('../mcp-hub.js', () => ({
  loadMcpHubEntries: async () => ({
    entries: [
      {
        config: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token' } },
        name: 'github',
        transport: 'http',
        target: 'https://example.com/mcp',
        secretSummary: '1 header',
      },
    ],
    notes: [],
  }),
}));

import { App } from './app.js';
import { probeMcpServer } from '../mcp.js';

const tick = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(cond: () => boolean, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await tick();
  }
}

describe('App MCP hub overlay', () => {
  it('/mcp opens configured MCP servers and Enter inspects one', async () => {
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/mcp');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('Sanook MCP hub'));

    expect(lastFrame()).toContain('github');
    expect(lastFrame()).toContain('Enter inspect');

    stdin.write('\r');
    await tick();

    expect(lastFrame()).toContain('https://example.com/mcp');
    expect(lastFrame()).toContain('sanook mcp test github');

    stdin.write('t');
    await waitFor(() => (lastFrame() ?? '').includes('test: PASS'));

    expect(lastFrame()).toContain('issues_list');
    expect(lastFrame()).toContain('catalog: 3 tools');

    stdin.write('j');
    await tick();

    expect(lastFrame()).toContain('> issues_get');
    unmount();
  });

  it('does not reopen MCP details when a probe finishes after backing out', async () => {
    let resolveProbe: (value: Awaited<ReturnType<typeof probeMcpServer>>) => void = () => {};
    vi.mocked(probeMcpServer).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );
    const { stdin, lastFrame, unmount } = render(<App initialModel="sonnet" />);

    stdin.write('/mcp');
    await tick();
    stdin.write('\r');
    await waitFor(() => (lastFrame() ?? '').includes('Sanook MCP hub'));

    stdin.write('t');
    await waitFor(() => (lastFrame() ?? '').includes('test: running...'));

    stdin.write('\x1B');
    await tick();

    expect(lastFrame()).toContain('Enter inspect');
    expect(lastFrame()).not.toContain('test: running...');

    resolveProbe({
      ok: true,
      tools: [{ name: 'issues_list', description: 'List repository issues' }],
      transport: 'http',
    });
    await tick();

    expect(lastFrame()).toContain('Enter inspect');
    expect(lastFrame()).not.toContain('test: PASS');
    expect(lastFrame()).not.toContain('sanook mcp test github');
    unmount();
  });
});
