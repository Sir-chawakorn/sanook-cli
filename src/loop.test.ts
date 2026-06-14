import { describe, it, expect } from 'vitest';
import { cleanProviderError } from './loop.js';

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
