import { describe, it, expect } from 'vitest';
import { cleanProviderError, isRateLimit, isAuthError } from './loop.js';

describe('cleanProviderError (กัน "No output generated" + stack dump)', () => {
  it('ดึง message จริงจาก RetryError.lastError.responseBody (billing 429)', () => {
    const err = {
      message: 'Failed after 3 attempts',
      lastError: {
        statusCode: 429,
        responseBody: JSON.stringify({ error: { message: 'Insufficient balance. Please recharge.' } }),
      },
    };
    expect(cleanProviderError(err)).toBe('Insufficient balance. Please recharge. (HTTP 429)');
  });

  it('ใช้ message ตรงๆ + statusCode ถ้าไม่มี responseBody JSON', () => {
    expect(cleanProviderError({ message: 'rate limited', statusCode: 503 })).toBe('rate limited (HTTP 503)');
  });

  it('fallback เป็น message เมื่อ parse ไม่ได้', () => {
    expect(cleanProviderError({ message: 'boom' })).toBe('boom');
  });
});

describe('isRateLimit / isAuthError (retry-able ต่างจาก fail-fast)', () => {
  it('429/503 = rate limit (retry ด้วย backoff)', () => {
    expect(isRateLimit({ statusCode: 429 })).toBe(true);
    expect(isRateLimit({ lastError: { statusCode: 503 } })).toBe(true);
    expect(isRateLimit({ message: 'Too Many Requests' })).toBe(true);
    expect(isRateLimit({ message: 'model is overloaded' })).toBe(true);
  });

  it('auth/billing (401/403/402) ไม่นับเป็น rate limit', () => {
    expect(isRateLimit({ statusCode: 401 })).toBe(false);
    expect(isAuthError({ statusCode: 401 })).toBe(true);
    expect(isAuthError({ statusCode: 403 })).toBe(true);
    expect(isAuthError({ lastError: { statusCode: 402 } })).toBe(true);
    expect(isAuthError({ statusCode: 429 })).toBe(false);
  });
});
