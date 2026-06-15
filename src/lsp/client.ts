// ============================================================================
// src/lsp/client.ts — a minimal LSP CLIENT, transport-injected for testability.
//
// Scope is the coding agent's tight feedback loop: open a file, collect the
// language server's diagnostics (type errors / warnings), and hand them back so
// the agent can self-correct WITHOUT a full project build. The transport is
// injected (LspTransport), so the whole handshake + diagnostics-settle logic
// unit-tests against a fake server — no real language server, no child process.
//
// Robustness: we reply to server→client requests (configuration/registration/
// progress) with empty results so a server can't hang waiting on us; positions
// are converted from LSP's 0-based to human 1-based; diagnostics "settle" (a quiet
// period after the last publish) so we return the final set, not an early empty one.
// ============================================================================

export interface LspTransport {
  send(msg: unknown): void;
  onMessage(cb: (msg: LspMessage) => void): void;
  close(): void;
}

interface LspMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
}

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
  line: number; // 1-based
  character: number; // 1-based
  endLine: number; // 1-based
  severity: Severity;
  message: string;
  source?: string;
  code?: string | number;
}

const SEVERITY: Record<number, Severity> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };

interface RawDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
}

function toDiagnostic(d: RawDiagnostic): Diagnostic {
  return {
    line: d.range.start.line + 1,
    character: d.range.start.character + 1,
    endLine: d.range.end.line + 1,
    severity: SEVERITY[d.severity ?? 1] ?? 'info',
    message: d.message,
    source: d.source,
    code: d.code,
  };
}

/** normalize a file URI/path for comparison (servers may echo a slightly different form). */
function normUri(u: string): string {
  try {
    return decodeURIComponent(u).replace(/^file:\/\//, '').replace(/\/+$/, '');
  } catch {
    return u.replace(/^file:\/\//, '').replace(/\/+$/, '');
  }
}

export class LspSession {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private diagSubs = new Set<(uri: string, diags: RawDiagnostic[]) => void>();
  private closed = false;

  constructor(private readonly transport: LspTransport) {
    transport.onMessage((m) => this.onMessage(m));
  }

  private onMessage(msg: LspMessage): void {
    // a response to one of our requests
    if (msg.id != null && !msg.method && this.pending.has(msg.id as number)) {
      const p = this.pending.get(msg.id as number)!;
      this.pending.delete(msg.id as number);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'lsp error'));
      else p.resolve(msg.result);
      return;
    }
    // a notification we care about
    if (msg.method === 'textDocument/publishDiagnostics') {
      const params = msg.params as { uri?: unknown; diagnostics?: unknown };
      if (typeof params?.uri !== 'string') return;
      const diagnostics = Array.isArray(params.diagnostics) ? (params.diagnostics as RawDiagnostic[]) : [];
      for (const cb of this.diagSubs) cb(params.uri, diagnostics);
      return;
    }
    // a request FROM the server → must answer or it may stall; give an empty result
    if (msg.id != null && msg.method) {
      const result =
        msg.method === 'workspace/configuration'
          ? ((msg.params as { items?: unknown[] })?.items ?? []).map(() => null)
          : null;
      this.transport.send({ jsonrpc: '2.0', id: msg.id, result });
    }
  }

  request(method: string, params?: unknown, timeoutMs = 8000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('lsp: session closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`lsp timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.transport.send({ jsonrpc: '2.0', method, params });
  }

  /** handshake: initialize (diagnostics-only capabilities) + initialized. */
  async initialize(rootUri: string): Promise<void> {
    await this.request('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: { publishDiagnostics: { relatedInformation: false } },
        workspace: { configuration: true },
      },
      clientInfo: { name: 'sanook', version: '1' },
    });
    this.notify('initialized', {});
  }

  didOpen(uri: string, languageId: string, text: string, version = 1): void {
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId, version, text } });
  }

  /** subscribe to publishDiagnostics; returns an unsubscribe fn. */
  onDiagnostics(cb: (uri: string, diags: RawDiagnostic[]) => void): () => void {
    this.diagSubs.add(cb);
    return () => this.diagSubs.delete(cb);
  }

  async shutdown(): Promise<void> {
    try {
      await this.request('shutdown', undefined, 1500);
      this.notify('exit');
    } catch {
      /* server already gone */
    }
  }

  close(): void {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('lsp: session closed'));
    }
    this.pending.clear();
    this.diagSubs.clear();
    this.transport.close();
  }
}

export interface OpenDoc {
  uri: string;
  languageId: string;
  text: string;
}

export interface CollectOptions {
  settleMs?: number; // quiet period after the last publish before resolving
  timeoutMs?: number; // hard cap if the server never publishes
}

/**
 * Wait for a document's diagnostics to settle (does NOT open the doc — caller
 * sends didOpen/didChange). Servers often publish an empty set first then the real
 * one; we keep the latest and resolve after `settleMs` of quiet, or `timeoutMs`
 * regardless. Never rejects — a silent server yields []. Subscribe BEFORE you send
 * the open/change so no early publish is missed.
 */
export function waitForDiagnostics(session: LspSession, uri: string, opts: CollectOptions = {}): Promise<Diagnostic[]> {
  const settleMs = opts.settleMs ?? 400;
  const timeoutMs = opts.timeoutMs ?? 6000;
  return new Promise((resolve) => {
    let latest: Diagnostic[] | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const target = normUri(uri);

    const finish = (): void => {
      clearTimeout(overall);
      clearTimeout(settleTimer);
      unsub();
      resolve(latest ?? []);
    };
    const overall = setTimeout(finish, timeoutMs);
    const unsub = session.onDiagnostics((u, diags) => {
      if (normUri(u) !== target) return;
      latest = diags.map(toDiagnostic);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, settleMs);
    });
  });
}

/**
 * Open a document and resolve its diagnostics once they settle (didOpen + wait).
 * Convenience for the one-shot case (and the unit tests).
 */
export function collectDiagnostics(session: LspSession, doc: OpenDoc, opts: CollectOptions = {}): Promise<Diagnostic[]> {
  const p = waitForDiagnostics(session, doc.uri, opts);
  session.didOpen(doc.uri, doc.languageId, doc.text);
  return p;
}
