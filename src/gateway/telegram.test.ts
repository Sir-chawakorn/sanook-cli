import { describe, it, expect, afterEach, vi } from 'vitest';
import { isAllowed, parseAllowedChats, sendTelegramMessage } from './telegram.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('telegram allowlist (security)', () => {
  it('parseAllowedChats "123, 456" → [123, 456]', () => {
    expect(parseAllowedChats('123, 456')).toEqual([123, 456]);
    expect(parseAllowedChats(undefined)).toEqual([]);
    expect(parseAllowedChats('abc,12,')).toEqual([12]); // ข้ามที่ไม่ใช่เลข
  });

  it('parseAllowedChats rejects partial numeric tokens', () => {
    expect(parseAllowedChats('123abc, 1.2, 1e3, 9007199254740993, 456')).toEqual([456]);
  });

  it('isAllowed: ไม่ตั้ง allowlist → ปฏิเสธทุกคน (fail-closed)', () => {
    expect(isAllowed(999, [])).toBe(false);
    expect(isAllowed(999, undefined)).toBe(false);
  });

  it('isAllowed: มี allowlist → เฉพาะที่ตรง', () => {
    expect(isAllowed(123, [123, 456])).toBe(true);
    expect(isAllowed(999, [123, 456])).toBe(false);
  });

  it('sendTelegramMessage includes thread id and returns message id', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { message_id: 42 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendTelegramMessage('123:abc', -100, 'hello', 17585)).resolves.toEqual({
      chatId: -100,
      messageId: 42,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ chat_id: -100, text: 'hello', message_thread_id: 17585 });
  });

  it('sendTelegramMessage surfaces platform failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })),
    );
    await expect(sendTelegramMessage('123:abc', 1, 'hello')).rejects.toThrow('Telegram sendMessage 403');
  });
});
