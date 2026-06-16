import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dynamicTool, jsonSchema, type ToolSet } from 'ai';
import { appHomePath, appProjectPath, BRAND } from './brand.js';
import { hasUntrustedProjectConfig, projectConfigPathIfTrusted, projectRoot } from './trust.js';

// version จาก package.json (single source of truth) — กัน drift เหมือน bin.ts/banner
const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

// MCP client เขียนเอง zero-dep — ต่อ MCP server (filesystem/github/postgres/ฯลฯ)
// 2 transport: stdio (command) + Streamable-HTTP (url) → ต่อทั้ง local และ remote/hosted MCP ได้
// config: ~/.sanook/mcp.json + project .sanook/mcp.json
//   stdio:  { "fs":  { "command": "npx", "args": ["-y","@modelcontextprotocol/server-filesystem","/path"] } }
//   remote: { "gh":  { "url": "https://api.example.com/mcp", "headers": { "Authorization": "Bearer …" } } }
export const PROTOCOL_VERSION = '2024-11-05'; // shared by the MCP client (here) and server (mcp-server.ts)
const MAX_BUF = 16 * 1024 * 1024; // กัน server ส่ง byte ยาวไม่มี newline → memory โต unbounded
const REQUEST_TIMEOUT = 20_000;
export const MAX_MCP_TOOL_OUTPUT_CHARS = 200_000;

// env ปลอดภัยที่ส่งให้ MCP child (ไม่มี secret) — server ที่ต้อง token ให้ตั้งใน cfg.env เอง
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'TERM', 'NODE_PATH', 'NVM_DIR', 'APPDATA'];
function safeEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SAFE_ENV_KEYS) {
    const v = process.env[k];
    if (v != null) out[k] = v;
  }
  return out;
}

interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** remote MCP (Streamable-HTTP) — มี url = ใช้ http transport, ไม่งั้น stdio */
  url?: string;
  headers?: Record<string, string>;
}
interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}
interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export function isValidMcpServerName(name: string): boolean {
  return (
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name) &&
    !['__proto__', 'prototype', 'constructor'].includes(name)
  );
}

export function capMcpToolOutput(text: string, max = MAX_MCP_TOOL_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  const omitted = text.length - max;
  return `${text.slice(0, max)}\n\n[MCP output truncated: ${omitted} chars omitted]`;
}

/** transport = ส่ง JSON-RPC request/notify ให้ server (stdio หรือ http) */
interface Transport {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  close(): void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** stdio transport — JSON-RPC 2.0, newline-delimited ผ่าน child process stdin/stdout */
class StdioTransport implements Transport {
  private proc: ChildProcess;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private dead = false;
  private stderrTail = '';

