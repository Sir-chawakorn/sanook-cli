import { TaskLedger, type Task } from './ledger.js';
import { nextRun } from './schedule.js';
import { runAgent } from '../loop.js';

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
 * tick loop — ทุก tickMs เปิด ledger ใหม่จากไฟล์ (เห็น task ที่ CLI/HTTP เพิ่ง enqueue),
 * รัน task ที่ถึงเวลา, recurring → re-queue (แม้ fail ก็ไม่หยุด cron ถาวร)
 * คืน stop() เพื่อหยุด
 */
export function startScheduler(opts: SchedulerOpts): () => void {
  const tickMs = opts.tickMs ?? 60_000;
  let stopped = false;
  let running = false;

  async function tick(): Promise<void> {
    if (stopped || running) return; // ไม่ทับรอบก่อนที่ยังรันไม่เสร็จ
    running = true;
    try {
      const ledger = await TaskLedger.open(); // source of truth = ไฟล์ → เห็นของใหม่เสมอ
      for (const task of ledger.due()) {
        await ledger.update(task.id, { status: 'running' });
        opts.onLog?.(`▶ ${task.id}: ${task.spec.slice(0, 60)}`);
        const now0 = Date.now();
        try {
          const out = await runTask(task, opts);
          const next = task.schedule ? nextRun(task.schedule, Date.now()) : null;
          await ledger.update(task.id, {
            status: next != null ? 'queued' : 'done',
            runAt: next ?? task.runAt,
            lastRun: now0,
            lastResult: out.slice(0, 2000),
            lastError: undefined,
          });
          if (opts.deliver) await opts.deliver(task, out);
          opts.onLog?.(`✓ ${task.id} ${next != null ? '(re-queued)' : 'done'}`);
        } catch (err) {
          const msg = (err as Error).message ?? String(err);
          const next = task.schedule ? nextRun(task.schedule, Date.now()) : null;
          // recurring ที่ fail → ยัง re-queue (ลองใหม่รอบหน้า) ไม่ปล่อยตายถาวร
          await ledger.update(task.id, {
            status: next != null ? 'queued' : 'failed',
            runAt: next ?? task.runAt,
            lastRun: now0,
            lastError: msg,
          });
          opts.onLog?.(`✗ ${task.id} failed: ${msg}`);
        }
      }
    } finally {
      running = false;
    }
  }

  void tick(); // รันรอบแรกทันที
  const timer = setInterval(() => void tick(), tickMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
