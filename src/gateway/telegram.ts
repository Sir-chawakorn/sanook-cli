import { runAgent } from '../loop.js';
import { redactKey } from '../providers/keys.js';

// Telegram channel adapter — long-polling (ไม่ต้อง public URL, เหมาะ local gateway แบบ Hermes)
// รับข้อความ → runAgent (fresh) → ตอบกลับ. security: allowlist chat id (กันคนอื่นใช้ agent ของเรา)
const api = (token: string, method: string): string => `https://api.telegram.org/bot${token}/${method}`;

interface TgUpdate {
  update_id: number;
  message?: { text?: string; chat: { id: number }; from?: { username?: string } };
}

export interface TelegramOpts {
  token: string;
  model: string;
  budgetUsd?: number;
  allowedChatIds?: number[]; // ว่าง = อนุญาตทุกคน (ไม่แนะนำ)
  onLog?: (m: string) => void;
}

async function getUpdates(token: string, offset: number, signal: AbortSignal): Promise<TgUpdate[]> {
  const r = await fetch(`${api(token, 'getUpdates')}?offset=${offset}&timeout=30`, { signal });
  if (!r.ok) throw new Error(`getUpdates ${r.status}`);
  const j = (await r.json()) as { ok: boolean; result?: TgUpdate[] };
  return j.result ?? [];
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  // Telegram จำกัด 4096 ตัวอักษร/ข้อความ
  await fetch(api(token, 'sendMessage'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
  }).catch(() => {});
}

/** แยกว่า chat ได้รับอนุญาตไหม (allowlist) */
export function isAllowed(chatId: number, allowed?: number[]): boolean {
  if (!allowed || allowed.length === 0) return true; // ไม่ตั้ง = อนุญาตทุกคน
  return allowed.includes(chatId);
}

/** parse "123,456" → [123, 456] */
export function parseAllowedChats(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n));
}

/** start long-polling loop — คืน stop() */
export function startTelegram(opts: TelegramOpts): () => void {
  const ctrl = new AbortController();
  let stopped = false;
  if (!opts.allowedChatIds?.length) {
    opts.onLog?.('⚠ Telegram: ไม่ได้ตั้ง allowlist (TELEGRAM_ALLOWED_CHATS) — ใครก็คุยกับ agent ได้');
  }

  async function loop(): Promise<void> {
    let offset = 0;
    while (!stopped) {
      try {
        const updates = await getUpdates(opts.token, offset, ctrl.signal);
        for (const u of updates) {
          offset = u.update_id + 1;
          const text = u.message?.text;
          const chatId = u.message?.chat.id;
          if (!text || chatId == null) continue;
          if (!isAllowed(chatId, opts.allowedChatIds)) {
            opts.onLog?.(`Telegram: ปฏิเสธ chat ${chatId} (ไม่อยู่ใน allowlist)`);
            await sendMessage(opts.token, chatId, '⛔ ไม่ได้รับอนุญาตให้ใช้ bot นี้');
            continue;
          }
          opts.onLog?.(`Telegram ${chatId}: ${text.slice(0, 50)}`);
          await sendMessage(opts.token, chatId, '⏳ กำลังคิด…');
          try {
            const { text: out } = await runAgent({
              model: opts.model,
              prompt: text,
              maxSteps: 20,
              budgetUsd: opts.budgetUsd,
              permissionMode: 'auto', // non-interactive → รันเลย (caller ผ่าน allowlist แล้ว)
            });
            await sendMessage(opts.token, chatId, out || '(ไม่มีผลลัพธ์)');
          } catch (e) {
            await sendMessage(opts.token, chatId, `เกิดข้อผิดพลาด: ${redactKey((e as Error).message)}`);
          }
        }
      } catch (e) {
        if (stopped) break;
        opts.onLog?.(`Telegram poll error: ${(e as Error).message} — รอ 5s`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  void loop();
  return () => {
    stopped = true;
    ctrl.abort();
  };
}
