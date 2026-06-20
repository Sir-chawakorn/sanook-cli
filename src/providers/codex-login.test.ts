import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CODEX_DEVICE_VERIFY_URL,
  exchangeCodexDeviceCode,
  pollCodexDeviceCode,
  requestCodexDeviceCode,
  runCodexDeviceCodeLogin,
  saveCodexAuthFile,
} from './codex-login.js';

describe('codex-login', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests device code from OpenAI auth endpoint', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ user_code: 'ABCD-1234', device_auth_id: 'dev-1', interval: 5 }),
    );
    const session = await requestCodexDeviceCode(fetchImpl);
    expect(session.userCode).toBe('ABCD-1234');
    expect(session.deviceAuthId).toBe('dev-1');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://auth.openai.com/api/accounts/deviceauth/usercode',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('polls until authorization code is ready', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 404 });
      return Response.json({ authorization_code: 'auth-code', code_verifier: 'verifier' });
    });
    const exchange = await pollCodexDeviceCode(
      { userCode: 'ABCD-1234', deviceAuthId: 'dev-1', pollIntervalMs: 1 },
      { fetchImpl, sleep: async () => {} },
    );
    expect(exchange.authorization_code).toBe('auth-code');
  });

  it('exchanges authorization code for tokens', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        id_token: 'id-1',
      }),
    );
    const tokens = await exchangeCodexDeviceCode(
      { authorization_code: 'auth-code', code_verifier: 'verifier' },
      fetchImpl,
    );
    expect(tokens.access_token).toBe('access-1');
    expect(tokens.refresh_token).toBe('refresh-1');
  });

  it('writes ChatGPT auth.json compatible with Codex CLI', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sanook-codex-login-'));
    try {
      await saveCodexAuthFile({ access_token: 'access-1', refresh_token: 'refresh-1' }, home);
      const raw = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')) as {
        auth_mode?: string;
        tokens?: { access_token?: string; refresh_token?: string };
      };
      expect(raw.auth_mode).toBe('chatgpt');
      expect(raw.tokens?.access_token).toBe('access-1');
      expect(raw.tokens?.refresh_token).toBe('refresh-1');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('runs full device-code login flow', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sanook-codex-login-'));
    vi.stubEnv('CODEX_HOME', home);
    const statuses: string[] = [];
    let pollCalls = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/usercode')) {
        return Response.json({ user_code: 'WXYZ-9999', device_auth_id: 'dev-9', interval: 1 });
      }
      if (url.endsWith('/deviceauth/token')) {
        pollCalls += 1;
        if (pollCalls < 2) return new Response('', { status: 404 });
        return Response.json({ authorization_code: 'auth-code', code_verifier: 'verifier' });
      }
      if (url.endsWith('/oauth/token')) {
        return Response.json({ access_token: 'access-9', refresh_token: 'refresh-9' });
      }
      throw new Error(`unexpected url ${url}`);
    });
    try {
      const authPath = await runCodexDeviceCodeLogin({
        fetchImpl,
        sleep: async () => {},
        onStatus: (message) => statuses.push(message),
      });
      expect(authPath.endsWith('auth.json')).toBe(true);
      expect(statuses).toContain('code:WXYZ-9999');
      expect(CODEX_DEVICE_VERIFY_URL).toContain('/codex/device');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
