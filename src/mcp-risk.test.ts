import { describe, expect, it } from 'vitest';
import { inferConfiguredServerRisk, inferRegistryServerRisk } from './mcp-risk.js';
import type { McpRegistryServer } from './mcp-registry.js';

describe('mcp risk labels', () => {
  it('classifies registry servers from metadata', () => {
    const gitlab: McpRegistryServer = {
      name: 'com.gitlab/mcp',
      description: 'Official GitLab MCP Server',
      isLatest: true,
      remotes: [{ type: 'streamable-http', url: 'https://gitlab.com/api/v4/mcp' }],
      packages: [],
    };
    expect(inferRegistryServerRisk(gitlab)).toBe('network-write');

    expect(
      inferRegistryServerRisk({
        name: 'capital.hove/read-only-local-postgres-mcp-server',
        isLatest: true,
        remotes: [],
        packages: [{ registryType: 'npm', identifier: 'postgres-readonly-mcp', transport: { type: 'stdio' } }],
      }),
    ).toBe('read-only');

    expect(
      inferRegistryServerRisk({
        name: 'io.github.CSOAI-ORG/docker-helper-ai-mcp',
        isLatest: true,
        remotes: [],
        packages: [{ registryType: 'npm', identifier: 'docker-helper', transport: { type: 'stdio' } }],
      }),
    ).toBe('infra/admin');
  });

  it('classifies configured servers from command line and tools', () => {
    expect(
      inferConfiguredServerRisk('fs', {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
      }),
    ).toBe('file-write');

    expect(
      inferConfiguredServerRisk('gh', { url: 'https://example.com/mcp' }, [{ name: 'create_issue', description: 'Open a GitHub issue' }]),
    ).toBe('network-write');

    expect(
      inferConfiguredServerRisk('docs', { command: 'npx', args: ['-y', 'context7-mcp'] }, [{ name: 'resolve_library', description: 'Lookup docs' }]),
    ).toBe('read-only');
  });
});
