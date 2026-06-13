import { dueTasks, claimTask, updateTask, recoverStaleRunning, type Task } from './ledger.js';
import { nextRun } from './schedule.js';
import { runAgent } from '../loop.js';
import { redactKey } from '../providers/keys.js';

export interface SchedulerOpts {
  defaultModel: string;
  budgetUsd?: number;
  tickMs?: number;
  onLog?: (msg: string) => void;
  /** deliver ผลลัพธ์ (channel adapter เสียบทีหลัง); default = เก็บใน ledger.lastResult */
  deliver?: (task: Task, output: string) => Promise<void> | void;
}

/** รัน 1 task เป็น fresh agent (ไม่มี history — แบบ Hermes cron: เริ่มสะอาดทุกครั้ง) */
async function runTask(task: Task, opts: SchedulerOpts): Promise<string> {
  const { text } = await runAgent({
    model: task.model ?? opts.defaultModel,
    prompt: task.spec,
    maxSteps: 20,
    budgetUsd: opts.budgetUsd,
  });
  return text;
}

/**
 * tick loop — ทุก tickMs อ่าน task ที่ถึงเวลา → claim atomically (กัน double-run) → รัน → update
 * mutation ทุกตัวผ่าน ledger ที่ lock + re-read สด → ไม่ทับ task ที่ HTTP/CLI เพิ่ง enqueue
 * recurring → re-queue แม้ fail (ไม่หยุด cron ถาวร); error ผ่าน redactKey ก่อน persist
 */
export function startScheduler(opts: SchedulerOpts): () => void {
  const tickMs = opts.tickMs ?? 60_000;
  let stopped = false;
  let running = false;

  async function tick(): Promise<void> {
    if (stopped || running) return; // ไม่ทับรอบก่อนที่ยังรันไม่เสร็จ
    running = true;
    try {
      for (const task of await dueTasks()) {
        if (!(await claimTask(task.id))) continue; // โดน claim โดย writer อื่นแล้ว → ข้าม
        opts.onLog?.(`▶ ${task.id}: ${task.spec.slice(0, 60)}`);
        const startedAt = Date.now();
        try {
          const out = await runTask(task, opts);
          const next = task.schedule ? nextRun(task.schedule, Date.now()) : null;
          await updateTask(task.id, {
            status: next != null ? 'queued' : 'done',
            runAt: next ?? task.runAt,
            lastRun: startedAt,
            lastResult: out.slice(0, 2000),
            lastError: undefined,
          });
          if (opts.deliver) await opts.deliver(task, out);
          opts.onLog?.(`✓ ${task.id} ${next != null ? '(re-queued)' : 'done'}`);
        } catch (err) {
          const msg = redactKey((err as Error).message ?? String(err)); // กัน key รั่วลงไฟล์/network
          const next = task.schedule ? nextRun(task.schedule, Date.now()) : null;
          // recurring ที่ fail → ยัง re-queue (ลองใหม่รอบหน้า) ไม่ปล่อยตายถาวร
          await updateTask(task.id, {
            status: next != null ? 'queued' : 'failed',
            runAt: next ?? task.runAt,
            lastRun: startedAt,
            lastError: msg,
          });
          opts.onLog?.(`✗ ${task.id} failed: ${msg}`);
        }
      }
    } finally {
      running = false;
    }
  }

  // recover task ที่ค้าง running จาก crash/shutdown รอบก่อน → queued, แล้วเริ่ม tick แรก
  void recoverStaleRunning()
    .then((n) => {
      if (n) opts.onLog?.(`recovered ${n} stale running task → queued`);
    })
    .then(() => tick());

  const timer = setInterval(() => void tick(), tickMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
