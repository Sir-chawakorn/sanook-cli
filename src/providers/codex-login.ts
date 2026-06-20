import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codexHome } from './codex.js';

/** OpenAI Codex OAuth client id (same public client as Codex CLI / Hermes). */
export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_OAUTH_ISSUER = 'https://auth.openai.com';
const CODEX_OAUTH_TOKEN_URL = `${CODEX_OAUTH_ISSUER}/oauth/token`;
export const CODEX_DEVICE_VERIFY_URL = `${CODEX_OAUTH_ISSUER}/codex/device`;

export interface CodexDeviceCodeSession {
  userCode: string;
  deviceAuthId: string;
  pollIntervalMs: number;
}

export interface CodexAuthTokens {
  access_token: string;
  refresh_token: string;
  id_token?: string;
}

export interface CodexDeviceCodeLoginOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onStatus?: (message: string) => void;
  signal?: AbortSignal;
  maxWaitMs?: number;
}

function parseRetryAfterSeconds(headers: Headers | undefined): number | undefined {
  const raw = headers?.get('retry-after')?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds);
  return undefined;
}

async function postJson(
  url: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Step 1 — request device code (Hermes / Codex CLI compatible). */
export async function requestCodexDeviceCode(fetchImpl: typeof fetch = fetch): Promise<CodexDeviceCodeSession> {
  const maxAttempts = 4;
  let resp: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    resp = await postJson(
      `${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`,
      { client_id: CODEX_OAUTH_CLIENT_ID },
      fetchImpl,
    );
    if (resp.status !== 429) break;
    if (attempt < maxAttempts) {
      const retryAfter = parseRetryAfterSeconds(resp.headers) ?? 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.max(1000, Math.min(retryAfter * 1000, 60_000))));
    }
  }
  if (!resp || resp.status === 429) {
    throw new Error('OpenAI จำกัดการ login ชั่วคราว (429) — รอ 1 นาทีแล้วลองใหม่');
  }
  if (!resp.ok) {
    throw new Error(`ขอ device code ไม่สำเร็จ (HTTP ${resp.status})`);
  }
  const data = (await resp.json()) as { user_code?: string; device_auth_id?: string; interval?: string | number };
  const userCode = data.user_code?.trim();
  const deviceAuthId = data.device_auth_id?.trim();
  if (!userCode || !deviceAuthId) throw new Error('OpenAI ตอบ device code ไม่ครบ');
  const pollIntervalMs = Math.max(3000, Number(data.interval ?? 5) * 1000);
  return { userCode, deviceAuthId, pollIntervalMs };
}

/** Step 2 — poll until the user completes browser login. */
export async function pollCodexDeviceCode(
  session: CodexDeviceCodeSession,
  opts: Pick<CodexDeviceCodeLoginOptions, 'fetchImpl' | 'sleep' | 'signal' | 'maxWaitMs'> = {},
): Promise<{ authorization_code: string; code_verifier: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.maxWaitMs ?? 15 * 60_000);
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error('ยกเลิก login แล้ว');
    await sleep(session.pollIntervalMs);
    if (opts.signal?.aborted) throw new Error('ยกเลิก login แล้ว');
    const pollResp = await postJson(
      `${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`,
      { device_auth_id: session.deviceAuthId, user_code: session.userCode },
      fetchImpl,
    );
    if (pollResp.status === 200) {
      const payload = (await pollResp.json()) as { authorization_code?: string; code_verifier?: string };
      const authorization_code = payload.authorization_code?.trim();
      const code_verifier = payload.code_verifier?.trim();
      if (!authorization_code || !code_verifier) throw new Error('OpenAI ตอบ authorization code ไม่ครบ');
      return { authorization_code, code_verifier };
    }
    if (pollResp.status === 403 || pollResp.status === 404) continue;
    throw new Error(`รอ login ไม่สำเร็จ (HTTP ${pollResp.status})`);
  }
  throw new Error('หมดเวลารอ login (15 นาที) — ลองใหม่');
}

/** Step 3 — exchange authorization code for tokens. */
export async function exchangeCodexDeviceCode(
  exchange: { authorization_code: string; code_verifier: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CodexAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: exchange.authorization_code,
    redirect_uri: `${CODEX_OAUTH_ISSUER}/deviceauth/callback`,
    client_id: CODEX_OAUTH_CLIENT_ID,
    code_verifier: exchange.code_verifier,
  });
  const resp = await fetchImpl(CODEX_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (resp.status === 429) throw new Error('OpenAI จำกัดการ login ชั่วคราว (429) — รอแล้วลองใหม่');
  if (!resp.ok) throw new Error(`แลก token ไม่สำเร็จ (HTTP ${resp.status})`);
  const tokens = (await resp.json()) as CodexAuthTokens & { access_token?: string; refresh_token?: string };
  const access_token = tokens.access_token?.trim();
  const refresh_token = tokens.refresh_token?.trim();
  if (!access_token || !refresh_token) throw new Error('OpenAI ไม่ส่ง access/refresh token');
  return {
    access_token,
    refresh_token,
    id_token: tokens.id_token?.trim() || undefined,
  };
}

/** Persist ChatGPT-plan credentials where the official Codex CLI expects them. */
export async function saveCodexAuthFile(tokens: CodexAuthTokens, home: string = codexHome()): Promise<string> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const authPath = join(home, 'auth.json');
  const payload = {
    auth_mode: 'chatgpt',
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      ...(tokens.id_token ? { id_token: tokens.id_token } : {}),
    },
    last_refresh: new Date().toISOString(),
  };
  await writeFile(authPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return authPath;
}

/** Full Hermes-style device-code login → ~/.codex/auth.json (Codex CLI can reuse). */
export async function runCodexDeviceCodeLogin(opts: CodexDeviceCodeLoginOptions = {}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const onStatus = opts.onStatus ?? (() => {});
  onStatus('requesting');
  const session = await requestCodexDeviceCode(fetchImpl);
  onStatus(`code:${session.userCode}`);
  onStatus('waiting');
  const exchange = await pollCodexDeviceCode(session, opts);
  onStatus('exchanging');
  const tokens = await exchangeCodexDeviceCode(exchange, fetchImpl);
  onStatus('saving');
  const authPath = await saveCodexAuthFile(tokens);
  onStatus('done');
  return authPath;
}
