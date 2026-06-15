import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isValidMcpServerName, loadMcpConfig } from './mcp.js';

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
          "__proto__": { "command": "polluted" },
          "bad/name": { "command": "bad" },
          "badshape": { "command": 123 }
        }
      }`,
    );

    const cfg = await loadMcpConfig(undefined, process.cwd());
    expect(Object.keys(cfg)).toEqual(['ok_name']);
    expect(cfg.ok_name).toEqual({ command: 'node', args: ['server.js'], env: { TOKEN: 'x' } });
    expect((cfg as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects special or path-like MCP server names', () => {
    expect(isValidMcpServerName('fs_server-1')).toBe(true);
    expect(isValidMcpServerName('__proto__')).toBe(false);
    expect(isValidMcpServerName('constructor')).toBe(false);
    expect(isValidMcpServerName('bad/name')).toBe(false);
  });
});
