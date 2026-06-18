import { describe, expect, it } from 'vitest';
import {
  aliasFromRegistryName,
  buildMcpInstallPlan,
  formatPreset,
  formatRegistryInfo,
  formatRegistrySearch,
  getMcpRegistryServer,
  parseKeyValueList,
  parseMcpRegistrySearchArgs,
  searchMcpRegistry,
  type McpRegistryServer,
} from './mcp-registry.js';

describe('mcp registry helpers', () => {
  const remoteServer: McpRegistryServer = {
    name: 'com.gitlab/mcp',
    description: 'Official GitLab MCP Server',
    version: '0.0.1',
    repositoryUrl: 'https://gitlab.com/gitlab-org/gitlab',
    isLatest: true,
    remotes: [{ type: 'streamable-http', url: 'https://gitlab.com/api/v4/mcp' }],
    packages: [],
  };

  it('normalizes aliases and key=value lists', () => {
    expect(aliasFromRegistryName('com.gitlab/mcp')).toBe('gitlab');
    expect(aliasFromRegistryName('app.linear/linear')).toBe('linear');
    expect(aliasFromRegistryName('ai.smithery/smithery-ai-github')).toBe('github');
    expect(parseKeyValueList(['TOKEN=abc', 'A=b=c'])).toEqual({ TOKEN: 'abc', A: 'b=c' });
    expect(() => parseKeyValueList(['NOPE'])).toThrow(/KEY=value/);
  });

  it('parses mcp search options without consuming following flags as values', () => {
    expect(parseMcpRegistrySearchArgs(['github', '--limit', '5', '--cursor', 'next'])).toEqual({
      ok: true,
      value: { query: 'github', limit: 5, cursor: 'next' },
    });
    expect(parseMcpRegistrySearchArgs(['--limit=7', '--cursor=abc', '--', '--literal', 'query'])).toEqual({
      ok: true,
      value: { query: '--literal query', limit: 7, cursor: 'abc' },
    });
    expect(parseMcpRegistrySearchArgs(['github', '--cursor=-next'])).toEqual({
      ok: true,
      value: { query: 'github', limit: 10, cursor: '-next' },
    });

    const missingLimit = parseMcpRegistrySearchArgs(['github', '--limit', '--cursor', 'next']);
    const missingCursor = parseMcpRegistrySearchArgs(['github', '--cursor', '--limit', '5']);
    const shortFlagCursor = parseMcpRegistrySearchArgs(['github', '--cursor', '-next']);

    expect(missingLimit.ok).toBe(false);
    if (!missingLimit.ok) expect(missingLimit.message).toContain('--limit');
    expect(missingCursor.ok).toBe(false);
    if (!missingCursor.ok) expect(missingCursor.message).toContain('--cursor');
    expect(shortFlagCursor.ok).toBe(false);
    if (!shortFlagCursor.ok) expect(shortFlagCursor.message).toContain('--cursor');
  });

  it('validates mcp search limit and cursor edge cases', () => {
    expect(parseMcpRegistrySearchArgs(['github', '--limit', '50'])).toEqual({
      ok: true,
      value: { query: 'github', limit: 50 },
    });
    expect(parseMcpRegistrySearchArgs(['github', '--cursor', ' next '])).toEqual({
      ok: true,
      value: { query: 'github', limit: 10, cursor: 'next' },
    });
    expect(parseMcpRegistrySearchArgs(['github', '--limit', '5', '--limit=7'])).toEqual({
      ok: true,
      value: { query: 'github', limit: 7 },
    });

    for (const args of [
      ['github', '--limit', '0'],
      ['github', '--limit', '51'],
      ['github', '--limit', '5.5'],
      ['github', '--limit='],
    ]) {
      const parsed = parseMcpRegistrySearchArgs(args);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message).toContain('--limit');
    }

    const emptyCursor = parseMcpRegistrySearchArgs(['github', '--cursor=']);
    const whitespaceCursor = parseMcpRegistrySearchArgs(['github', '--cursor', '   ']);
    expect(emptyCursor.ok).toBe(false);
    if (!emptyCursor.ok) expect(emptyCursor.message).toContain('--cursor');
    expect(whitespaceCursor.ok).toBe(false);
    if (!whitespaceCursor.ok) expect(whitespaceCursor.message).toContain('--cursor');
  });

  it('searches registry and filters older duplicate versions', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        servers: [
          { server: { name: 'x/demo', version: '1.0.0', description: 'old' }, _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: false } } },
          { server: { name: 'x/demo', version: '1.1.0', description: 'new', remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }] }, _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } } },
        ],
        metadata: { nextCursor: 'next' },
      }),
    });

    const result = await searchMcpRegistry('demo', { fetchImpl, limit: 2 });
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toMatchObject({ name: 'x/demo', version: '1.1.0' });
    expect(result.nextCursor).toBe('next');
    expect(formatRegistrySearch(result)).toContain('x/demo@1.1.0');
  });

  it('gets latest version and formats info', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        servers: [
          { server: { name: 'x/demo', version: '1.0.0' }, _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: false } } },
          { server: { name: 'x/demo', version: '1.1.0', packages: [{ registryType: 'npm', identifier: 'demo-mcp', version: '1.1.0', transport: { type: 'stdio' } }] }, _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } } },
        ],
      }),
    });

    const server = await getMcpRegistryServer('x/demo', { fetchImpl });
    expect(server?.version).toBe('1.1.0');
    expect(formatRegistryInfo(server!)).toContain('demo-mcp@1.1.0');
  });

  it('builds remote and package install plans, including missing secrets', () => {
    expect(buildMcpInstallPlan(remoteServer, { alias: 'gitlab' })).toMatchObject({
      ok: true,
      alias: 'gitlab',
      config: { url: 'https://gitlab.com/api/v4/mcp' },
      source: 'remote',
    });
    expect(buildMcpInstallPlan(remoteServer, { headers: { Authorization: 'Bearer x' } })).toMatchObject({
      ok: true,
      config: { url: 'https://gitlab.com/api/v4/mcp', headers: { Authorization: 'Bearer x' } },
    });
    expect(
      buildMcpInstallPlan({
        ...remoteServer,
        remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp', headers: [{ name: 'X-Mode', default: 'readonly' }] }],
      }),
    ).toMatchObject({
      ok: true,
      config: { url: 'https://example.com/mcp', headers: { 'X-Mode': 'readonly' } },
    });

    const secretRemote: McpRegistryServer = {
      ...remoteServer,
      remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer {token}', isRequired: true, isSecret: true }] }],
    };
    expect(buildMcpInstallPlan(secretRemote)).toMatchObject({ ok: false, missing: ['header:Authorization'] });
    expect(buildMcpInstallPlan(secretRemote, { headers: { Authorization: 'Bearer x' } })).toMatchObject({
      ok: true,
      config: { headers: { Authorization: 'Bearer x' } },
    });

    const npmServer: McpRegistryServer = {
      name: 'io.example/files',
      isLatest: true,
      remotes: [],
      packages: [{ registryType: 'npm', identifier: 'files-mcp', version: '1.2.3', transport: { type: 'stdio' }, environmentVariables: [{ name: 'ROOT', isRequired: true }] }],
    };
    expect(buildMcpInstallPlan(npmServer, { transport: 'stdio' })).toMatchObject({ ok: false, missing: ['env:ROOT'] });
    expect(buildMcpInstallPlan(npmServer, { transport: 'stdio', env: { ROOT: '/tmp' } })).toMatchObject({
      ok: true,
      config: { command: 'npx', args: ['-y', 'files-mcp@1.2.3'], env: { ROOT: '/tmp' } },
    });
    expect(
      buildMcpInstallPlan(
        {
          name: 'io.example/scoped',
          isLatest: true,
          remotes: [],
          packages: [{ registryType: 'npm', identifier: '@scope/scoped-mcp', version: '2.0.0', transport: { type: 'stdio' } }],
        },
        { transport: 'stdio' },
      ),
    ).toMatchObject({
      ok: true,
      config: { command: 'npx', args: ['-y', '@scope/scoped-mcp@2.0.0'] },
    });
    expect(buildMcpInstallPlan(npmServer, { transport: 'remote' })).toMatchObject({
      ok: false,
      warnings: ['server นี้ไม่มี remote URL ที่ install ได้'],
    });
  });

  it('formats curated presets', () => {
    expect(formatPreset()).toContain('dev');
    expect(formatPreset('pm')).toContain('app.linear/linear');
    expect(formatPreset('missing')).toContain('ไม่เจอ preset');
  });
});
