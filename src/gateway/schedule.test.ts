import { describe, it, expect } from 'vitest';
import { parseSchedule, nextRun } from './schedule.js';

const T0 = Date.UTC(2026, 5, 14, 12, 0, 0); // ฐานเวลา fixed สำหรับ test

describe('parseSchedule', () => {
  it('interval "every 30m" → recurring, +30 นาที', () => {
    const p = parseSchedule('every 30m', T0)!;
    expect(p).toMatchObject({ recurring: true, kind: 'cron', normalized: 'every 30m' });
    expect(p.runAt).toBe(T0 + 30 * 60_000);
  });

  it('interval bare "2h" → +2 ชม.', () => {
    expect(parseSchedule('2h', T0)!.runAt).toBe(T0 + 2 * 3_600_000);
  });

  it('"now" → once ที่เวลาปัจจุบัน', () => {
    const p = parseSchedule('now', T0)!;
    expect(p.recurring).toBe(false);
    expect(p.runAt).toBe(T0);
  });

  it('daily "09:00" → recurring, รอบถัดไปอยู่อนาคต (TZ-safe)', () => {
    const p = parseSchedule('09:00', T0)!;
    expect(p.recurring).toBe(true);
    expect(p.normalized).toBe('09:00');
    expect(p.runAt).toBeGreaterThan(T0);
  });

  it('ISO timestamp → once', () => {
    const iso = '2026-12-25T00:00:00.000Z';
    const p = parseSchedule(iso, T0)!;
    expect(p.recurring).toBe(false);
    expect(p.runAt).toBe(Date.parse(iso));
  });

  it('input พัง → null', () => {
    expect(parseSchedule('blah blah', T0)).toBeNull();
    expect(parseSchedule('', T0)).toBeNull();
    expect(parseSchedule('25:00', T0)).toBeNull(); // ชั่วโมงเกิน
    expect(parseSchedule('0m', T0)).toBeNull(); // interval <= 0
  });
});

describe('nextRun', () => {
  it('recurring interval → เวลาถัดไป', () => {
    expect(nextRun('every 1h', T0)).toBe(T0 + 3_600_000);
  });
  it('one-shot (ISO) → null (ไม่ recurring)', () => {
    expect(nextRun('2026-12-25T00:00:00.000Z', T0)).toBeNull();
  });
});

describe('parseSchedule hardening (จาก adversarial review)', () => {
  it('interval overflow → null (ไม่ใช่ Invalid Date)', () => {
    expect(parseSchedule('999999999999d', T0)).toBeNull();
  });
  it('year-only / bare number ไม่ใช่ ISO → null', () => {
    expect(parseSchedule('2026', T0)).toBeNull();
    expect(parseSchedule('12345', T0)).toBeNull();
  });
  it('one-shot ในอดีต → null (ไม่ยิงย้อนหลังเงียบๆ)', () => {
    expect(parseSchedule('2020-01-01T00:00:00.000Z', T0)).toBeNull();
  });
  it('date-only อนาคต → once', () => {
    const p = parseSchedule('2026-12-25', T0);
    expect(p?.recurring).toBe(false);
    expect(p?.kind).toBe('once');
  });
});

describe('parseSchedule NL ภาษาไทย', () => {
  it('"ทุก 30 นาที" → every 30m', () => {
    const p = parseSchedule('ทุก 30 นาที', T0);
    expect(p?.recurring).toBe(true);
    expect(p?.normalized).toBe('every 30m');
  });
  it('"ทุกๆ 2 ชั่วโมง" → every 2h', () => {
    expect(parseSchedule('ทุกๆ 2 ชั่วโมง', T0)?.normalized).toBe('every 2h');
  });
  it('"ทุก 1 ชม" → every 1h', () => {
    expect(parseSchedule('ทุก 1 ชม', T0)?.normalized).toBe('every 1h');
  });
  it('"ทุกชั่วโมง" → every 1h', () => {
    expect(parseSchedule('ทุกชั่วโมง', T0)?.normalized).toBe('every 1h');
  });
  it('"ทุกวัน 9:00" → daily 09:00', () => {
    const p = parseSchedule('ทุกวัน 9:00', T0);
    expect(p?.recurring).toBe(true);
    expect(p?.normalized).toBe('09:00');
  });
});
