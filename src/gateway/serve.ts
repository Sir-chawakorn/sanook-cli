import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireSingleton } from './lock.js';
import { loadOrCreateToken } from './auth.js';
import { startServer } from './server.js';
import { startScheduler } from './scheduler.js';
import { appHomePath, BRAND, BRAND_ENV, envFlag } from '../brand.js';
import { readGatewayConfig, resolveTelegramConfig } from './config.js';

const GATEWAY_DIR = appHomePath('gateway');
const SERVE_LOCK = join(GATEWAY_DIR, 'serve.lock');

export interface GatewayOpts {
  port: number;
  model: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
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
      `มี ${BRAND.cliName} gateway รันอยู่แล้ว (เจอ serve.lock) — ปิดตัวเดิมก่อน หรือถ้าค้างให้ลบ ${appHomePath('gateway', 'serve.lock')}`,
    );
  }

  const token = await loadOrCreateToken();
  const stopServer = startServer({
    port: opts.port,
    token,
    defaultModel: opts.model,
    budgetUsd: opts.budgetUsd,
    permissionMode: opts.permissionMode ?? (envFlag(BRAND_ENV.gatewayAllowWrite) ? 'auto' : 'ask'),
    onLog: log,
  });
  const stopScheduler = startScheduler({
    defaultModel: opts.model,
    budgetUsd: opts.budgetUsd,
    permissionMode: opts.permissionMode ?? (envFlag(BRAND_ENV.gatewayAllowWrite) ? 'auto' : 'ask'),
    tickMs: opts.tickMs,
    onLog: log,
  });

  // Telegram channel (env หรือ ~/.sanook/gateway/config.json) — long-polling, ไม่ต้อง public URL
  let stopTelegram: (() => void) | undefined;
  const gatewayConfig = await readGatewayConfig();
  const telegram = resolveTelegramConfig(gatewayConfig);
  if (telegram.enabled && telegram.token) {
    const { startTelegram, parseAllowedChats } = await import('./telegram.js');
    stopTelegram = startTelegram({
      token: telegram.token,
      model: opts.model,
      budgetUsd: opts.budgetUsd,
      allowedChatIds: process.env.TELEGRAM_ALLOWED_CHATS ? parseAllowedChats(process.env.TELEGRAM_ALLOWED_CHATS) : telegram.allowedChatIds,
      allowWrite: telegram.allowWrite,
      onLog: log,
    });
    // หมายเหตุ: log "เริ่มแล้ว" อยู่ใน startTelegram (success path) — ถ้า fail-closed จะ log "ไม่เริ่ม" แทน
  }

  log(`scheduler tick ทุก ${(opts.tickMs ?? 60_000) / 1000}s · token: ${appHomePath('gateway', 'token')} (chmod 600)`);

  return () => {
    stopServer();
    stopScheduler();
    stopTelegram?.();
    release(); // ปล่อย single-instance lock (sync — ทันก่อน process.exit ตัด event loop)
  };
}
