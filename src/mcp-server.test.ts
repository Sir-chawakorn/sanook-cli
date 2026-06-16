import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, TOOLS } from './mcp-server.js';
import { resetSearchCaches } from './search/engine.js';
import { PROTOCOL_VERSION } from './mcp.js';

// hermetic: point appHomePath() at a throwaway HOME so we never read the dev's real index/memory
let realHome: string | undefined;
let tmpHome: string;
beforeAll(async () => {
  realHome = process.env.HOME;
  tmpHome = await mkdtemp(join(tmpdir(), 'sanook-mcp-'));
  process.env.HOME = tmpHome;
  process.env.SANOOK_DISABLE_PERSISTENCE = '1';
  resetSearchCaches();
});
afterAll(async () => {
  if (realHome !== undefined) process.env.HOME = realHome;
  delete process.env.SANOOK_DISABLE_PERSISTENCE;
  await rm(tmpHome, { recursive: true, force: true });
});

describe('handle — JSON-RPC dispatch', () => {
  it('initialize returns the protocol version + serverInfo + tools capability', async () => {
    const r = (await handle({ method: 'initialize', id: 1 })) as {
      protocolVersion: string;
      capabilities: { tools: unknown };
      serverInfo: { name: string };
    };
    expect(r.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(r.capabilities.tools).toBeDefined();
    expect(r.serverInfo.name).toContain('sanook');
  });

  it('tools/list advertises the brain tools', async () => {
    const r = (await handle({ method: 'tools/list', id: 2 })) as { tools: { name: string }[] };
    const names = r.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'sanook_search', 'sanook_recall', 'sanook_remember', 'sanook_index', 'sanook_stats',
    ]));
    expect(r.tools.length).toBe(TOOLS.length);
  });

  it('notifications/initialized is a no-response notification', async () => {
    expect(await handle({ method: 'notifications/initialized' })).toBeUndefined();
  });

  it('tools/call sanook_search returns an MCP content block (empty index → 0 hits, no network)', async () => {
    const r = (await handle({
      method: 'tools/call',
      id: 3,
      params: { name: 'sanook_search', arguments: { query: 'deploy vercel', mode: 'auto' } },
    })) as { content: { type: string; text: string }[]; isError?: boolean };
    expect(r.content[0].type).toBe('text');
    expect(r.content[0].text).toMatch(/hit\(s\)/);
    expect(r.isError).toBeFalsy();
  });

  it('tools/call sanook_stats reports an (empty) index without throwing', async () => {
    const r = (await handle({ method: 'tools/call', id: 4, params: { name: 'sanook_stats', arguments: {} } })) as {
      content: { text: string }[];
    };
    expect(r.content[0].text).toMatch(/docs=\d+/);
  });

  it('unknown method rejects with method-not-found', async () => {
    await expect(handle({ method: 'no/such', id: 5 })).rejects.toMatchObject({ code: -32601 });
  });

  it('unknown tool surfaces as isError, not a throw', async () => {
    const r = (await handle({ method: 'tools/call', id: 6, params: { name: 'nope', arguments: {} } })) as {
      isError: boolean;
    };
    expect(r.isError).toBe(true);
  });
});

describe('stdio round-trip (real child, stdout stays protocol-clean)', () => {
  it('answers initialize + tools/list over a piped child; every stdout line is valid JSON-RPC', async () => {
    const bin = fileURLToPath(new URL('./bin.ts', import.meta.url));
    const child = spawn(process.execPath, ['--import', 'tsx', bin, 'mcp', 'serve'], {
      env: { ...process.env, HOME: tmpHome, SANOOK_DISABLE_PERSISTENCE: '1', SANOOK_DISABLE_UPDATE_CHECK: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const frames: unknown[] = [];
    let out = '';
    let bad = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      out += d;
      let i: number;
      while ((i = out.indexOf('\n')) !== -1) {
        const line = out.slice(0, i).trim();
        out = out.slice(i + 1);
        if (!line) continue;
        try {
          frames.push(JSON.parse(line));
        } catch {
          bad += `${line}\n`; // any non-JSON on stdout would corrupt the protocol
        }
      }
    });

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);

    // รอจน response ครบทั้ง id 1 + 2 (event-driven) แทน fixed delay — กัน flaky ตอน child (tsx compile) เริ่มช้าใต้ load
    await new Promise<void>((resolve) => {
      const deadline = Date.now() + 12000;
      const check = (): void => {
        const ids = new Set(frames.map((f) => (f as { id?: number }).id));
        if ((ids.has(1) && ids.has(2)) || Date.now() > deadline) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
    child.stdin.end();
    child.kill();

    expect(bad).toBe(''); // STDOUT DISCIPLINE: nothing but JSON-RPC frames
    const byId = new Map(frames.map((f) => [(f as { id?: number }).id, f]));
    const init = byId.get(1) as { result?: { protocolVersion?: string } } | undefined;
    const list = byId.get(2) as { result?: { tools?: unknown[] } } | undefined;
    expect(init?.result?.protocolVersion).toBe(PROTOCOL_VERSION);
    expect((list?.result?.tools ?? []).length).toBe(TOOLS.length);
  }, 15000);
});
