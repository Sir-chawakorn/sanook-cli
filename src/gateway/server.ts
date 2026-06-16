import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ModelMessage } from 'ai';
import { listTasks, enqueueTask } from './ledger.js';
import { parseSchedule } from './schedule.js';
import { tokenMatches } from './auth.js';
import { runAgent } from '../loop.js';
import { redactKey } from '../providers/keys.js';
import { BRAND } from '../brand.js';

type AgentRunner = (opts: Parameters<typeof runAgent>[0]) => ReturnType<typeof runAgent>;

export interface ServerOpts {
  port: number;
  token: string;
  defaultModel: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  onLog?: (msg: string) => void;
  runner?: AgentRunner;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendSse(res: ServerResponse, body: unknown): void {
  res.write(`data: ${typeof body === 'string' ? body : JSON.stringify(body)}\n\n`);
}

const MAX_BODY = 1_000_000; // 1MB กัน memory blowup

/** error ที่พก HTTP status — ให้ client เห็น 400/413 (client error) แทน 500 (server error) */
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'request body ใหญ่เกิน'); // Payload Too Large
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid JSON body'); // Bad Request — ไม่ leak ข้อความ parser
  }
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

/**
 * gateway HTTP — bind 127.0.0.1 เท่านั้น (loopback, ไม่ expose ออกเน็ต), ทุก endpoint ยกเว้น /health ต้อง bearer token
 * endpoints: GET /health · POST /v1/chat/completions (OpenAI-compat) · GET|POST /tasks
 * NOTE: payload จาก HTTP = ของ caller ที่ถือ token (= เจ้าของเครื่อง) — แต่ content ที่ agent อ่านยังเป็น "data" ตาม shield ปกติ
 */
export function startServer(opts: ServerOpts): () => void {
  const server = createServer((req, res) => {
    // redact กัน API key/secret รั่วใน error response (provider error อาจฝัง key)
    void handle(req, res, opts).catch((err) =>
      send(res, (err as { status?: number }).status ?? 500, { error: redactKey((err as Error).message ?? String(err)) }),
    );
  });
  // '127.0.0.1' = loopback only — สำคัญ: ห้าม 0.0.0.0 (จะเปิดให้ทั้ง LAN)
  server.listen(opts.port, '127.0.0.1', () => opts.onLog?.(`http://127.0.0.1:${opts.port} (loopback)`));
  return () => server.close();
}

async function handle(req: IncomingMessage, res: ServerResponse, opts: ServerOpts): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  // /health = public (เช็คว่า process alive โดยไม่ต้องมี token)
  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, service: BRAND.gatewayServiceName });
  }

  // ทุก endpoint อื่น → bearer token
  const auth = req.headers.authorization ?? '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (!tokenMatches(opts.token, provided)) {
    return send(res, 401, { error: 'unauthorized' });
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const body = await readBody(req);
    const raw = Array.isArray(body.messages) ? (body.messages as { role: string; content: unknown }[]) : [];
    const msgs = raw.filter(
      (m) => typeof m.content === 'string' && ['user', 'assistant', 'system'].includes(m.role),
    );
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user');
    if (lastUserIdx === -1) return send(res, 400, { error: 'ต้องมี user message' });
    const prompt = msgs[lastUserIdx].content as string;
    // turn ก่อน user ตัวสุดท้าย = history (multi-turn) — เดิม endpoint ทิ้งหมด (stateless = ลืม context)
    const history = msgs
      .slice(0, lastUserIdx)
      .map((m) => ({ role: m.role, content: m.content as string })) as ModelMessage[];
    const model = typeof body.model === 'string' && body.model ? body.model : opts.defaultModel;
    const runner = opts.runner ?? runAgent;
    if (body.stream === true) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      sendSse(res, {
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
      });
      try {
        await runner({
          model,
          prompt,
          history,
          maxSteps: 20,
          budgetUsd: opts.budgetUsd,
          permissionMode: opts.permissionMode ?? 'ask',
          onEvent: (e) => {
            if (e.type !== 'text' || !e.text) return;
            sendSse(res, {
              object: 'chat.completion.chunk',
              model,
              choices: [{ index: 0, delta: { content: e.text }, finish_reason: null }],
            });
          },
        });
        sendSse(res, { object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        sendSse(res, '[DONE]');
      } catch (e) {
        sendSse(res, { error: redactKey((e as Error).message ?? String(e)) });
        sendSse(res, '[DONE]');
      }
      res.end();
      return;
    }

    const { text } = await runner({
      model,
      prompt,
      history,
      maxSteps: 20,
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
    });
    return send(res, 200, {
      object: 'chat.completion',
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    });
  }

  if (req.method === 'GET' && url.pathname === '/tasks') {
    return send(res, 200, { tasks: await listTasks() });
  }

  if (req.method === 'POST' && url.pathname === '/tasks') {
    const body = await readBody(req);
    const spec = String(body.spec ?? '').trim();
    if (!spec) return send(res, 400, { error: 'ต้องมี spec' });
    const sched = body.schedule ? parseSchedule(String(body.schedule), Date.now()) : null;
    if (body.schedule && !sched) return send(res, 400, { error: `schedule ไม่ถูกต้อง: ${String(body.schedule)}` });
    const task = await enqueueTask({
      kind: sched?.recurring ? 'cron' : 'once',
      spec,
      schedule: sched?.recurring ? sched.normalized : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
      runAt: sched?.runAt ?? Date.now(),
    });
    return send(res, 201, { task });
  }

  send(res, 404, { error: 'not found' });
}
