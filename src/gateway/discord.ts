import { redactKey } from '../providers/keys.js';
import { runGatewayAgent } from './session.js';

export interface DiscordSendResult {
  messageId?: string;
  channelId: string;
}

export async function sendDiscordMessage(
  botToken: string,
  channelId: string,
  text: string,
): Promise<DiscordSendResult> {
  const r = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${botToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ content: text.slice(0, 2000) }),
  });
  if (!r.ok) throw new Error(`Discord create message ${r.status}`);
  const body = (await r.json().catch(() => ({}))) as { id?: string; channel_id?: string };
  return { channelId: body.channel_id ?? channelId, messageId: body.id };
}

type WsEvent = { data?: unknown };
type WsLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: WsEvent) => void): void;
};

export interface DiscordGatewayOpts {
  token: string;
  model: string;
  budgetUsd?: number;
  allowedChannelIds?: string[];
  defaultChannelId?: string;
  allowWrite?: boolean;
  gatewayUrl?: string;
  webSocketFactory?: (url: string) => WsLike;
  onLog?: (m: string) => void;
}

interface DiscordGatewayMessage {
  op?: number;
  t?: string;
  s?: number;
  d?: {
    heartbeat_interval?: number;
    id?: string;
    content?: string;
    channel_id?: string;
    author?: { bot?: boolean; id?: string };
  };
}

const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const DISCORD_INTENTS = 1 | 512 | 4096 | 32768; // guilds, guild messages, DMs, message content

function defaultWebSocketFactory(url: string): WsLike {
  const WS = globalThis.WebSocket as unknown as { new (url: string): WsLike } | undefined;
  if (!WS) throw new Error('WebSocket runtime ไม่พร้อมใช้งานใน Node นี้');
  return new WS(url);
}

function allowed(channelId: string, allowedChannelIds: string[] | undefined, defaultChannelId: string | undefined): boolean {
  const allow = allowedChannelIds?.length ? allowedChannelIds : defaultChannelId ? [defaultChannelId] : [];
  return allow.includes(channelId);
}

export function startDiscord(opts: DiscordGatewayOpts): () => void {
  const allowedChannelIds = opts.allowedChannelIds?.filter(Boolean) ?? [];
  if (!allowedChannelIds.length && !opts.defaultChannelId) {
    opts.onLog?.('⛔ Discord ไม่เริ่ม: ต้องตั้ง default channel หรือ allowed channels เพื่อ fail-closed');
    return () => {};
  }

  const ws = (opts.webSocketFactory ?? defaultWebSocketFactory)(opts.gatewayUrl ?? DISCORD_GATEWAY_URL);
  const running = new Set<string>();
  let heartbeat: NodeJS.Timeout | undefined;
  let lastSeq: number | undefined;
  let stopped = false;

  const sendJson = (payload: unknown): void => ws.send(JSON.stringify(payload));

  ws.addEventListener('open', () => {
    opts.onLog?.(`Discord: gateway connecting (allowlist ${allowedChannelIds.length || 1} channel)`);
  });

  ws.addEventListener('message', (event) => {
    let packet: DiscordGatewayMessage;
    try {
      packet = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof packet.s === 'number') lastSeq = packet.s;

    if (packet.op === 10) {
      const interval = packet.d?.heartbeat_interval ?? 45_000;
      heartbeat = setInterval(() => sendJson({ op: 1, d: lastSeq ?? null }), interval);
      sendJson({
        op: 2,
        d: {
          token: opts.token,
          intents: DISCORD_INTENTS,
          properties: { os: process.platform, browser: 'sanook-cli', device: 'sanook-cli' },
        },
      });
      return;
    }
    if (packet.op === 11) return;
    if (packet.t === 'READY') {
      opts.onLog?.('Discord: gateway ready');
      return;
    }
    if (packet.t !== 'MESSAGE_CREATE') return;

    const channelId = packet.d?.channel_id;
    const text = packet.d?.content?.trim();
    if (!channelId || !text || packet.d?.author?.bot) return;
    if (!allowed(channelId, allowedChannelIds, opts.defaultChannelId)) {
      opts.onLog?.(`Discord: ปฏิเสธ channel ${channelId} (ไม่อยู่ใน allowlist)`);
      return;
    }
    const sessionTarget = `${channelId}:${packet.d?.author?.id ?? 'unknown'}`;
    if (running.has(sessionTarget)) {
      void sendDiscordMessage(opts.token, channelId, 'กำลังทำงานก่อนหน้าอยู่ รอสักครู่').catch(() => {});
      return;
    }
    running.add(sessionTarget);
    void (async () => {
      try {
        await sendDiscordMessage(opts.token, channelId, 'กำลังคิด...');
        const out = await runGatewayAgent({
          platform: 'discord',
          target: sessionTarget,
          model: opts.model,
          prompt: text,
          budgetUsd: opts.budgetUsd,
          permissionMode: opts.allowWrite === true ? 'auto' : 'ask',
        });
        if (!out.suppressDelivery && out.text.trim()) await sendDiscordMessage(opts.token, channelId, out.text);
      } catch (e) {
        opts.onLog?.(`Discord run error (${channelId}): ${redactKey((e as Error).message)}`);
        await sendDiscordMessage(opts.token, channelId, 'เกิดข้อผิดพลาดภายใน').catch(() => {});
      } finally {
        running.delete(sessionTarget);
      }
    })();
  });

  ws.addEventListener('close', () => {
    if (!stopped) opts.onLog?.('Discord: gateway closed');
  });
  ws.addEventListener('error', () => opts.onLog?.('Discord: gateway error'));

  return () => {
    stopped = true;
    if (heartbeat) clearInterval(heartbeat);
    ws.close();
  };
}
