// ============================================================================
// src/mcp-server.ts — sanook's MCP SERVER (the strategic parity win).
//
// arra-oracle's entire value prop is "a queryable brain over MCP". sanook today
// is MCP CLIENT-ONLY (src/mcp.ts connects OUT to other servers). This module adds
// the server half over the SAME zero-dep JSON-RPC 2.0 newline framing and
// PROTOCOL_VERSION, so any MCP host (Claude Desktop, Cursor, another agent) can
// mount sanook's brain — BM25 over the second-brain vault + bi-temporal memory +
// sessions + skills, with optional BYOK semantic search — Node-native,
// Apache-2.0, no Bun, no SQLite, no native binary.
//
// STDOUT DISCIPLINE: stdout carries ONLY JSON-RPC frames. Every diagnostic goes
// to stderr (a stray stdout write corrupts the protocol stream). Launched by
// `sanook mcp serve`.
// ============================================================================
import { readFileSync } from 'node:fs';
import { PROTOCOL_VERSION } from './mcp.js';
import { BRAND } from './brand.js';
import { search, resetSearchCaches, type SearchMode, type SearchResult } from './search/engine.js';
import { reindex } from './search/indexer.js';
import { loadIndex } from './search/store.js';
import { loadVectors } from './search/embed-store.js';
import { indexStats, type SearchSource } from './search/index-core.js';
import { recall } from './knowledge.js';
import { appendMemory } from './memory.js';
import { NOTE_TYPE } from './memory-store.js';

const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const SERVER_NAME = `${BRAND.cliName}-brain`;
const log = (msg: string): void => void process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);

// ---- tool surface ----------------------------------------------------------
const SOURCES: SearchSource[] = ['memory', 'vault', 'session', 'skill'];

export const TOOLS = [
  {
    name: 'sanook_search',
    description:
      "Hybrid BM25 + optional semantic search across the user's second-brain vault, " +
      'bi-temporal memory, past sessions, and skills. Returns ranked, snippeted hits. ' +
      "mode 'auto' uses semantic when a BYOK embeddings key is configured, else BM25.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'natural-language or keyword query' },
        mode: { type: 'string', enum: ['auto', 'fts', 'semantic', 'hybrid'], description: "default 'auto'" },
        limit: { type: 'number', description: 'max hits (default 8)' },
        sources: { type: 'array', items: { type: 'string', enum: SOURCES }, description: 'restrict to these corpora' },
      },
      required: ['query'],
    },
  },
  {
    name: 'sanook_recall',
    description:
      'Quick keyword recall across memory + vault + skills + sessions (BM25, no network). ' +
      'Use at the start of a task to reuse prior knowledge.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'sanook_remember',
    description:
      'Persist an atomic fact/preference/decision across sessions (Merge-Don\'t-Append: ' +
      'dedups, supersedes contradictions, routes to the vault inbox).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'one concise atomic claim' },
        noteType: { type: 'string', enum: [...NOTE_TYPE], description: 'optional classification' },
      },
      required: ['text'],
    },
  },
  {
    name: 'sanook_index',
    description:
      'Incrementally (re)index the vault + live memory/sessions/skills into the search index. ' +
      'O(delta): only changed files are re-read. Run after editing the vault.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sanook_stats',
    description: 'Index health: document counts per source, term count, vault path, and vector/semantic status.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

// ---- tool implementations (return plain text for the MCP content block) -----
function formatResult(res: SearchResult): string {
  const head = `${res.hits.length} hit(s) · mode=${res.mode}${res.degraded ? ` (degraded: ${res.degraded})` : ''}`;
  if (!res.hits.length) return `${head}\n(no matches)`;
  const lines = res.hits.map((h) => {
    const title = h.title.trim();
    const body = title ? `${title} — ${h.snippet}` : h.snippet;
    const where = h.path ? `  (${h.path})` : '';
    return `[${h.source}] ${body}${where}`;
  });
  return `${head}\n${lines.join('\n')}`;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'sanook_search': {
      const query = String(args.query ?? '').trim();
      if (!query) return 'ERROR: query is required';
      const res = await search(query, {
        mode: (args.mode as SearchMode) ?? 'auto',
        limit: typeof args.limit === 'number' ? args.limit : 8,
        sources: Array.isArray(args.sources) ? (args.sources as SearchSource[]) : undefined,
      });
      return formatResult(res);
    }
    case 'sanook_recall': {
      const query = String(args.query ?? '').trim();
      if (!query) return 'ERROR: query is required';
      return recall(query);
    }
    case 'sanook_remember': {
      const text = String(args.text ?? '').trim();
      if (!text) return 'ERROR: text is required';
      const noteType = (NOTE_TYPE as readonly string[]).includes(String(args.noteType))
        ? (args.noteType as (typeof NOTE_TYPE)[number])
        : undefined;
      await appendMemory(text, noteType);
      // keep the persisted search index fresh so the next sanook_search sees this fact
      await reindex().catch((e) => log(`post-remember reindex failed: ${(e as Error).message}`));
      resetSearchCaches();
      return `OK: remembered — "${text}"`;
    }
    case 'sanook_index': {
      const r = await reindex();
      resetSearchCaches();
      return (
        `indexed: +${r.added} ~${r.updated} -${r.removed} (skipped ${r.skipped}) · ` +
        `memory=${r.memory} sessions=${r.sessions} skills=${r.skills} vectors=${r.vectors} · vault=${r.vaultPath ?? '(none)'}`
      );
    }
    case 'sanook_stats': {
      const { index } = await loadIndex();
      const stats = indexStats(index);
      const vectors = await loadVectors();
      const bySrc = Object.entries(stats.bySource)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      const vec = vectors.dim ? `${vectors.tag} (${vectors.ids.length} vecs, dim ${vectors.dim})` : 'none (BM25 only)';
      return `docs=${stats.docs} terms=${stats.terms} avgdl=${stats.avgdl.toFixed(1)}\nbySource: ${bySrc || '(empty)'}\nvectors: ${vec}`;
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ---- JSON-RPC 2.0 dispatch over stdio --------------------------------------
interface RpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

export async function handle(msg: RpcRequest): Promise<unknown | undefined> {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: VERSION },
      };
    case 'notifications/initialized':
      return undefined; // notification → no response
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
      try {
        const text = await callTool(name, args);
        return { content: [{ type: 'text', text }], isError: text.startsWith('ERROR:') };
      } catch (e) {
        return { content: [{ type: 'text', text: `error: ${(e as Error).message}` }], isError: true };
      }
    }
    default:
      throw rpcError(-32601, `method not found: ${msg.method}`);
  }
}

