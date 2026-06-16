import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ModelMessage } from 'ai';
import { listTasks, enqueueTask } from './ledger.js';
import { parseSchedule } from './schedule.js';
import { formatTarget, parseSendTarget } from './targets.js';
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

function sendRaw(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

function sendSse(res: ServerResponse, body: unknown): void {
  res.write(`data: ${typeof body === 'string' ? body : JSON.stringify(body)}\n\n`);
}

export function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseOptionalSchedule(
  value: unknown,
  now: number,
): { schedule: ReturnType<typeof parseSchedule>; invalid?: string } {
  const scheduleText = optionalString(value);
  const hasScheduleInput = typeof value === 'string' ? scheduleText !== undefined : Boolean(value);
  if (!hasScheduleInput) return { schedule: null };

  const schedule = scheduleText ? parseSchedule(scheduleText, now) : null;
  return schedule ? { schedule } : { schedule: null, invalid: String(value) };
}

export function parseOptionalDeliverTarget(value: unknown): { deliver?: string; invalid?: string } {
  const deliverText = optionalString(value);
  if (!deliverText) return {};
  try {
    return { deliver: formatTarget(parseSendTarget(deliverText)) };
  } catch (e) {
    return { invalid: (e as Error).message };
  }
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
  const raw = await readRawBody(req);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid JSON body'); // Bad Request — ไม่ leak ข้อความ parser
  }
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'request body ใหญ่เกิน'); // Payload Too Large
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
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

  if (req.method === 'GET' && url.pathname === '/line/webhook/health') {
    return send(res, 200, { status: 'ok', platform: 'line' });
  }

  if (req.method === 'GET' && url.pathname === '/sms/webhook/health') {
    return send(res, 200, { status: 'ok', platform: 'sms' });
  }

  if (req.method === 'GET' && url.pathname === '/whatsapp/webhook/health') {
    const { readGatewayConfig, resolveWhatsAppConfig } = await import('./config.js');
    const whatsapp = resolveWhatsAppConfig(await readGatewayConfig());
    return send(res, 200, {
      status: 'ok',
      platform: 'whatsapp',
      phone_number_id_configured: Boolean(whatsapp.phoneNumberId),
      access_token_configured: Boolean(whatsapp.accessToken),
      app_secret_configured: Boolean(whatsapp.appSecret),
      verify_token_configured: Boolean(whatsapp.verifyToken),
    });
  }

  if (req.method === 'GET' && url.pathname === '/webhooks/health') {
    return send(res, 200, { status: 'ok', platform: 'webhook' });
  }

  if (req.method === 'POST' && url.pathname === '/line/webhook') {
    const rawBody = await readRawBody(req);
    const signature = Array.isArray(req.headers['x-line-signature']) ? req.headers['x-line-signature'][0] : req.headers['x-line-signature'];
    const { readGatewayConfig, resolveLineConfig } = await import('./config.js');
    const { handleLineWebhook } = await import('./line.js');
    const result = await handleLineWebhook({
      rawBody,
      signature,
      config: resolveLineConfig(await readGatewayConfig()),
      model: opts.defaultModel,
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
      onLog: opts.onLog,
    });
    return send(res, result.status, result.body);
  }

  if (req.method === 'POST' && url.pathname === '/sms/webhook') {
    const rawBody = await readRawBody(req);
    const signature = Array.isArray(req.headers['x-twilio-signature']) ? req.headers['x-twilio-signature'][0] : req.headers['x-twilio-signature'];
    const { readGatewayConfig, resolveSmsConfig } = await import('./config.js');
    const { handleSmsWebhook } = await import('./sms.js');
    const result = await handleSmsWebhook({
      rawBody,
      signature,
      config: resolveSmsConfig(await readGatewayConfig()),
      model: opts.defaultModel,
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
      onLog: opts.onLog,
    });
    return sendRaw(res, result.status, result.contentType, result.body);
  }

  if (req.method === 'GET' && url.pathname === '/whatsapp/webhook') {
    const { readGatewayConfig, resolveWhatsAppConfig } = await import('./config.js');
    const { handleWhatsAppChallenge } = await import('./whatsapp.js');
    const result = handleWhatsAppChallenge(resolveWhatsAppConfig(await readGatewayConfig()), url.searchParams);
    return sendRaw(res, result.status, result.contentType, result.body);
  }

  if (req.method === 'POST' && url.pathname === '/whatsapp/webhook') {
    const rawBody = await readRawBody(req);
    const signature = Array.isArray(req.headers['x-hub-signature-256']) ? req.headers['x-hub-signature-256'][0] : req.headers['x-hub-signature-256'];
    const { readGatewayConfig, resolveWhatsAppConfig } = await import('./config.js');
    const { handleWhatsAppWebhook } = await import('./whatsapp.js');
    const result = await handleWhatsAppWebhook({
      rawBody,
      signature,
      config: resolveWhatsAppConfig(await readGatewayConfig()),
      model: opts.defaultModel,
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
      onLog: opts.onLog,
    });
    return send(res, result.status, result.body);
  }

  if (req.method === 'POST' && url.pathname.startsWith('/webhooks/')) {
    const routeName = decodeURIComponent(url.pathname.slice('/webhooks/'.length)).replace(/^\/+|\/+$/g, '');
    const rawBody = await readRawBody(req);
    const { readGatewayConfig, resolveWebhookConfig } = await import('./config.js');
    const { handleWebhookRequest } = await import('./webhooks.js');
    const result = await handleWebhookRequest({
      routeName,
      rawBody,
      headers: req.headers,
      config: resolveWebhookConfig(await readGatewayConfig()),
      model: opts.defaultModel,
      budgetUsd: opts.budgetUsd,
      permissionMode: opts.permissionMode ?? 'ask',
      onLog: opts.onLog,
    });
    return send(res, result.status, result.body);
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
    const model = optionalString(body.model) ?? opts.defaultModel;
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
    const { schedule: sched, invalid } = parseOptionalSchedule(body.schedule, Date.now());
    if (invalid) return send(res, 400, { error: `schedule ไม่ถูกต้อง: ${invalid}` });
    const { deliver, invalid: invalidDeliver } = parseOptionalDeliverTarget(body.deliver);
    if (invalidDeliver) return send(res, 400, { error: invalidDeliver });
    const task = await enqueueTask({
      kind: sched?.recurring ? 'cron' : 'once',
      spec,
      schedule: sched?.recurring ? sched.normalized : undefined,
      model: optionalString(body.model),
      deliver,
      runAt: sched?.runAt ?? Date.now(),
    });
    return send(res, 201, { task });
  }

  send(res, 404, { error: 'not found' });
}
