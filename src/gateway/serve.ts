import { loadOrCreateToken } from './auth.js';
import { startServer } from './server.js';
import { startScheduler } from './scheduler.js';

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
 * คืน stop() เพื่อปิดทั้งหมด (server + scheduler)
 */
export async function startGateway(opts: GatewayOpts): Promise<() => void> {
  const log = opts.onLog ?? ((m: string) => console.log(`[gateway] ${m}`));
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
  log(`scheduler tick ทุก ${(opts.tickMs ?? 60_000) / 1000}s · token: ~/.sanook/gateway/token (chmod 600)`);
  return () => {
    stopServer();
    stopScheduler();
  };
}
