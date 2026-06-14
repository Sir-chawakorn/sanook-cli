import { describe, it, expect } from 'vitest';
import { isAllowed, parseAllowedChats } from './telegram.js';

describe('telegram allowlist (security)', () => {
  it('parseAllowedChats "123, 456" → [123, 456]', () => {
    expect(parseAllowedChats('123, 456')).toEqual([123, 456]);
    expect(parseAllowedChats(undefined)).toEqual([]);
    expect(parseAllowedChats('abc,12,')).toEqual([12]); // ข้ามที่ไม่ใช่เลข
  });

  it('isAllowed: ไม่ตั้ง allowlist → อนุญาตทุกคน', () => {
    expect(isAllowed(999, [])).toBe(true);
    expect(isAllowed(999, undefined)).toBe(true);
  });

  it('isAllowed: มี allowlist → เฉพาะที่ตรง', () => {
    expect(isAllowed(123, [123, 456])).toBe(true);
    expect(isAllowed(999, [123, 456])).toBe(false);
  });
});
