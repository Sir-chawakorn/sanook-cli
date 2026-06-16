// แปลง schedule string ของมนุษย์ → เวลา (epoch ms) + recurring
// support: interval ("every 30m" / "2h"), daily ("09:00"), ISO timestamp (one-shot), "now"
// pure — รับ now เป็น param (ไม่เรียก Date.now ใน body หลัก) เพื่อ test ได้

const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const MAX_DATE_MS = 8_640_000_000_000_000;

export interface ParsedSchedule {
  runAt: number; // epoch ms ของรอบแรก
  recurring: boolean;
  kind: 'cron' | 'once';
  normalized: string; // เก็บลง task.schedule เพื่อคำนวณรอบถัดไป
}

const pad = (n: number): string => String(n).padStart(2, '0');

function isValidEpochMs(value: number): boolean {
  return Number.isSafeInteger(value) && Math.abs(value) <= MAX_DATE_MS;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isValidClockTime(hour: number, minute: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/** next occurrence ของ HH:MM (local time) หลัง now */
function nextDaily(minutesOfDay: number, now: number): number {
  const target = new Date(now);
  target.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
  if (target.getTime() <= now) target.setDate(target.getDate() + 1);
  return target.getTime();
}

export function parseSchedule(input: string, now: number): ParsedSchedule | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (!isValidEpochMs(now)) return null;
  if (s === 'now' || s === 'immediately') {
    return { runAt: now, recurring: false, kind: 'once', normalized: 'now' };
  }

  // interval: "every 30m" | "30m" | "every 2 h" | "2hours"
  const iv = s.match(/^(?:every\s+)?(\d+)\s*(s|m|h|d|sec|secs|min|mins|hour|hours|day|days)$/);
  if (iv) {
    const n = parseInt(iv[1], 10);
    const unit = iv[2][0]; // s/m/h/d (ตัวแรกพอ)
    const ms = n * (UNIT_MS[unit] ?? 0);
    const runAt = now + ms;
    // กัน overflow → runAt เป็น Invalid Date ที่ due() ไม่มีวันยิง
    if (!Number.isSafeInteger(ms) || ms <= 0 || !isValidEpochMs(runAt)) return null;
    return { runAt, recurring: true, kind: 'cron', normalized: `every ${n}${unit}` };
  }

  // daily time: "09:00" | "at 9:00" | "daily 09:30"
  const dt = s.match(/^(?:at\s+|daily\s+(?:at\s+)?)?(\d{1,2}):(\d{2})$/);
  if (dt) {
    const hh = parseInt(dt[1], 10);
    const mm = parseInt(dt[2], 10);
    if (hh > 23 || mm > 59) return null;
    const mins = hh * 60 + mm;
    const runAt = nextDaily(mins, now);
    if (!isValidEpochMs(runAt)) return null;
    return { runAt, recurring: true, kind: 'cron', normalized: `${pad(hh)}:${pad(mm)}` };
  }

  // ── NL ภาษาไทย / aliases → map เป็น canonical แล้ว parse ซ้ำ ──
  if (/^(ทุก\s*ๆ?\s*)?(ชั่วโมง|ชม\.?|hourly)$/.test(s)) return parseSchedule('every 1h', now);
  if (/^(ทุก\s*ๆ?\s*)?(นาที|minutely)$/.test(s)) return parseSchedule('every 1m', now);
  // "ทุก 30 นาที" / "ทุกๆ 2 ชั่วโมง" / "ทุก 1 ชม"
  const thIv = s.match(/^ทุก\s*ๆ?\s*(\d+)\s*(นาที|ชม\.?|ชั่วโมง|วัน)$/);
  if (thIv) {
    const u = thIv[2];
    const unit = u.startsWith('นาที') ? 'm' : u.startsWith('วัน') ? 'd' : 'h'; // ชม/ชั่วโมง → h
    return parseSchedule(`every ${thIv[1]}${unit}`, now);
  }
  // "ทุกวัน 9:00" / "ทุกวัน 21.30"
  const thDaily = s.match(/^ทุกวัน\s*(\d{1,2})[:.](\d{2})$/);
  if (thDaily) return parseSchedule(`${thDaily[1]}:${thDaily[2]}`, now);

  // ISO timestamp (one-shot) — รับเฉพาะรูปแบบที่มี date จริง (กัน Date.parse รับ bare number/year-only กำกวม)
  const raw = input.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})|$)/);
  if (iso) {
    if (!isValidCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))) return null;
    if (iso[4] !== undefined && !isValidClockTime(Number(iso[4]), Number(iso[5]))) return null;
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) {
      if (t < now) return null; // one-shot ในอดีต → ปฏิเสธ (ไม่ยิงย้อนหลังเงียบๆ)
      return { runAt: t, recurring: false, kind: 'once', normalized: new Date(t).toISOString() };
    }
  }

  return null; // parse ไม่ได้
}

/** เวลารอบถัดไปของ recurring task (re-parse normalized จากเวลาที่เพิ่งรันเสร็จ) */
export function nextRun(normalized: string, from: number): number | null {
  const p = parseSchedule(normalized, from);
  return p?.recurring ? p.runAt : null;
}
