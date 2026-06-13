import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// task-ledger = งานที่ gateway ต้องทำ (cron / message / one-shot) — Hermes "Kanban" / OpenClaw "Task Brain"
// เก็บเป็น JSON (zero native dep, รันได้ทันที) แทน SQLite; atomic write กัน corrupt
const GATEWAY_DIR = join(homedir(), '.sanook', 'gateway');
const TASKS_FILE = join(GATEWAY_DIR, 'tasks.json');

export type TaskKind = 'cron' | 'message' | 'once';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Task {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  /** prompt/คำสั่งที่จะรัน */
  spec: string;
  /** raw schedule string สำหรับ recurring ("every 30m", "09:00", ISO) — undefined = one-shot */
  schedule?: string;
  /** model spec override (ไม่ใส่ = ใช้ default ของ gateway) */
  model?: string;
  /** ปลายทางผลลัพธ์ (v1 = 'local' เก็บใน ledger; channel adapter = phase ต่อไป) */
  deliver?: string;
  /** epoch ms — เมื่อไรควรรันรอบถัดไป */
  runAt: number;
  lastRun?: number;
  lastResult?: string;
  lastError?: string;
  createdAt: number;
}

export interface NewTask {
  kind: TaskKind;
  spec: string;
  schedule?: string;
  model?: string;
  deliver?: string;
  runAt: number;
}

/** JSON task store — อ่านทั้งไฟล์/เขียนทั้งไฟล์ (task น้อย, single-user) + atomic rename */
export class TaskLedger {
  private constructor(private tasks: Task[]) {}

  static async open(): Promise<TaskLedger> {
    let tasks: Task[] = [];
    try {
      const raw = await readFile(TASKS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) tasks = parsed as Task[];
    } catch {
      // ยังไม่มีไฟล์ / พัง → เริ่ม empty (ไม่ทำลายของเดิมเพราะ write แบบ atomic)
    }
    return new TaskLedger(tasks);
  }

  private async flush(): Promise<void> {
    await mkdir(GATEWAY_DIR, { recursive: true });
    const tmp = `${TASKS_FILE}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.tasks, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, TASKS_FILE); // atomic — reader ไม่เห็นไฟล์ครึ่งๆ
    await chmod(TASKS_FILE, 0o600).catch(() => {});
  }

  list(): Task[] {
    return [...this.tasks];
  }

  get(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  async enqueue(t: NewTask): Promise<Task> {
    const task: Task = {
      id: randomUUID().slice(0, 8),
      status: 'queued',
      createdAt: Date.now(),
      ...t,
    };
    this.tasks.push(task);
    await this.flush();
    return task;
  }

  /** task ที่ถึงเวลาแล้วและยัง queued */
  due(now = Date.now()): Task[] {
    return this.tasks.filter((t) => t.status === 'queued' && t.runAt <= now);
  }

  async update(id: string, patch: Partial<Task>): Promise<void> {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    await this.flush();
  }

  async remove(id: string): Promise<boolean> {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.tasks.length === before) return false;
    await this.flush();
    return true;
  }
}
