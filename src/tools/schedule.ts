import { tool } from 'ai';
import { z } from 'zod';
import { parseSchedule } from '../gateway/schedule.js';
import { enqueueTask, listTasks, removeTask } from '../gateway/ledger.js';
import { formatTarget, parseSendTarget } from '../gateway/targets.js';

/** ตั้งงานตามเวลา — agent เรียกเองเมื่อ user พูดเรื่องเวลา/รอบ ("ทุกๆ X โมง/นาที") */
export const scheduleTaskTool = tool({
  description:
    'ตั้งงานให้ทำตามเวลา/เป็นรอบ — เรียกเมื่อ user ขอให้ทำอะไร "ทุกๆ X" หรือ "ตอน X โมง" หรือเวลาในอนาคต. ' +
    'งานรันโดย gateway (ต้องเปิด `sanook serve` ไว้). ' +
    'when ใส่รูปแบบ canonical: "every 30m"/"every 2h"/"every 1d" (รอบ) · "09:00" (ทุกวันเวลานี้) · ' +
    'ISO เช่น "2026-12-25T09:00" (ครั้งเดียว). ภาษาไทยก็ได้ ("ทุก 30 นาที", "ทุกวัน 9:00") — ' +
    'แปลงคำพูด user เป็นรูปแบบนี้ก่อนส่ง',
  inputSchema: z.object({
    when: z.string().describe('เวลา: every 30m / 09:00 / ISO / "ทุก 2 ชั่วโมง"'),
    task: z.string().describe('สิ่งที่จะให้ทำตอนถึงเวลา — เขียนเป็น prompt เต็มในตัวเอง (รันเป็น fresh agent ไม่มี context นี้)'),
    model: z.string().optional().describe('model spec (ไม่ใส่ = default ของ gateway)'),
    deliver: z
      .string()
      .optional()
      .describe('ปลายทางส่งผลลัพธ์ เช่น telegram, telegram:123, discord:channel, slack:C01, email:owner@example.com, line:U123, sms:+15551234567, ntfy:topic, signal:+15551234567'),
  }),
  execute: async ({ when, task, model, deliver }) => {
    const sched = parseSchedule(when, Date.now());
    if (!sched) {
      return `ตั้งเวลาไม่ได้: "${when}" ไม่ใช่รูปแบบที่รองรับ — ลอง "every 30m", "09:00", ISO, หรือ "ทุก 2 ชั่วโมง"`;
    }
    let normalizedDeliver: string | undefined;
    if (deliver?.trim()) {
      try {
        normalizedDeliver = formatTarget(parseSendTarget(deliver));
      } catch (e) {
        return `ตั้งปลายทางส่งผลลัพธ์ไม่ได้: ${(e as Error).message}`;
      }
    }
    const t = await enqueueTask({
      kind: sched.recurring ? 'cron' : 'once',
      spec: task,
      schedule: sched.recurring ? sched.normalized : undefined,
      model,
      deliver: normalizedDeliver,
      runAt: sched.runAt,
    });
    const at = new Date(t.runAt).toLocaleString();
    return (
      `ตั้งงาน ${t.id} แล้ว — รัน ${at}${sched.recurring ? ` แล้วทุก ${sched.normalized}` : ' (ครั้งเดียว)'}` +
      `${normalizedDeliver ? ` และส่งผลลัพธ์ไป ${normalizedDeliver}` : ''}. ` +
      `งานจะทำงานเมื่อ gateway เปิดอยู่ (sanook serve)`
    );
  },
});

/** ดูงานที่ตั้งเวลาไว้ */
export const listScheduledTool = tool({
  description: 'ดูงานที่ตั้งเวลาไว้ทั้งหมด (cron / one-shot) พร้อมสถานะและเวลารันถัดไป',
  inputSchema: z.object({
    filter: z.string().optional().describe('กรองตาม status เช่น queued/done/failed (ไม่ใส่ = ทั้งหมด)'),
  }),
  execute: async ({ filter }) => {
    let tasks = await listTasks();
    if (filter) tasks = tasks.filter((t) => t.status === filter);
    if (!tasks.length) return filter ? `ไม่มีงานสถานะ ${filter}` : 'ยังไม่มีงานที่ตั้งเวลาไว้';
    return tasks
      .map(
        (t) =>
          `${t.id} [${t.status}] ${t.schedule ?? 'once'}${t.deliver ? ` to:${t.deliver}` : ''} → ${t.spec.slice(0, 60)} (next ${new Date(t.runAt).toLocaleString()})`,
      )
      .join('\n');
  },
});

/** ยกเลิกงานที่ตั้งเวลาไว้ */
export const cancelScheduledTool = tool({
  description: 'ยกเลิกงานที่ตั้งเวลาไว้ ด้วย task id (ดู id จาก list_scheduled)',
  inputSchema: z.object({
    id: z.string().describe('task id'),
  }),
  execute: async ({ id }) => {
    const ok = await removeTask(id);
    return ok ? `ยกเลิกงาน ${id} แล้ว` : `ไม่เจองาน ${id}`;
  },
});
