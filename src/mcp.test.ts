import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  capMcpToolOutput,
  closeMcp,
  findMcpServerConfigPath,
  getMcpTools,
  isMcpServerEnabled,
  isValidMcpServerName,
  loadMcpConfig,
  mcpAuthHints,
  MAX_MCP_TOOL_OUTPUT_CHARS,
  probeMcpServer,
} from './mcp.js';

const toolExecOptions = {} as never;

async function readFileEventually(path: string, timeoutMs = 1_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8');
    } catch (e) {
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out reading ${path}`);
}

async function waitForEventually(cond: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
}

describe('MCP config loading', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-mcp-home-'));
    vi.stubEnv('HOME', home);
    await mkdir(join(home, '.sanook'), { recursive: true });
  });

  afterEach(async () => {
    closeMcp();
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

  it('ignores non-record mcpServers instead of treating array indexes as server names', async () => {
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      JSON.stringify({ mcpServers: [{ command: 'node', args: ['array-entry.js'] }] }),
    );

    await expect(loadMcpConfig(undefined, process.cwd())).resolves.toEqual({});
    await expect(findMcpServerConfigPath('0')).resolves.toBeUndefined();
  });

  it('only finds config paths for own MCP server keys', async () => {
    await writeFile(join(home, '.sanook', 'mcp.json'), JSON.stringify({ mcpServers: {} }));

    await expect(findMcpServerConfigPath('toString')).resolves.toBeUndefined();
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

  it('sanitizes malformed tool definitions returned by MCP servers', async () => {
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
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'tool-shape-test', version: '1.0.0' } },
          }) + '\\n');
        }
        if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              tools: [
                { name: 'ping', description: 'Returns pong', inputSchema: { type: 'object' } },
                { name: 'partial', description: 123, inputSchema: [] },
                { name: '' },
                { description: 'missing name' },
                'not-an-object',
              ],
            },
          }) + '\\n');
        }
      });
    `;

    await expect(probeMcpServer({ command: process.execPath, args: ['-e', server] }, 500)).resolves.toEqual({
      ok: true,
      transport: 'stdio',
      tools: [
        { name: 'ping', description: 'Returns pong', inputSchema: { type: 'object' } },
        { name: 'partial' },
      ],
    });
  });

  it('treats malformed tool list envelopes as an empty tool list', async () => {
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
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'bad-envelope-test', version: '1.0.0' } },
          }) + '\\n');
        }
        if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: 'not-an-object',
          }) + '\\n');
        }
      });
    `;

    await expect(probeMcpServer({ command: process.execPath, args: ['-e', server] }, 500)).resolves.toEqual({
      ok: true,
      transport: 'stdio',
      tools: [],
    });
  });

  it('sanitizes malformed tool call content before returning model output', async () => {
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
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'call-shape-test', version: '1.0.0' } },
          }) + '\\n');
        }
        if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: [{ name: 'messy', inputSchema: { type: 'object' } }] },
          }) + '\\n');
        }
        if (msg.method === 'tools/call') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [
                { type: 'text', text: 'ok' },
                { type: 'text', text: 123 },
                { type: 'image', data: 'ignored' },
                ['not-an-object'],
              ],
            },
          }) + '\\n');
        }
      });
    `;
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      JSON.stringify({ mcpServers: { local: { command: process.execPath, args: ['-e', server] } } }),
    );

    const tools = await getMcpTools();
    await expect(tools.local__messy.execute?.({}, toolExecOptions)).resolves.toBe('ok');
  });

  it('keeps MCP tool errors readable when the server returns no text content', async () => {
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
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'empty-error-test', version: '1.0.0' } },
          }) + '\\n');
        }
        if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: [{ name: 'empty_error', inputSchema: { type: 'object' } }] },
          }) + '\\n');
        }
        if (msg.method === 'tools/call') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { isError: true, content: [] },
          }) + '\\n');
        }
      });
    `;
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      JSON.stringify({ mcpServers: { local: { command: process.execPath, args: ['-e', server] } } }),
    );

    const tools = await getMcpTools();
    await expect(tools.local__empty_error.execute?.({}, toolExecOptions)).resolves.toBe('MCP error: (no output)');
  });

  it('shares runtime MCP load logs with concurrent callers without spawning twice', async () => {
    const startedPath = join(home, 'shared-runtime-started.txt');
    const server = `
      const fs = require('node:fs');
      const readline = require('node:readline');
      const startedPath = process.argv[1];
      fs.appendFileSync(startedPath, 'x');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        if (!msg.id) return;
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'shared-log-test', version: '1.0.0' } },
          }) + '\\n');
        }
        if (msg.method === 'tools/list') {
          setTimeout(() => {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { tools: [{ name: 'shared', inputSchema: { type: 'object' } }] },
            }) + '\\n');
          }, 50);
        }
      });
    `;
    const firstLogs: string[] = [];
    const secondLogs: string[] = [];
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      JSON.stringify({ mcpServers: { local: { command: process.execPath, args: ['-e', server, startedPath] } } }),
    );

    const first = getMcpTools((m) => firstLogs.push(m));
    const second = getMcpTools((m) => secondLogs.push(m));

    expect(first).toBe(second);
    await expect(first).resolves.toHaveProperty('local__shared');
    expect(firstLogs).toEqual(expect.arrayContaining([expect.stringContaining('MCP "local"')]));
    expect(secondLogs).toEqual(expect.arrayContaining([expect.stringContaining('MCP "local"')]));
    await expect(readFile(startedPath, 'utf8')).resolves.toBe('x');
  });

  it('replays earlier runtime MCP load logs to later concurrent callers', async () => {
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
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'late-log-test', version: '1.0.0' } },
          }) + '\\n');
        }
        if (msg.method === 'tools/list') {
          setTimeout(() => {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { tools: [{ name: 'slow', inputSchema: { type: 'object' } }] },
            }) + '\\n');
          }, 250);
        }
      });
    `;
    const firstLogs: string[] = [];
    const secondLogs: string[] = [];
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          paused: { command: process.execPath, args: ['-e', ''], enabled: false },
          local: { command: process.execPath, args: ['-e', server] },
        },
      }),
    );

    const first = getMcpTools((m) => firstLogs.push(m));
    await waitForEventually(() => firstLogs.some((m) => m.includes('MCP "paused" disabled')));

    const second = getMcpTools((m) => secondLogs.push(m));

    expect(second).toBe(first);
    expect(secondLogs).toEqual(expect.arrayContaining([expect.stringContaining('MCP "paused" disabled')]));
    await expect(first).resolves.toHaveProperty('local__slow');
  });

  it('closes runtime MCP clients that fail while loading tools', async () => {
    const closedPath = join(home, 'failed-runtime-closed.txt');
    const server = `
      const fs = require('node:fs');
      const readline = require('node:readline');
      const closedPath = process.argv[1];
      const rl = readline.createInterface({ input: process.stdin });
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          fs.writeFileSync(closedPath, 'closed');
        }
        process.exit(0);
      };
      process.on('SIGTERM', close);
      process.on('SIGINT', close);
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        if (!msg.id) return;
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'runtime-fail-test', version: '1.0.0' } },
          }) + '\\n');
        }
        if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32000, message: 'list failed' },
          }) + '\\n');
          setInterval(() => {}, 1000);
        }
      });
    `;
    const logs: string[] = [];
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      JSON.stringify({ mcpServers: { local: { command: process.execPath, args: ['-e', server, closedPath] } } }),
    );

    await expect(getMcpTools((m) => logs.push(m))).resolves.toEqual({});
    expect(logs).toEqual(expect.arrayContaining([expect.stringContaining('list failed')]));
    await expect(readFileEventually(closedPath)).resolves.toBe('closed');
  });

  it('closes runtime MCP clients while tools are still loading', async () => {
    const startedPath = join(home, 'loading-runtime-started.txt');
    const closedPath = join(home, 'loading-runtime-closed.txt');
    const server = `
      const fs = require('node:fs');
      const readline = require('node:readline');
      const startedPath = process.argv[1];
      const closedPath = process.argv[2];
      const rl = readline.createInterface({ input: process.stdin });
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          fs.writeFileSync(closedPath, 'closed');
        }
        process.exit(0);
      };
      process.on('SIGTERM', close);
      process.on('SIGINT', close);
      fs.writeFileSync(startedPath, 'started');
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        if (!msg.id) return;
        if (msg.method === 'initialize') setInterval(() => {}, 1000);
      });
    `;
    const logs: string[] = [];
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      JSON.stringify({ mcpServers: { local: { command: process.execPath, args: ['-e', server, startedPath, closedPath] } } }),
    );

    const loading = getMcpTools((m) => logs.push(m));
    await expect(readFileEventually(startedPath)).resolves.toBe('started');

    closeMcp();

    await expect(readFileEventually(closedPath)).resolves.toBe('closed');
    await expect(loading).resolves.toEqual({});
    expect(logs).toEqual(expect.arrayContaining([expect.stringContaining('mcp: closed')]));
  });

  it('does not keep spawning runtime MCP clients after close during loading', async () => {
    const firstStartedPath = join(home, 'first-runtime-started.txt');
    const firstClosedPath = join(home, 'first-runtime-closed.txt');
    const secondStartedPath = join(home, 'second-runtime-started.txt');
    const blockingServer = `
      const fs = require('node:fs');
      const readline = require('node:readline');
      const startedPath = process.argv[1];
      const closedPath = process.argv[2];
      const rl = readline.createInterface({ input: process.stdin });
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          fs.writeFileSync(closedPath, 'closed');
        }
        process.exit(0);
      };
      process.on('SIGTERM', close);
      process.on('SIGINT', close);
      fs.writeFileSync(startedPath, 'started');
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        if (!msg.id) return;
        if (msg.method === 'initialize') setInterval(() => {}, 1000);
      });
    `;
    const shouldNotStartServer = `
      const fs = require('node:fs');
      const readline = require('node:readline');
      const startedPath = process.argv[1];
      fs.writeFileSync(startedPath, 'started');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        if (!msg.id) return;
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'should-not-start', version: '1.0.0' } },
          }) + '\\n');
        }
        if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: [{ name: 'late_tool', inputSchema: { type: 'object' } }] },
          }) + '\\n');
        }
      });
    `;
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          first: { command: process.execPath, args: ['-e', blockingServer, firstStartedPath, firstClosedPath] },
          second: { command: process.execPath, args: ['-e', shouldNotStartServer, secondStartedPath] },
        },
      }),
    );

    const loading = getMcpTools();
    await expect(readFileEventually(firstStartedPath)).resolves.toBe('started');

    closeMcp();

    await expect(readFileEventually(firstClosedPath)).resolves.toBe('closed');
    await expect(loading).resolves.toEqual({});
    await expect(readFile(secondStartedPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not return tools if runtime MCP closes after tools load', async () => {
    const closedPath = join(home, 'loaded-runtime-closed.txt');
    const server = `
      const fs = require('node:fs');
      const readline = require('node:readline');
      const closedPath = process.argv[1];
      const rl = readline.createInterface({ input: process.stdin });
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          fs.writeFileSync(closedPath, 'closed');
        }
        process.exit(0);
      };
      process.on('SIGTERM', close);
      process.on('SIGINT', close);
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        if (!msg.id) return;
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'loaded-close-test', version: '1.0.0' } },
          }) + '\\n');
        }
        if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: [{ name: 'ready', inputSchema: { type: 'object' } }] },
          }) + '\\n');
          setInterval(() => {}, 1000);
        }
      });
    `;
    const logs: string[] = [];
    await writeFile(
      join(home, '.sanook', 'mcp.json'),
      JSON.stringify({ mcpServers: { local: { command: process.execPath, args: ['-e', server, closedPath] } } }),
    );

    const tools = await getMcpTools((m) => {
      logs.push(m);
      if (m.includes('MCP "local"') && m.includes(': 1 tools')) closeMcp();
    });

    expect(logs).toEqual(expect.arrayContaining([expect.stringContaining('MCP "local"')]));
    expect(tools).toEqual({});
    await expect(readFileEventually(closedPath)).resolves.toBe('closed');
  });

  it('passes shared safe env keys to stdio MCP servers', async () => {
    vi.stubEnv('Path', 'C:\\Windows\\System32');
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
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'env-test', version: '1.0.0' } },
          }) + '\\n');
        }
        if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: [{ name: process.env.Path === 'C:\\\\Windows\\\\System32' ? 'path_ok' : 'path_missing' }] },
          }) + '\\n');
        }
      });
    `;

    await expect(probeMcpServer({ command: process.execPath, args: ['-e', server] }, 500)).resolves.toMatchObject({
      ok: true,
      transport: 'stdio',
      tools: [{ name: 'path_ok' }],
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