  constructor(cfg: McpServerConfig) {
    this.proc = spawn(cfg.command!, cfg.args ?? [], {
      // minimal env เท่านั้น (PATH/HOME/locale) + cfg.env ที่ user ตั้งเอง — ไม่ส่ง secret
      // (ANTHROPIC_API_KEY/TELEGRAM_BOT_TOKEN/ฯลฯ) ให้ทุก MCP server (supply chain = npx -y <pkg>)
      env: { ...safeEnv(), ...cfg.env },
      // Windows: `npx`/`npm`/JS bins เป็น .cmd shim → spawn ตรงๆ = ENOENT. shell=true ให้ผ่าน PATHEXT.
      // (config นี้ user เป็นเจ้าของ/trust แล้ว — bare-name resolution เท่านั้น)
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout?.on('data', (d: Buffer) => this.onData(d.toString()));
    // ต้อง drain stderr — piped ไว้แต่ไม่อ่าน = OS pipe buffer (~64KB) เต็ม → server บล็อกตอนเขียน log = แฮงค์
    // เก็บหางไว้ ~2KB ช่วย debug ว่า server ตายเพราะอะไร
    this.proc.stderr?.on('data', (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-2000);
    });
    this.proc.on('error', () => this.fail('spawn error'));
    this.proc.on('exit', () => this.fail(this.stderrTail.trim() ? `server exited — ${this.stderrTail.trim().split('\n').pop()}` : 'server exited'));
    this.proc.stdin?.on('error', () => {}); // กัน EPIPE
  }

  private fail(reason: string): void {
    this.dead = true;
    for (const p of this.pending.values()) p.reject(new Error(`mcp: ${reason}`));
    this.pending.clear();
  }

  private onData(s: string): void {
    this.buf += s;
    if (this.buf.length > MAX_BUF) {
      this.fail('response ใหญ่เกิน (ไม่มี newline)');
      this.close();
      return;
    }
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

  request(method: string, params?: unknown, timeoutMs = REQUEST_TIMEOUT): Promise<unknown> {
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

  notify(method: string, params?: unknown): void {
    this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  close(): void {
    try {
      this.proc.kill();
    } catch {
      /* ตายแล้ว */
    }
  }
}

/** Streamable-HTTP transport — POST JSON-RPC ต่อ request, รับ application/json หรือ text/event-stream */
class HttpTransport implements Transport {
  private nextId = 1;
  private sessionId?: string;
  constructor(
    private readonly url: string,
    private readonly userHeaders: Record<string, string> = {},
  ) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...this.userHeaders,
    };
  }

  /** parse SSE body หา JSON-RPC response ที่ id ตรง (Streamable-HTTP คืน response ผ่าน event-stream ได้) */
  private parseSse(text: string, id: number): unknown {
    for (const block of text.split(/\n\n/)) {
      const data = block
        .split(/\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (!data) continue;
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(data);
      } catch {
        continue; // block นี้ไม่ใช่ JSON สมบูรณ์ → ข้ามไป block ถัดไป (ไม่ abort ทั้ง stream)
      }
      // MCP protocol error / return อยู่นอก try → ไม่ถูกกลบโดย catch ของ JSON.parse
      if (msg.id === id) {
        if (msg.error) throw new Error(msg.error.message ?? 'mcp error');
        return msg.result;
      }
    }
    throw new Error('mcp http: ไม่พบ response ใน event-stream');
  }

  async request(method: string, params?: unknown, timeoutMs = REQUEST_TIMEOUT): Promise<unknown> {
    const id = this.nextId++;
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (!res.ok) throw new Error(`mcp http ${res.status} ${res.statusText}`);
    const ctype = res.headers.get('content-type') ?? '';
    if (ctype.includes('text/event-stream')) return this.parseSse(await res.text(), id);
    const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message ?? 'mcp error');
    return json.result;
  }

  notify(method: string, params?: unknown): void {
    void fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    }).catch(() => {});
  }

  close(): void {
    if (!this.sessionId) return;
    // best-effort terminate session (spec: DELETE) — ไม่รอผล
    void fetch(this.url, { method: 'DELETE', headers: this.headers() }).catch(() => {});
  }
}

/** MCP client — เลือก transport จาก config (url = http, ไม่งั้น stdio) แล้ว handshake + เรียก tool */
class McpClient {
  private transport: Transport;
  constructor(cfg: McpServerConfig) {
    this.transport = cfg.url ? new HttpTransport(cfg.url, cfg.headers) : new StdioTransport(cfg);
  }

