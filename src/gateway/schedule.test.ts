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
