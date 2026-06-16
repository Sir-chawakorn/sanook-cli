import { chmod, readFile, writeFile, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ModelMessage } from 'ai';
import { appHomePath, persistenceEnabled } from './brand.js';
import { redactKey } from './providers/keys.js';

// session store — จำ conversation + ความคืบหน้า เพื่อ "ทำงานต่อได้" ไม่ลืมว่าทำถึงไหน
const SESSION_DIR = appHomePath('sessions');

export interface Session {
  id: string;
  title?: string;
  created: string;
  updated: string;
  model: string;
  cwd: string;
  messages: ModelMessage[];
}

export function newSessionId(): string {
  // CLI runtime — ใช้ Date/random ได้ (ไม่ใช่ workflow context)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${ts}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sessionStorePath(): string {
  return SESSION_DIR;
}

function sessionFilePath(id: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(id) || id.includes('..')) {
    throw new Error(`session id ไม่ถูกต้อง: ${id}`);
  }
  return join(SESSION_DIR, `${id}.json`);
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') return redactKey(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactUnknown(v)]));
  }
  return value;
}

function sanitizeSession(s: Session): Session {
  return {
    ...s,
    title: typeof s.title === 'string' ? redactKey(s.title) : s.title,
    messages: redactUnknown(s.messages) as ModelMessage[],
  };
}

export function sanitizeSessionForExport(s: Session): Session {
  return sanitizeSession(s);
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

export async function saveSession(s: Session): Promise<void> {
  if (!persistenceEnabled()) return;
  await mkdir(SESSION_DIR, { recursive: true });
  const path = sessionFilePath(s.id);
  await writeFile(path, `${JSON.stringify(sanitizeSession(s), null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
}

export async function loadSession(id: string): Promise<Session | null> {
  try {
    return JSON.parse(await readFile(sessionFilePath(id), 'utf8')) as Session;
  } catch {
    return null;
  }
}

export async function listSessions(options: { cwd?: string | null; limit?: number } = {}): Promise<Session[]> {
  try {
    const cwd = options.cwd === undefined ? process.cwd() : options.cwd;
    const ids = (await readdir(SESSION_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    if (!ids.length) return [];
    let sessions = (await Promise.all(ids.map(loadSession))).filter((s): s is Session => s !== null);
    if (cwd) {
      const current = await canonicalPath(cwd);
      const pairs = await Promise.all(sessions.map(async (s) => ({ session: s, cwd: await canonicalPath(s.cwd) })));
      sessions = pairs.filter((p) => p.cwd === current).map((p) => p.session);
    }
    sessions.sort((a, b) => b.updated.localeCompare(a.updated));
    const limit = options.limit;
    return typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? sessions.slice(0, limit) : sessions;
  } catch {
    return [];
  }
}

export async function removeSession(id: string): Promise<boolean> {
  try {
    await rm(sessionFilePath(id), { force: false });
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    throw e;
  }
}

export async function renameSession(id: string, title: string): Promise<Session | null> {
  const session = await loadSession(id);
  if (!session) return null;
  const next = { ...session, title: title.trim(), updated: new Date().toISOString() };
  await saveSession(next);
  return next;
}

export async function pruneSessions(options: { cwd?: string | null; keep?: number; before?: Date } = {}): Promise<Session[]> {
  const sessions = await listSessions({ cwd: options.cwd });
  const removeIds = new Set<string>();
  if (Number.isInteger(options.keep) && options.keep! >= 0) {
    for (const s of sessions.slice(options.keep)) removeIds.add(s.id);
  }
  if (options.before) {
    const beforeMs = options.before.getTime();
    for (const s of sessions) {
      const updatedMs = Date.parse(s.updated);
      if (Number.isFinite(updatedMs) && updatedMs < beforeMs) removeIds.add(s.id);
    }
  }
  const removed = sessions.filter((s) => removeIds.has(s.id));
  for (const s of removed) await removeSession(s.id);
  return removed;
}

/** session ล่าสุด (สำหรับ --continue). ค่า default จำกัดเฉพาะ cwd ปัจจุบัน กัน context ข้าม project */
export async function latestSession(cwd: string | null = process.cwd()): Promise<Session | null> {
  return (await listSessions({ cwd, limit: 1 }))[0] ?? null;
}
