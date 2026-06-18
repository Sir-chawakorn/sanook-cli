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
        name: 'fs',
        transport: 'stdio',
        target: 'npx -y @modelcontextprotocol/server-filesystem .',
        secretSummary: 'no secrets',
      },
      {
        config: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token' } },
        name: 'gh',
        transport: 'http',
        target: 'https://example.com/mcp',
        secretSummary: '1 header',
      },
    ]);
  });
});