function rpcError(code: number, message: string): { code: number; message: string } {
  return { code, message };
}

const MAX_LINE = 16 * 1024 * 1024; // cap an un-terminated stdin line so a runaway host can't grow memory unbounded

/** start the stdio MCP server loop. Resolves when stdin closes. */
export function runMcpServer(): Promise<void> {
  return new Promise((resolve) => {
    let buf = '';
    const write = (obj: unknown): void => {
      try {
        process.stdout.write(`${JSON.stringify(obj)}\n`);
      } catch (e) {
        log(`stdout write failed: ${(e as Error).message}`); // never let a write fault escape the handler
      }
    };

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_LINE && !buf.includes('\n')) {
        log(`stdin line exceeded ${MAX_LINE} bytes with no newline — dropping`);
        buf = '';
        return;
      }
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg: RpcRequest;
        try {
          msg = JSON.parse(line) as RpcRequest;
        } catch {
          log(`dropping non-JSON line (${line.length} bytes)`);
          continue;
        }
        const id = msg.id;
        void handle(msg)
          .then((result) => {
            if (result === undefined || id == null) return; // notification → silent
            write({ jsonrpc: '2.0', id, result });
          })
          .catch((err: unknown) => {
            if (id == null) return;
            const e = (err ?? {}) as { code?: unknown; message?: unknown };
            const code = typeof e.code === 'number' ? e.code : -32603;
            const message = err instanceof Error ? err.message : typeof e.message === 'string' ? e.message : 'internal error';
            write({ jsonrpc: '2.0', id, error: { code, message } });
          });
      }
    });
    // resolve (and stop the server) on stream end/close OR error — an unhandled stdin
    // 'error' would otherwise crash the process AND leave this promise pending forever.
    const done = (): void => resolve();
    process.stdin.on('end', done);
    process.stdin.on('close', done);
    process.stdin.on('error', (e: Error) => {
      log(`stdin error: ${e.message}`);
      resolve();
    });
    log(`ready · ${TOOLS.length} tools · protocol ${PROTOCOL_VERSION}`);
  });
}
