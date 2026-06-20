// Web terminal backend for the dashboard.
//
//  • Agent console — POST /api/terminal/run streams the Sanook agent over SSE (reuses runAgent),
//    forwarding text/reasoning/tool events plus 🧠 remember facts and ✨ auto-created skills, exactly
//    like the REPL. Multi-turn history is kept server-side per browser session id (localhost, single user).
//
//  • Raw shell — ws + node-pty are OPTIONAL deps. shellStatus() reports availability; attachShell()
//    upgrades ws://…/api/terminal/shell to a real PTY when both are installed, else the UI degrades.
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { ModelMessage } from 'ai';
import { runAgent, type AgentEvent } from '../loop.js';
import { loadConfig } from '../config.js';
import { redactKey } from '../providers/keys.js';
import { describeToolCall } from '../ui/tool-activity.js';

const HISTORY = new Map<string, ModelMessage[]>(); // sessionId → conversation (localhost single-user)
const MAX_HISTORY_SESSIONS = 20;

function sseSend(res: ServerResponse, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** POST /api/terminal/run — body {prompt, sessionId, autoApprove?} → SSE stream of agent events */
export async function handleTerminalRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : 'web';
  const autoApprove = body.autoApprove !== false; // default true (localhost = same trust as running CLI)

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  if (!prompt) {
    sseSend(res, { type: 'error', message: 'empty prompt' });
    sseSend(res, { type: 'done' });
    res.end();
    return;
  }

  const config = await loadConfig({});
  const model = config.model;
  const history = HISTORY.get(sessionId) ?? [];
  const rememberedFacts: string[] = [];
  sseSend(res, { type: 'status', detail: `Agent · ${model}` });

  try {
    const { messages } = await runAgent({
      model,
      prompt,
      history,
      maxSteps: 20,
      permissionMode: autoApprove ? 'auto' : 'ask',
      usageMeta: { sessionId: `web:${sessionId}`, source: 'repl' },
      onEvent: (e: AgentEvent) => {
        switch (e.type) {
          case 'text':
            if (e.text) sseSend(res, { type: 'text', text: e.text });
            break;
          case 'reasoning':
            if (e.text) sseSend(res, { type: 'reasoning', text: e.text });
            break;
          case 'tool-call': {
            if (e.tool === 'remember') {
              const fact = (e.detail as { fact?: unknown } | undefined)?.fact;
              if (typeof fact === 'string' && fact.trim()) rememberedFacts.push(fact.trim());
            }
            const activity = describeToolCall(e.tool ?? 'tool', e.detail);
            sseSend(res, { type: 'tool-call', tool: e.tool, title: activity.title, diff: activity.diff ?? null });
            break;
          }
          case 'tool-result':
            sseSend(res, { type: 'tool-result', tool: e.tool });
            break;
          case 'status':
            if (typeof e.detail === 'string') sseSend(res, { type: 'status', detail: e.detail });
            break;
          case 'error':
            sseSend(res, { type: 'error', message: redactKey(String(e.detail ?? e.text ?? 'error')) });
            break;
        }
      },
    });

    HISTORY.set(sessionId, messages);
    if (HISTORY.size > MAX_HISTORY_SESSIONS) HISTORY.delete([...HISTORY.keys()][0]);

    for (const fact of rememberedFacts) sseSend(res, { type: 'memory', fact });

    // ✨ self-improvement (same path as REPL/headless)
    try {
      const { maybeAutoSkill } = await import('../self-improve.js');
      const { defaultSkillSynthesizer } = await import('../self-improve-synth.js');
      const { loadSkills, saveSkill } = await import('../skills.js');
      const existing = new Set((await loadSkills()).map((s) => s.name));
      const auto = await maybeAutoSkill(prompt, { synthesize: defaultSkillSynthesizer(model), saveSkill, existingSkillNames: existing });
      if (auto.created && auto.skillName) sseSend(res, { type: 'skill', name: auto.skillName, count: auto.count });
    } catch {
      /* best-effort */
    }
  } catch (err) {
    sseSend(res, { type: 'error', message: redactKey((err as Error).message) });
  }
  sseSend(res, { type: 'done' });
  res.end();
}

export function resetTerminalSession(sessionId: string): void {
  HISTORY.delete(sessionId);
}

// ---- Raw shell (optional node-pty + ws) ------------------------------------

let shellAvailability: { available: boolean; reason: string } | null = null;

// computed specifiers so TS/bundler don't statically resolve these optional, possibly-absent deps
const PTY_MODULE = 'node-pty';
const WS_MODULE = 'ws';

export async function shellStatus(): Promise<{ available: boolean; reason: string }> {
  if (shellAvailability) return shellAvailability;
  const missing: string[] = [];
  try {
    await import(PTY_MODULE);
  } catch {
    missing.push('node-pty');
  }
  try {
    await import(WS_MODULE);
  } catch {
    missing.push('ws');
  }
  shellAvailability = missing.length
    ? { available: false, reason: `ติดตั้ง dependency เสริมก่อน: npm i ${missing.join(' ')}` }
    : { available: true, reason: 'ready' };
  return shellAvailability;
}

interface PtyLike {
  onData(cb: (data: string) => void): void;
  onExit(cb: () => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

/** Attach a ws upgrade handler for the raw shell at /api/terminal/shell. No-op if deps missing. */
export async function attachShell(server: Server): Promise<void> {
  const status = await shellStatus();
  if (!status.available) return;
  // dynamic import keeps node-pty/ws optional at build/runtime
  const pty = (await import(PTY_MODULE)) as unknown as {
    spawn(file: string, args: string[], opts: Record<string, unknown>): PtyLike;
  };
  const wsmod = (await import(WS_MODULE)) as unknown as { WebSocketServer: new (opts: { noServer: boolean }) => WsServerLike };
  const wss = new wsmod.WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname !== '/api/terminal/shell') return;
    wss.handleUpgrade(req, socket as never, head, (ws: WsLike) => {
      const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';
      const term = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || process.cwd(),
        env: process.env,
      });
      term.onData((data) => ws.send(JSON.stringify({ type: 'data', data })));
      term.onExit(() => ws.close());
      ws.on('message', (raw: unknown) => {
        try {
          const msg = JSON.parse(String(raw)) as { type: string; data?: string; cols?: number; rows?: number };
          if (msg.type === 'data' && typeof msg.data === 'string') term.write(msg.data);
          else if (msg.type === 'resize' && msg.cols && msg.rows) term.resize(msg.cols, msg.rows);
        } catch {
          /* ignore malformed frame */
        }
      });
      ws.on('close', () => term.kill());
    });
  });
}

interface WsLike {
  send(data: string): void;
  close(): void;
  on(event: string, cb: (arg: unknown) => void): void;
}
interface WsServerLike {
  handleUpgrade(req: IncomingMessage, socket: never, head: Buffer, cb: (ws: WsLike) => void): void;
}
