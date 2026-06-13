import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dynamicTool, jsonSchema, type ToolSet } from 'ai';

// MCP client (stdio JSON-RPC) เขียนเอง zero-dep — ต่อ MCP server (filesystem/github/postgres/ฯลฯ)
// ทำให้ Sanook extensible เหมือน Claude Code/Codex. config: ~/.sanook/mcp.json + project .sanook/mcp.json
// { "mcpServers": { "fs": { "command": "npx", "args": ["-y","@modelcontextprotocol/server-filesystem","/path"] } } }
const PROTOCOL_VERSION = '2024-11-05';

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}
interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** MCP stdio client — JSON-RPC 2.0, newline-delimited messages */
class McpClient {
  private proc: ChildProcess;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private dead = false;

  constructor(cfg: McpServerConfig) {
    this.proc = spawn(cfg.command, cfg.args ?? [], {
      env: { ...process.env, ...cfg.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout?.on('data', (d: Buffer) => this.onData(d.toString()));
    this.proc.on('error', () => this.fail('spawn error'));
    this.proc.on('exit', () => this.fail('server exited'));
    this.proc.stdin?.on('error', () => {}); // กัน EPIPE
  }

  private fail(reason: string): void {
    this.dead = true;
    for (const p of this.pending.values()) p.reject(new Error(`mcp: ${reason}`));
    this.pending.clear();
  }

  private onData(s: string): void {
    this.buf += s;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message ?? 'mcp error'));
          else p.resolve(msg.result);
        }
      } catch {
        /* ข้ามบรรทัดที่ไม่ใช่ JSON (เช่น log ของ server) */
      }
    }
  }

  private request(method: string, params?: unknown, timeoutMs = 20_000): Promise<unknown> {
    if (this.dead) return Promise.reject(new Error('mcp: server ตายแล้ว'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private notify(method: string, params?: unknown): void {
    this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'sanook', version: '0.2.0' },
    });
    this.notify('notifications/initialized');
  }

  async listTools(): Promise<McpToolDef[]> {
    const r = (await this.request('tools/list')) as { tools?: McpToolDef[] };
    return r?.tools ?? [];
  }

  async callTool(name: string, args: unknown): Promise<string> {
    const r = (await this.request('tools/call', { name, arguments: args ?? {} })) as {
      content?: { type?: string; text?: string }[];
      isError?: boolean;
    };
    const text = (r?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    return r?.isError ? `MCP error: ${text}` : text || '(no output)';
  }

  close(): void {
    try {
      this.proc.kill();
    } catch {
      /* ตายแล้ว */
    }
  }
}

async function loadMcpConfig(): Promise<Record<string, McpServerConfig>> {
  const merged: Record<string, McpServerConfig> = {};
  for (const p of [join(homedir(), '.sanook', 'mcp.json'), join(process.cwd(), '.sanook', 'mcp.json')]) {
    try {
      const cfg = JSON.parse(await readFile(p, 'utf8')) as McpConfig;
      Object.assign(merged, cfg.mcpServers ?? {});
    } catch {
      /* ไม่มี config = ข้าม */
    }
  }
  return merged;
}

let cache: { tools: ToolSet; clients: McpClient[] } | null = null;

/** โหลด tools จาก MCP servers (spawn + handshake + list) — cache singleton, namespace ชื่อ server__tool */
export async function getMcpTools(onLog?: (m: string) => void): Promise<ToolSet> {
  if (cache) return cache.tools;
  const config = await loadMcpConfig();
  if (!Object.keys(config).length) {
    cache = { tools: {}, clients: [] };
    return {};
  }
  const tools: Record<string, ReturnType<typeof dynamicTool>> = {};
  const clients: McpClient[] = [];
  for (const [serverName, cfg] of Object.entries(config)) {
    try {
      const client = new McpClient(cfg);
      await client.initialize();
      const defs = await client.listTools();
      clients.push(client);
      for (const def of defs) {
        const toolName = `${serverName}__${def.name}`.replace(/[^a-zA-Z0-9_]/g, '_');
        tools[toolName] = dynamicTool({
          description: def.description ?? `${serverName}: ${def.name}`,
          inputSchema: jsonSchema(
            (def.inputSchema as Parameters<typeof jsonSchema>[0]) ?? { type: 'object', properties: {} },
          ),
          execute: async (args) => client.callTool(def.name, args),
        });
      }
      onLog?.(`MCP "${serverName}": ${defs.length} tools`);
    } catch (e) {
      onLog?.(`MCP "${serverName}" ต่อไม่ได้: ${(e as Error).message}`);
    }
  }
  cache = { tools, clients };
  return tools;
}

export function closeMcp(): void {
  if (cache) {
    for (const c of cache.clients) c.close();
    cache = null;
  }
}
