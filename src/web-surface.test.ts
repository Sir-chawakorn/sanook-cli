import { describe, expect, it } from 'vitest';
import { inspectWebSurface, renderWebSurfaceReport } from './web-surface.js';
import type { McpProbeResult, McpServerConfig } from './mcp.js';

describe('web surface', () => {
  it('separates local search from internet search and detects configured web MCP candidates', async () => {
    const report = await inspectWebSurface({
      cwd: '/tmp/sanook-cli',
      loadConfig: async () => ({
        brave: { command: 'npx', args: ['-y', 'brave-search-mcp'] },
        fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
      }),
    });

    expect(report.localSearch.internet).toBe(false);
    expect(report.localSearch.summary).toContain('ไม่ใช่ internet search');
    expect(report.configuredServerCount).toBe(2);
    expect(report.webCandidates.map((candidate) => candidate.name)).toEqual(['brave']);
    expect(renderWebSurfaceReport(report)).toContain('research preset');
    expect(renderWebSurfaceReport(report)).toContain('Grounded web use');
  });

  it('discovers web tools during probe even when the server alias is generic', async () => {
    const seen: McpServerConfig[] = [];
    const probeResult: McpProbeResult = {
      ok: true,
      transport: 'stdio',
      tools: [
        { name: 'search_web', description: 'Search current web results' },
        { name: 'read_repo', description: 'Read repository files' },
      ],
    };
    const report = await inspectWebSurface({
      cwd: '/tmp/sanook-cli',
      probe: true,
      loadConfig: async () => ({
        helper: { command: 'node', args: ['server.js'] },
      }),
      probeServer: async (server) => {
        seen.push(server);
        return probeResult;
      },
    });

    expect(seen).toHaveLength(1);
    expect(report.webCandidates).toHaveLength(1);
    expect(report.webCandidates[0]).toMatchObject({
      name: 'helper',
      probe: { ok: true, toolCount: 2, webTools: ['search_web'] },
    });
  });

  it('reports failing web candidates so doctor can surface broken search setup', async () => {
    const report = await inspectWebSurface({
      cwd: '/tmp/sanook-cli',
      probe: true,
      loadConfig: async () => ({
        tavily: { command: 'npx', args: ['-y', 'tavily-mcp'] },
      }),
      probeServer: async () => ({
        ok: false,
        transport: 'stdio',
        tools: [],
        error: 'missing TAVILY_API_KEY',
      }),
    });

    expect(report.webCandidates).toHaveLength(1);
    expect(report.webCandidates[0].probe).toMatchObject({
      ok: false,
      error: 'missing TAVILY_API_KEY',
    });
    expect(report.recommendations[0]).toContain('probe ไม่ผ่าน');
  });
});
