// แปลง schedule string ของมนุษย์ → เวลา (epoch ms) + recurring
// support: interval ("every 30m" / "2h"), daily ("09:00"), ISO timestamp (one-shot), "now"
// pure — รับ now เป็น param (ไม่เรียก Date.now ใน body หลัก) เพื่อ test ได้

const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export interface ParsedSchedule {
  runAt: number; // epoch ms ของรอบแรก
  recurring: boolean;
  kind: 'cron' | 'once';
  normalized: string; // เก็บลง task.schedule เพื่อคำนวณรอบถัดไป
}

const pad = (n: number): string => String(n).padStart(2, '0');

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
  if (s === 'now' || s === 'immediately') {
    return { runAt: now, recurring: false, kind: 'once', normalized: 'now' };
  }

  // interval: "every 30m" | "30m" | "every 2 h" | "2hours"
  const iv = s.match(/^(?:every\s+)?(\d+)\s*(s|m|h|d|sec|secs|min|mins|hour|hours|day|days)$/);
  if (iv) {
    const n = parseInt(iv[1], 10);
    const unit = iv[2][0]; // s/m/h/d (ตัวแรกพอ)
    const ms = n * (UNIT_MS[unit] ?? 0);
    // กัน overflow → runAt เป็น Invalid Date ที่ due() ไม่มีวันยิง
    if (!Number.isSafeInteger(ms) || ms <= 0 || !Number.isFinite(now + ms)) return null;
    return { runAt: now + ms, recurring: true, kind: 'cron', normalized: `every ${n}${unit}` };
  }

  // daily time: "09:00" | "at 9:00" | "daily 09:30"
  const dt = s.match(/^(?:at\s+|daily\s+(?:at\s+)?)?(\d{1,2}):(\d{2})$/);
  if (dt) {
    const hh = parseInt(dt[1], 10);
    const mm = parseInt(dt[2], 10);
    if (hh > 23 || mm > 59) return null;
    const mins = hh * 60 + mm;
    return { runAt: nextDaily(mins, now), recurring: true, kind: 'cron', normalized: `${pad(hh)}:${pad(mm)}` };
  }

  // ISO timestamp (one-shot) — รับเฉพาะรูปแบบที่มี date จริง (กัน Date.parse รับ bare number/year-only กำกวม)
  const raw = input.trim();
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/.test(raw)) {
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
