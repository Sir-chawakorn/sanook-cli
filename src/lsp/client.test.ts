import { describe, it, expect } from 'vitest';
import { LspSession, collectDiagnostics, type LspTransport } from './client.js';

interface Msg {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

/** a fake language server: answers initialize, and on didOpen publishes diagnostics. */
function fakeServer(opts: { diagnostics?: unknown[]; askConfiguration?: boolean; publishEmptyFirst?: boolean } = {}) {
  let onMsg: (m: Msg) => void = () => {};
  const sent: Msg[] = [];
  const emit = (m: Msg): void => queueMicrotask(() => onMsg(m));
  const transport: LspTransport = {
    send: (raw) => {
      const m = raw as Msg;
      sent.push(m);
      if (m.method === 'initialize') {
        emit({ jsonrpc: '2.0', id: m.id, result: { capabilities: {} } });
        if (opts.askConfiguration) emit({ jsonrpc: '2.0', id: 9999, method: 'workspace/configuration', params: { items: [{}, {}] } });
      } else if (m.method === 'shutdown') {
        emit({ jsonrpc: '2.0', id: m.id, result: null });
      } else if (m.method === 'textDocument/didOpen') {
        const uri = (m.params as { textDocument: { uri: string } }).textDocument.uri;
        if (opts.publishEmptyFirst) emit({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } });
        emit({
          jsonrpc: '2.0',
          method: 'textDocument/publishDiagnostics',
          params: { uri, diagnostics: opts.diagnostics ?? [] },
        });
      }
    },
    onMessage: (cb) => {
      onMsg = cb as (m: Msg) => void;
    },
    close: () => {},
  };
  return { transport, sent };
}

const tsError = {
  range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
  severity: 1,
  message: "Type 'string' is not assignable to type 'number'.",
  source: 'ts',
  code: 2322,
};

describe('LspSession.initialize', () => {
  it('sends initialize then an initialized notification', async () => {
    const { transport, sent } = fakeServer();
    const s = new LspSession(transport);
    await s.initialize('file:///repo');
    expect(sent.find((m) => m.method === 'initialize')).toBeTruthy();
    expect(sent.find((m) => m.method === 'initialized')).toBeTruthy();
    s.close();
  });

  it('answers a server→client workspace/configuration request (so the server cannot stall)', async () => {
    const { transport, sent } = fakeServer({ askConfiguration: true });
    const s = new LspSession(transport);
    await s.initialize('file:///repo');
    await new Promise((r) => setTimeout(r, 10));
    const reply = sent.find((m) => m.id === 9999);
    expect(reply).toBeTruthy();
    expect(Array.isArray(reply!.result)).toBe(true); // [] for the 2 items → [null, null]
    s.close();
  });
});

describe('collectDiagnostics', () => {
  it('converts LSP 0-based positions to 1-based and maps severity', async () => {
    const { transport } = fakeServer({ diagnostics: [tsError] });
    const s = new LspSession(transport);
    await s.initialize('file:///repo');
    const diags = await collectDiagnostics(s, { uri: 'file:///repo/a.ts', languageId: 'typescript', text: 'x' }, { settleMs: 20 });
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ line: 3, character: 5, severity: 'error', source: 'ts', code: 2322 });
    s.close();
  });

  it('settles on the LATEST publish (empty-then-populated)', async () => {
    const { transport } = fakeServer({ diagnostics: [tsError], publishEmptyFirst: true });
    const s = new LspSession(transport);
    await s.initialize('file:///repo');
    const diags = await collectDiagnostics(s, { uri: 'file:///repo/a.ts', languageId: 'typescript', text: 'x' }, { settleMs: 30 });
    expect(diags).toHaveLength(1); // not the empty first publish
    s.close();
  });

  it('ignores diagnostics for a different file', async () => {
    let onMsg: (m: Msg) => void = () => {};
    const transport: LspTransport = {
      send: (raw) => {
        const m = raw as Msg;
        if (m.method === 'initialize') queueMicrotask(() => onMsg({ id: m.id, result: {} }));
        if (m.method === 'textDocument/didOpen') {
          // publish for the WRONG uri only
          queueMicrotask(() => onMsg({ method: 'textDocument/publishDiagnostics', params: { uri: 'file:///repo/other.ts', diagnostics: [tsError] } }));
        }
      },
      onMessage: (cb) => {
        onMsg = cb as (m: Msg) => void;
      },
      close: () => {},
    };
    const s = new LspSession(transport);
    await s.initialize('file:///repo');
    const diags = await collectDiagnostics(s, { uri: 'file:///repo/a.ts', languageId: 'typescript', text: 'x' }, { settleMs: 20, timeoutMs: 200 });
    expect(diags).toEqual([]); // none for a.ts → empty after the hard timeout
    s.close();
  });

  it('ignores malformed publishDiagnostics notifications instead of crashing', async () => {
    let onMsg: (m: Msg) => void = () => {};
    const transport: LspTransport = {
      send: (raw) => {
        const m = raw as Msg;
        if (m.method === 'initialize') queueMicrotask(() => onMsg({ id: m.id, result: {} }));
        if (m.method === 'textDocument/didOpen') {
          queueMicrotask(() => onMsg({ method: 'textDocument/publishDiagnostics', params: { diagnostics: [tsError] } }));
          queueMicrotask(() =>
            onMsg({
              method: 'textDocument/publishDiagnostics',
              params: { uri: 'file:///repo/%E0%A4%A', diagnostics: [] },
            }),
          );
        }
      },
      onMessage: (cb) => {
        onMsg = cb as (m: Msg) => void;
      },
      close: () => {},
    };
    const s = new LspSession(transport);
    await s.initialize('file:///repo');
    const diags = await collectDiagnostics(s, { uri: 'file:///repo/a.ts', languageId: 'typescript', text: 'x' }, { timeoutMs: 120 });
    expect(diags).toEqual([]);
    s.close();
  });

  it('a silent server yields [] (hard timeout, never rejects)', async () => {
    const transport: LspTransport = {
      send: (raw) => {
        const m = raw as Msg;
        if (m.method === 'initialize') queueMicrotask(() => onMsg({ id: m.id, result: {} }));
      },
      onMessage: (cb) => {
        onMsg = cb as (m: Msg) => void;
      },
      close: () => {},
    };
    let onMsg: (m: Msg) => void = () => {};
    const s = new LspSession(transport);
    await s.initialize('file:///repo');
    const diags = await collectDiagnostics(s, { uri: 'file:///repo/a.ts', languageId: 'typescript', text: 'x' }, { timeoutMs: 120 });
    expect(diags).toEqual([]);
    s.close();
  });
});
