import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { acquireSingleton } from './lock.js';
import { loadOrCreateToken } from './auth.js';
import { startServer } from './server.js';
import { startScheduler } from './scheduler.js';

const GATEWAY_DIR = join(homedir(), '.sanook', 'gateway');
const SERVE_LOCK = join(GATEWAY_DIR, 'serve.lock');

export interface GatewayOpts {
  port: number;
  model: string;
  budgetUsd?: number;
  tickMs?: number;
  onLog?: (msg: string) => void;
}

/**
 * จุดเดียวที่ start ทั้ง gateway: HTTP server (รับ request 24/7) + scheduler (cron tick)
 * ทั้งคู่เรียก runAgent() core เดียวกัน — "platform differences live in the entry point, not the agent"
 * single-instance: ถ้ามี gateway อื่นรันอยู่ (serve.lock) → throw (กัน 2 scheduler แย่ง task กัน)
 * คืน stop() เพื่อปิดทั้งหมด (server + scheduler + ปล่อย lock)
 */
export async function startGateway(opts: GatewayOpts): Promise<() => void> {
  const log = opts.onLog ?? ((m: string) => console.log(`[gateway] ${m}`));
  await mkdir(GATEWAY_DIR, { recursive: true });

  const release = await acquireSingleton(SERVE_LOCK);
  if (!release) {
    throw new Error(
      'มี sanook gateway รันอยู่แล้ว (เจอ serve.lock) — ปิดตัวเดิมก่อน หรือถ้าค้างให้ลบ ~/.sanook/gateway/serve.lock',
    );
  }

  const token = await loadOrCreateToken();
  const stopServer = startServer({
    port: opts.port,
    token,
    defaultModel: opts.model,
    budgetUsd: opts.budgetUsd,
    onLog: log,
  });
  const stopScheduler = startScheduler({
    defaultModel: opts.model,
    budgetUsd: opts.budgetUsd,
    tickMs: opts.tickMs,
    onLog: log,
  });

  // Telegram channel (ถ้าตั้ง TELEGRAM_BOT_TOKEN) — long-polling, ไม่ต้อง public URL
  let stopTelegram: (() => void) | undefined;
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const { startTelegram, parseAllowedChats } = await import('./telegram.js');
    stopTelegram = startTelegram({
      token: process.env.TELEGRAM_BOT_TOKEN,
      model: opts.model,
      budgetUsd: opts.budgetUsd,
      allowedChatIds: parseAllowedChats(process.env.TELEGRAM_ALLOWED_CHATS),
      onLog: log,
    });
    log('Telegram: long-polling เริ่มแล้ว');
  }

  log(`scheduler tick ทุก ${(opts.tickMs ?? 60_000) / 1000}s · token: ~/.sanook/gateway/token (chmod 600)`);

  return () => {
    stopServer();
    stopScheduler();
    stopTelegram?.();
    release(); // ปล่อย single-instance lock (sync — ทันก่อน process.exit ตัด event loop)
  };
}
