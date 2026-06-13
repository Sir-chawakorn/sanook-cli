import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { TaskLedger } from './ledger.js';
import { parseSchedule } from './schedule.js';
import { tokenMatches } from './auth.js';
import { runAgent } from '../loop.js';

export interface ServerOpts {
  port: number;
  token: string;
  defaultModel: string;
  budgetUsd?: number;
  onLog?: (msg: string) => void;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const MAX_BODY = 1_000_000; // 1MB กัน memory blowup

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error('request body ใหญ่เกิน');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

/**
 * gateway HTTP — bind 127.0.0.1 เท่านั้น (loopback, ไม่ expose ออกเน็ต), ทุก endpoint ยกเว้น /health ต้อง bearer token
 * endpoints: GET /health · POST /v1/chat/completions (OpenAI-compat) · GET|POST /tasks
 * NOTE: payload จาก HTTP = ของ caller ที่มี token (= ปิ๊กเอง) — แต่ content ที่ agent อ่านยังเป็น "data" ตาม shield ปกติ
 */
export function startServer(opts: ServerOpts): () => void {
  const server = createServer((req, res) => {
    void handle(req, res, opts).catch((err) => send(res, 500, { error: (err as Error).message }));
  });
  // '127.0.0.1' = loopback only — สำคัญ: ห้าม 0.0.0.0 (จะเปิดให้ทั้ง LAN)
  server.listen(opts.port, '127.0.0.1', () => opts.onLog?.(`http://127.0.0.1:${opts.port} (loopback)`));
  return () => server.close();
}

async function handle(req: IncomingMessage, res: ServerResponse, opts: ServerOpts): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  // /health = public (เช็คว่า process alive โดยไม่ต้องมี token)
  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, service: 'sanook-gateway' });
  }

  // ทุก endpoint อื่น → bearer token
  const auth = req.headers.authorization ?? '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (!tokenMatches(opts.token, provided)) {
    return send(res, 401, { error: 'unauthorized' });
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const body = await readBody(req);
    const messages = Array.isArray(body.messages) ? (body.messages as { role: string; content: unknown }[]) : [];
    const lastUser = messages.filter((m) => m.role === 'user').pop();
    const prompt = typeof lastUser?.content === 'string' ? lastUser.content : '';
    if (!prompt) return send(res, 400, { error: 'ต้องมี user message' });
    const model = typeof body.model === 'string' && body.model ? body.model : opts.defaultModel;
    const { text } = await runAgent({ model, prompt, maxSteps: 20, budgetUsd: opts.budgetUsd });
    return send(res, 200, {
      object: 'chat.completion',
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    });
  }

  if (req.method === 'GET' && url.pathname === '/tasks') {
    const ledger = await TaskLedger.open();
    return send(res, 200, { tasks: ledger.list() });
  }

  if (req.method === 'POST' && url.pathname === '/tasks') {
    const body = await readBody(req);
    const spec = String(body.spec ?? '').trim();
    if (!spec) return send(res, 400, { error: 'ต้องมี spec' });
    const sched = body.schedule ? parseSchedule(String(body.schedule), Date.now()) : null;
    if (body.schedule && !sched) return send(res, 400, { error: `schedule ไม่ถูกต้อง: ${String(body.schedule)}` });
    const ledger = await TaskLedger.open();
    const task = await ledger.enqueue({
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
