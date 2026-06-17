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

  it('ดึง message จาก responseBody shape อื่นของ provider', () => {
    expect(
      cleanProviderError({
        message: 'Failed after 3 attempts',
        statusCode: 429,
        responseBody: JSON.stringify({ message: 'insufficient quota' }),
      }),
    ).toBe('insufficient quota (HTTP 429)');
    expect(
      cleanProviderError({
        message: 'Failed after 3 attempts',
        lastError: { statusCode: 402, responseBody: JSON.stringify({ error: 'billing disabled' }) },
      }),
    ).toBe('billing disabled (HTTP 402)');
    expect(
      cleanProviderError({
        message: 'Failed after 3 attempts',
        statusCode: 503,
        responseBody: JSON.stringify({ error: { code: 'overloaded' }, detail: 'provider overloaded' }),
      }),
    ).toBe('provider overloaded (HTTP 503)');
    expect(
      cleanProviderError({
        message: 'Failed after 3 attempts',
        statusCode: 429,
        responseBody: JSON.stringify({ error: { code: 'insufficient_quota' } }),
      }),
    ).toBe('insufficient_quota (HTTP 429)');
  });

  it('ดึง provider error ที่ถูก wrap ไว้ใน cause', () => {
    expect(
      cleanProviderError({
        message: 'No output generated',
        cause: {
          statusCode: 429,
          responseBody: JSON.stringify({ error: { message: 'Too Many Requests' } }),
        },
      }),
    ).toBe('Too Many Requests (HTTP 429)');
  });

  it('ใช้ message ตรงๆ + statusCode ถ้าไม่มี responseBody JSON', () => {
    expect(cleanProviderError({ message: 'rate limited', statusCode: 503 })).toBe('rate limited (HTTP 503)');
  });

  it('ใช้ responseBody แบบ plain text ถ้า provider ไม่ส่ง JSON', () => {
    expect(cleanProviderError({ message: 'Failed after 3 attempts', statusCode: 503, responseBody: 'provider overloaded' })).toBe(
      'provider overloaded (HTTP 503)',
    );
  });

  it('fallback เป็น message เมื่อ parse ไม่ได้', () => {
    expect(cleanProviderError({ message: 'boom' })).toBe('boom');
  });

  it('ข้าม message ว่างแล้ว fallback เป็นข้อความที่อ่านได้', () => {
    expect(cleanProviderError({ message: '', statusCode: 503 })).toBe('Provider error (HTTP 503)');
    expect(cleanProviderError({ message: 'No output generated', lastError: { message: '   ', statusCode: 503 } })).toBe(
      'No output generated (HTTP 503)',
    );
    expect(
      cleanProviderError({
        message: 'No output generated',
        statusCode: 429,
        responseBody: JSON.stringify({ error: { message: '   ' }, detail: 'provider detail' }),
      }),
    ).toBe('provider detail (HTTP 429)');
  });
});

describe('isRateLimit / isAuthError (retry-able ต่างจาก fail-fast)', () => {
  it('429/503 = rate limit (retry ด้วย backoff)', () => {
    expect(isRateLimit({ statusCode: 429 })).toBe(true);
    expect(isRateLimit({ lastError: { statusCode: 503 } })).toBe(true);
    expect(isRateLimit({ message: 'Too Many Requests' })).toBe(true);
    expect(isRateLimit({ message: 'model is overloaded' })).toBe(true);
  });

  it('quota/billing 429 ไม่ retry เป็น rate limit', () => {
    expect(
      isRateLimit({
        message: 'Failed after 3 attempts',
        lastError: {
          statusCode: 429,
          responseBody: JSON.stringify({ error: { message: 'Insufficient balance. Please recharge.' } }),
        },
      }),
    ).toBe(false);
    expect(isRateLimit({ statusCode: 429, message: 'insufficient quota' })).toBe(false);
    expect(isRateLimit({ statusCode: 429, responseBody: JSON.stringify({ message: 'billing limit reached' }) })).toBe(false);
    expect(isRateLimit({ statusCode: 429, responseBody: JSON.stringify({ error: { code: 'insufficient_quota' } }) })).toBe(false);
    expect(isRateLimit({ statusCode: 429, responseBody: 'Insufficient balance. Please recharge.' })).toBe(false);
    expect(
      isRateLimit({
        message: 'No output generated',
        cause: {
          statusCode: 429,
          responseBody: JSON.stringify({ error: { message: 'Insufficient balance. Please recharge.' } }),
        },
      }),
    ).toBe(false);
  });

  it('auth/billing (401/403/402) ไม่นับเป็น rate limit', () => {
    expect(isRateLimit({ statusCode: 401 })).toBe(false);
    expect(isRateLimit({ statusCode: 403, message: 'rate limit exceeded' })).toBe(false);
    expect(isRateLimit({ message: 'No output generated', cause: { statusCode: 503 } })).toBe(true);
    expect(isAuthError({ statusCode: 401 })).toBe(true);
    expect(isAuthError({ statusCode: 403 })).toBe(true);
    expect(isAuthError({ message: 'No output generated', cause: { statusCode: 401 } })).toBe(true);
    expect(isAuthError({ lastError: { statusCode: 402 } })).toBe(true);
    expect(isAuthError({ statusCode: 429 })).toBe(false);
  });
});
