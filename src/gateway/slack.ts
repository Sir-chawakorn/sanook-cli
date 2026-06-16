import { redactKey } from '../providers/keys.js';
import { runGatewayAgent } from './session.js';

export interface SlackSendResult {
  channelId: string;
  messageTs?: string;
}

export async function sendSlackMessage(
  botToken: string,
  channelId: string,
  text: string,
  threadTs?: string,
): Promise<SlackSendResult> {
  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${botToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: channelId,
      text: text.slice(0, 40_000),
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
  });
  if (!r.ok) throw new Error(`Slack chat.postMessage ${r.status}`);
  const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; channel?: string; ts?: string };
  if (body.ok !== true) throw new Error(`Slack chat.postMessage error: ${body.error ?? 'unknown'}`);
  return { channelId: body.channel ?? channelId, messageTs: body.ts };
}

type WsEvent = { data?: unknown };
type WsLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: WsEvent) => void): void;
};

export interface SlackGatewayOpts {
  botToken: string;
  appToken: string;
  model: string;
  budgetUsd?: number;
  allowedChannelIds?: string[];
  defaultChannelId?: string;
  allowWrite?: boolean;
  webSocketFactory?: (url: string) => WsLike;
  onLog?: (m: string) => void;
}

interface SlackSocketEnvelope {
  envelope_id?: string;
  type?: string;
  payload?: {
    event?: {
      type?: string;
      subtype?: string;
      bot_id?: string;
      channel?: string;
      user?: string;
      text?: string;
      ts?: string;
      thread_ts?: string;
    };
  };
}

async function openSocketUrl(appToken: string): Promise<string> {
  const r = await fetch('https://slack.com/api/apps.connections.open', {
    method: 'POST',
    headers: { authorization: `Bearer ${appToken}` },
  });
  if (!r.ok) throw new Error(`Slack apps.connections.open ${r.status}`);
  const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; url?: string };
  if (body.ok !== true || !body.url) throw new Error(`Slack apps.connections.open error: ${body.error ?? 'missing_url'}`);
  return body.url;
}

function defaultWebSocketFactory(url: string): WsLike {
  const WS = globalThis.WebSocket as unknown as { new (url: string): WsLike } | undefined;
  if (!WS) throw new Error('WebSocket runtime ไม่พร้อมใช้งานใน Node นี้');
  return new WS(url);
}

function allowed(channelId: string, allowedChannelIds: string[] | undefined, defaultChannelId: string | undefined): boolean {
  const allow = allowedChannelIds?.length ? allowedChannelIds : defaultChannelId ? [defaultChannelId] : [];
  return allow.includes(channelId);
}

export async function startSlack(opts: SlackGatewayOpts): Promise<() => void> {
  const allowedChannelIds = opts.allowedChannelIds?.filter(Boolean) ?? [];
  if (!allowedChannelIds.length && !opts.defaultChannelId) {
    opts.onLog?.('⛔ Slack ไม่เริ่ม: ต้องตั้ง default channel หรือ allowed channels เพื่อ fail-closed');
    return () => {};
  }

  const url = await openSocketUrl(opts.appToken);
  const ws = (opts.webSocketFactory ?? defaultWebSocketFactory)(url);
  const running = new Set<string>();
  let stopped = false;

  ws.addEventListener('open', () => {
    opts.onLog?.(`Slack: Socket Mode connected (allowlist ${allowedChannelIds.length || 1} channel)`);
  });

  ws.addEventListener('message', (event) => {
    let envelope: SlackSocketEnvelope;
    try {
      envelope = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (envelope.envelope_id) ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    if (envelope.type !== 'events_api') return;
    const ev = envelope.payload?.event;
    if (!ev || (ev.type !== 'message' && ev.type !== 'app_mention')) return;
    if (ev.subtype || ev.bot_id) return;
    const channelId = ev.channel;
    const text = ev.text?.trim();
    if (!channelId || !text) return;
    if (!allowed(channelId, allowedChannelIds, opts.defaultChannelId)) {
      opts.onLog?.(`Slack: ปฏิเสธ channel ${channelId} (ไม่อยู่ใน allowlist)`);
      return;
    }
    const threadTs = ev.thread_ts ?? ev.ts;
    const sessionTarget = `${channelId}:${ev.user ?? 'unknown'}`;
    if (running.has(sessionTarget)) {
      void sendSlackMessage(opts.botToken, channelId, 'กำลังทำงานก่อนหน้าอยู่ รอสักครู่', threadTs).catch(() => {});
      return;
    }
    running.add(sessionTarget);
    void (async () => {
      try {
        await sendSlackMessage(opts.botToken, channelId, 'กำลังคิด...', threadTs);
        const out = await runGatewayAgent({
          platform: 'slack',
          target: sessionTarget,
          model: opts.model,
          prompt: text.replace(/<@[A-Z0-9]+>/g, '').trim() || text,
          budgetUsd: opts.budgetUsd,
          permissionMode: opts.allowWrite === true ? 'auto' : 'ask',
        });
        if (!out.suppressDelivery && out.text.trim()) await sendSlackMessage(opts.botToken, channelId, out.text, threadTs);
      } catch (e) {
        opts.onLog?.(`Slack run error (${channelId}): ${redactKey((e as Error).message)}`);
        await sendSlackMessage(opts.botToken, channelId, 'เกิดข้อผิดพลาดภายใน', threadTs).catch(() => {});
      } finally {
        running.delete(sessionTarget);
      }
    })();
  });

  ws.addEventListener('close', () => {
    if (!stopped) opts.onLog?.('Slack: Socket Mode closed');
  });
  ws.addEventListener('error', () => opts.onLog?.('Slack: Socket Mode error'));

  return () => {
    stopped = true;
    ws.close();
  };
}
