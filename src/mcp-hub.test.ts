import { describe, expect, it } from 'vitest';
import { mcpHubEntriesFromConfig } from './mcp-hub.js';

describe('mcp hub', () => {
  it('summarizes stdio and http MCP servers for the overlay', () => {
    const state = mcpHubEntriesFromConfig(
      {
        fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
        gh: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token' } },
      },
      ['project config skipped'],
    );

    expect(state.notes).toEqual(['project config skipped']);
    expect(state.entries).toEqual([
      {
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
        enabled: true,
        name: 'fs',
        risk: 'file-write',
        transport: 'stdio',
        target: 'npx -y @modelcontextprotocol/server-filesystem .',
        secretSummary: 'no secrets',
      },
      {
        config: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token' } },
        enabled: true,
        name: 'gh',
        risk: 'network-write',
        transport: 'http',
        target: 'https://example.com/mcp',
        secretSummary: '1 header',
      },
    ]);
  });

  it('marks disabled servers in hub entries', () => {
    const state = mcpHubEntriesFromConfig({
      off: { command: 'node', args: ['off.js'], enabled: false },
    });
    expect(state.entries[0]?.enabled).toBe(false);
  });
});
