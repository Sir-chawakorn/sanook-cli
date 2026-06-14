import { runAgent } from '../loop.js';
import { redactKey } from '../providers/keys.js';

// Telegram channel adapter — long-polling (ไม่ต้อง public URL, เหมาะ local 24/7 แบบ Hermes)
// ⚠ remote surface ที่รัน agent ได้ → security: REQUIRED allowlist (fail-closed) + private chat only +
// per-chat rate-limit + error ไม่ leak internal. ทุกอย่าง fail-closed (ค่า default = ปฏิเสธ)
const api = (token: string, method: string): string => `https://api.telegram.org/bot${token}/${method}`;

interface TgUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type?: string };
    from?: { id?: number; username?: string };
  };
}

export interface TelegramOpts {
  token: string;
  model: string;
  budgetUsd?: number;
  allowedChatIds?: number[]; // REQUIRED — ว่าง = ไม่ start (fail-closed)
  onLog?: (m: string) => void;
}

async function getUpdates(token: string, offset: number, signal: AbortSignal): Promise<TgUpdate[]> {
  const r = await fetch(`${api(token, 'getUpdates')}?offset=${offset}&timeout=30`, { signal });
  if (r.status === 409) throw new Error('409: มี consumer อื่น/webhook ใช้ token นี้อยู่ (ปิดตัวอื่นก่อน หรือ deleteWebhook)');
  if (!r.ok) throw new Error(`getUpdates ${r.status}`);
  const j = (await r.json()) as { ok: boolean; result?: TgUpdate[] };
  return j.result ?? [];
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  await fetch(api(token, 'sendMessage'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
  }).catch(() => {});
}

/** allowlist — fail-closed: ว่าง = ปฏิเสธทุกคน (ต้องตั้ง TELEGRAM_ALLOWED_CHATS ชัดเจน) */
export function isAllowed(chatId: number, allowed?: number[]): boolean {
  if (!allowed || allowed.length === 0) return false;
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

/** start long-polling — คืน stop(). ไม่ start ถ้าไม่มี allowlist (fail-closed) */
export function startTelegram(opts: TelegramOpts): () => void {
  if (!opts.allowedChatIds?.length) {
    opts.onLog?.('⛔ Telegram ไม่เริ่ม: ต้องตั้ง TELEGRAM_ALLOWED_CHATS (chat id ที่อนุญาต) — remote surface นี้รัน bash/แก้ไฟล์ได้');
    return () => {};
  }
  opts.onLog?.(`Telegram: long-polling เริ่มแล้ว (allowlist ${opts.allowedChatIds.length} chat)`);
  const ctrl = new AbortController();
  let stopped = false;
  const running = new Set<number>(); // กัน flood: 1 chat = 1 งานพร้อมกัน

  async function loop(): Promise<void> {
    let offset = 0;
    while (!stopped) {
      try {
        const updates = await getUpdates(opts.token, offset, ctrl.signal);
        for (const u of updates) {
          offset = u.update_id + 1;
          const text = u.message?.text;
          const chat = u.message?.chat;
          if (!text || !chat) continue;
          // private chat เท่านั้น (group id < 0 → ทุกคนในกลุ่มจะ inherit สิทธิ์ — ปฏิเสธ)
          if (chat.type !== 'private' || chat.id < 0) {
            opts.onLog?.(`Telegram: ปฏิเสธ non-private chat ${chat.id}`);
            continue;
          }
          if (!isAllowed(chat.id, opts.allowedChatIds)) {
            opts.onLog?.(`Telegram: ปฏิเสธ chat ${chat.id} (ไม่อยู่ใน allowlist)`);
            await sendMessage(opts.token, chat.id, '⛔ ไม่ได้รับอนุญาตให้ใช้ bot นี้');
            continue;
          }
          if (running.has(chat.id)) {
            await sendMessage(opts.token, chat.id, '⏳ กำลังทำงานก่อนหน้าอยู่ รอสักครู่');
            continue;
          }
          running.add(chat.id);
          opts.onLog?.(`Telegram ${chat.id}: ${text.slice(0, 50)}`);
          void (async () => {
            try {
              await sendMessage(opts.token, chat.id, '⏳ กำลังคิด…');
              const { text: out } = await runAgent({
                model: opts.model,
                prompt: text,
                maxSteps: 20,
                budgetUsd: opts.budgetUsd,
                permissionMode: 'auto', // chat ผ่าน allowlist + private = trusted (เหมือน user สั่งเอง)
              });
              await sendMessage(opts.token, chat.id, out || '(ไม่มีผลลัพธ์)');
            } catch (e) {
              // ไม่ส่ง internal detail ให้ remote — log ฝั่ง server เท่านั้น
              opts.onLog?.(`Telegram run error (${chat.id}): ${redactKey((e as Error).message)}`);
              await sendMessage(opts.token, chat.id, 'เกิดข้อผิดพลาดภายใน');
            } finally {
              running.delete(chat.id);
            }
          })();
        }
      } catch (e) {
        if (stopped) break;
        const msg = (e as Error).message;
        const backoff = msg.startsWith('409') ? 30_000 : 5000; // conflict → รอยาวขึ้น
        opts.onLog?.(`Telegram poll error: ${msg} — รอ ${backoff / 1000}s`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  void loop();
  return () => {
    stopped = true;
    ctrl.abort();
  };
}
