import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withFileLock } from './lock.js';
import { appHomePath } from '../brand.js';

// task-ledger = งานที่ gateway ต้องทำ (cron / message / one-shot) — Hermes "Kanban" / OpenClaw "Task Brain"
// เก็บเป็น JSON (zero native dep) แทน SQLite; ทุก mutation = locked read-modify-write (atomic ต่อ op)
// → กัน lost-write จากหลาย writer (server enqueue / scheduler update / cron CLI) ที่ยิงไฟล์เดียวกัน
const GATEWAY_DIR = appHomePath('gateway');
const TASKS_FILE = join(GATEWAY_DIR, 'tasks.json');
const LOCK_FILE = join(GATEWAY_DIR, 'tasks.lock');

export type TaskKind = 'cron' | 'message' | 'once';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Task {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  spec: string;
  /** raw schedule string สำหรับ recurring ("every 30m", "09:00", ISO) — undefined = one-shot */
  schedule?: string;
  model?: string;
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

// ── low-level: read ตรงจากไฟล์ทุกครั้ง (ไม่ cache snapshot → ไม่มี stale-overwrite) ──
async function readTasks(): Promise<Task[]> {
  try {
    const parsed = JSON.parse(await readFile(TASKS_FILE, 'utf8'));
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  } catch {
    return []; // ไม่มีไฟล์/พัง → empty (write แบบ atomic จึงไม่ทำลายของเดิม)
  }
}

async function writeTasks(tasks: Task[]): Promise<void> {
  await mkdir(GATEWAY_DIR, { recursive: true });
  const tmp = `${TASKS_FILE}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(tasks, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, TASKS_FILE); // atomic — reader ไม่เห็นไฟล์ครึ่งๆ
  await chmod(TASKS_FILE, 0o600).catch(() => {});
}

/** mutation ทุกตัววิ่งผ่านนี่: lock → re-read สด → แก้ → write (ไม่ trust snapshot เก่า) */
async function mutate<T>(fn: (tasks: Task[]) => { tasks: Task[]; result: T }): Promise<T> {
  await mkdir(GATEWAY_DIR, { recursive: true });
  return withFileLock(LOCK_FILE, async () => {
    const tasks = await readTasks();
    const { tasks: next, result } = fn(tasks);
    await writeTasks(next);
    return result;
  });
}

// ── reads (lock-free — atomic rename กัน torn read อยู่แล้ว) ──
export function listTasks(): Promise<Task[]> {
  return readTasks();
}

export async function getTask(id: string): Promise<Task | undefined> {
  return (await readTasks()).find((t) => t.id === id);
}

export async function dueTasks(now = Date.now()): Promise<Task[]> {
  return (await readTasks()).filter((t) => t.status === 'queued' && t.runAt <= now);
}

// ── mutations (locked, atomic, re-read สด) ──
export async function enqueueTask(t: NewTask): Promise<Task> {
  const task: Task = { id: randomUUID().slice(0, 8), status: 'queued', createdAt: Date.now(), ...t };
  await mutate((tasks) => {
    tasks.push(task);
    return { tasks, result: undefined };
  });
  return task;
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  await mutate((tasks) => {
    const t = tasks.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
    return { tasks, result: undefined };
  });
}

export async function removeTask(id: string): Promise<boolean> {
  return mutate((tasks) => {
    const next = tasks.filter((t) => t.id !== id);
    return { tasks: next, result: next.length !== tasks.length };
  });
}

/** atomic claim: queued → running. false ถ้าโดน claim ไปแล้ว (กัน 2 writer รัน task เดียวกัน) */
export async function claimTask(id: string): Promise<boolean> {
  return mutate((tasks) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status !== 'queued') return { tasks, result: false };
    t.status = 'running';
    return { tasks, result: true };
  });
}

/** recover task ที่ค้าง 'running' (จาก crash/shutdown กลางคัน) → 'queued'. เรียกตอน gateway start */
export async function recoverStaleRunning(): Promise<number> {
  return mutate((tasks) => {
    let n = 0;
    for (const t of tasks) {
      if (t.status === 'running') {
        t.status = 'queued';
        n++;
      }
    }
    return { tasks, result: n };
  });
}
