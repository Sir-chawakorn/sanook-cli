import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capMcpToolOutput, findMcpServerConfigPath, isMcpServerEnabled, isValidMcpServerName, loadMcpConfig, mcpAuthHints, MAX_MCP_TOOL_OUTPUT_CHARS, probeMcpServer } from './mcp.js';

describe('MCP config loading', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-mcp-home-'));
    vi.stubEnv('HOME', home);
    await mkdir(join(home, '.sanook'), { recursive: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('validates server names and sanitizes malformed server configs', async () => {
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      `{
        "mcpServers": {
          "ok_name": { "command": "node", "args": ["server.js"], "env": { "TOKEN": "x", "BAD": 123 } },
          "remote": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer x", "BAD": 123 } },
          "__proto__": { "command": "polluted" },
          "bad/name": { "command": "bad" },
          "badshape": { "command": 123 }
        }
      }`,
    );

    const cfg = await loadMcpConfig(undefined, process.cwd());
    expect(Object.keys(cfg)).toEqual(['ok_name', 'remote']);
    expect(cfg.ok_name).toEqual({ command: 'node', args: ['server.js'], env: { TOKEN: 'x' } });
    expect(cfg.remote).toEqual({ url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } });
    expect((cfg as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('preserves enabled flag and skips disabled servers at runtime', async () => {
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      `{
        "mcpServers": {
          "active": { "command": "node", "args": ["server.js"] },
          "paused": { "command": "node", "args": ["paused.js"], "enabled": false }
        }
      }`,
    );

    const cfg = await loadMcpConfig(undefined, process.cwd());
    expect(cfg.active.enabled).toBeUndefined();
    expect(cfg.paused.enabled).toBe(false);
    expect(isMcpServerEnabled(cfg.active)).toBe(true);
    expect(isMcpServerEnabled(cfg.paused)).toBe(false);
  });

  it('finds the config path that owns a server name', async () => {
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      `{ "mcpServers": { "global": { "command": "node", "args": ["g.js"] } } }`,
    );
    await expect(findMcpServerConfigPath('global')).resolves.toBe(join(home, '.sanook', 'mcp.json'));
    await expect(findMcpServerConfigPath('missing')).resolves.toBeUndefined();
  });

  it('returns auth hints for hosted MCP 401 responses', () => {
    expect(mcpAuthHints({ url: 'https://example.com/mcp' }, 'mcp http 401 Unauthorized')).toEqual(
      expect.arrayContaining([expect.stringContaining('Authorization')]),
    );
    expect(mcpAuthHints({ command: 'node' }, 'mcp http 401 Unauthorized')).toEqual([]);
  });

  it('rejects special or path-like MCP server names', () => {
    expect(isValidMcpServerName('fs_server-1')).toBe(true);
    expect(isValidMcpServerName('__proto__')).toBe(false);
    expect(isValidMcpServerName('constructor')).toBe(false);
    expect(isValidMcpServerName('bad/name')).toBe(false);
  });

  it('caps oversized tool text before it enters model context', () => {
    const capped = capMcpToolOutput('x'.repeat(MAX_MCP_TOOL_OUTPUT_CHARS + 12));
    expect(capped).toContain('[MCP output truncated: 12 chars omitted]');
    expect(capped.length).toBeLessThan(MAX_MCP_TOOL_OUTPUT_CHARS + 80);
  });

  it('reports auth hints when remote MCP returns HTTP 401', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    })) as unknown as typeof fetch;

    try {
      await expect(probeMcpServer({ url: 'https://example.com/mcp' }, 500)).resolves.toMatchObject({
        ok: false,
        transport: 'http',
        error: 'mcp http 401 Unauthorized',
        authHints: expect.arrayContaining([expect.stringContaining('401')]),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('probes stdio MCP servers and reports advertised tools', async () => {
    const server = `
      const readline = require('node:readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        if (!msg.id) return;
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'probe-test', version: '1.0.0' } },
          }) + '\\n');
        }
        if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: [{ name: 'ping', description: 'Returns pong', inputSchema: { type: 'object' } }] },
          }) + '\\n');
        }
      });
    `;

    await expect(probeMcpServer({}, 500)).resolves.toMatchObject({
      ok: false,
      transport: 'stdio',
      tools: [],
      error: 'ต้องมี command หรือ url',
    });

    await expect(probeMcpServer({ command: process.execPath, args: ['-e', server] }, 500)).resolves.toEqual({
      ok: true,
      transport: 'stdio',
      tools: [{ name: 'ping', description: 'Returns pong', inputSchema: { type: 'object' } }],
    });
  });

  it('applies the probe timeout while initializing stdio servers', async () => {
    const started = Date.now();

    await expect(
      probeMcpServer({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }, 75),
    ).resolves.toMatchObject({
      ok: false,
      transport: 'stdio',
      tools: [],
      error: 'mcp timeout: initialize',
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('shares the probe timeout across initialize and tool listing', async () => {
    const server = `
      const readline = require('node:readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        if (!msg.id) return;
        if (msg.method === 'initialize') {
          setTimeout(() => {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'slow-probe', version: '1.0.0' } },
            }) + '\\n');
          }, 50);
        }
        if (msg.method === 'tools/list') {
          setTimeout(() => {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { tools: [{ name: 'late' }] },
            }) + '\\n');
          }, 450);
        }
      });
    `;

    await expect(probeMcpServer({ command: process.execPath, args: ['-e', server] }, 500)).resolves.toMatchObject({
      ok: false,
      transport: 'stdio',
      tools: [],
      error: 'mcp timeout: tools/list',
    });
  });
});