  async initialize(): Promise<void> {
    await this.transport.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: BRAND.mcpClientName, version: VERSION },
    });
    this.transport.notify('notifications/initialized');
  }

  async listTools(): Promise<McpToolDef[]> {
    const r = (await this.transport.request('tools/list')) as { tools?: McpToolDef[] };
    return r?.tools ?? [];
  }

  async callTool(name: string, args: unknown): Promise<string> {
    const r = (await this.transport.request('tools/call', { name, arguments: args ?? {} })) as {
      content?: { type?: string; text?: string }[];
      isError?: boolean;
    };
    const text = (r?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    const capped = capMcpToolOutput(text);
    return r?.isError ? `MCP error: ${capped}` : capped || '(no output)';
  }

  close(): void {
    this.transport.close();
  }
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof k === 'string' && typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeMcpServerConfig(raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const cfg: McpServerConfig = {};
  if (typeof r.command === 'string' && r.command) cfg.command = r.command;
  if (Array.isArray(r.args) && r.args.every((a) => typeof a === 'string')) cfg.args = r.args;
  if (typeof r.url === 'string' && r.url) cfg.url = r.url;
  const env = stringRecord(r.env);
  if (env) cfg.env = env;
  const headers = stringRecord(r.headers);
  if (headers) cfg.headers = headers;
  return cfg.command || cfg.url ? cfg : null;
}

async function readMcpFile(path: string, merged: Record<string, McpServerConfig>): Promise<void> {
  const cfg = JSON.parse(await readFile(path, 'utf8')) as McpConfig;
  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') return;
  for (const [name, raw] of Object.entries(cfg.mcpServers)) {
    if (!isValidMcpServerName(name)) continue;
    const server = sanitizeMcpServerConfig(raw);
    if (server) merged[name] = server;
  }
}

export async function loadMcpConfig(onLog?: (m: string) => void, cwd: string = process.cwd()): Promise<Record<string, McpServerConfig>> {
  const merged: Record<string, McpServerConfig> = {};
  try {
    await readMcpFile(appHomePath('mcp.json'), merged);
  } catch {
    /* ไม่มี global config = ข้าม */
  }
  const root = await projectRoot(cwd);
  const projectPath = await projectConfigPathIfTrusted('mcp.json', root);
  if (projectPath) {
    try {
      await readMcpFile(projectPath, merged);
    } catch (e) {
      onLog?.(`project MCP config อ่านไม่ได้: ${(e as Error).message}`);
    }
  } else if (await hasUntrustedProjectConfig('mcp.json', root)) {
    onLog?.(`project MCP config ถูกข้าม (ยังไม่ trust): ${appProjectPath(root, 'mcp.json')}`);
  }
  return merged;
}

let cachePromise: Promise<ToolSet> | null = null;
let activeClients: McpClient[] = []; // sync ref สำหรับ closeMcp ใน exit handler

/** โหลด tools จาก MCP servers — in-flight promise singleton (concurrent call ไม่ spawn ซ้ำ/leak child) */
export function getMcpTools(onLog?: (m: string) => void): Promise<ToolSet> {
  cachePromise ??= buildMcpTools(onLog);
  return cachePromise;
}

async function buildMcpTools(onLog?: (m: string) => void): Promise<ToolSet> {
  const config = await loadMcpConfig(onLog);
  if (!Object.keys(config).length) return {};
  const tools: Record<string, ReturnType<typeof dynamicTool>> = {};
  const clients: McpClient[] = [];
  activeClients = clients; // ref เดียวกัน → closeMcp kill client ที่ spawn ระหว่าง build ได้ด้วย
  for (const [serverName, cfg] of Object.entries(config)) {
    if (!cfg.url && !cfg.command) {
      onLog?.(`MCP "${serverName}" ข้าม: ต้องมี "command" (stdio) หรือ "url" (remote)`);
      continue;
    }
    try {
      const client = new McpClient(cfg);
      clients.push(client); // push ทันที (อาจ spawn แล้ว) ก่อน await → ไม่ leak ถ้า build ค้าง
      await client.initialize();
      const defs = await client.listTools();
      for (const def of defs) {
        const toolName = `${serverName}__${def.name}`.replace(/[^a-zA-Z0-9_]/g, '_');
        if (toolName in tools) {
          onLog?.(`MCP tool ชนชื่อ: ${toolName} (ข้าม)`); // กัน silent overwrite
          continue;
        }
        tools[toolName] = dynamicTool({
          description: def.description ?? `${serverName}: ${def.name}`,
          inputSchema: jsonSchema(
            (def.inputSchema as Parameters<typeof jsonSchema>[0]) ?? { type: 'object', properties: {} },
          ),
          execute: async (args) => client.callTool(def.name, args),
        });
      }
      onLog?.(`MCP "${serverName}" (${cfg.url ? 'http' : 'stdio'}): ${defs.length} tools`);
    } catch (e) {
      onLog?.(`MCP "${serverName}" ต่อไม่ได้: ${(e as Error).message}`);
    }
  }
  return tools;
}

export function closeMcp(): void {
  for (const c of activeClients) c.close();
  activeClients = [];
  cachePromise = null;
}
