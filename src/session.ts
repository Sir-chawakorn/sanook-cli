import { chmod, readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ModelMessage } from 'ai';
import { appHomePath, persistenceEnabled } from './brand.js';
import { redactKey } from './providers/keys.js';

// session store — จำ conversation + ความคืบหน้า เพื่อ "ทำงานต่อได้" ไม่ลืมว่าทำถึงไหน
const SESSION_DIR = appHomePath('sessions');

export interface Session {
  id: string;
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
    messages: redactUnknown(s.messages) as ModelMessage[],
  };
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
  const path = join(SESSION_DIR, `${s.id}.json`);
  await writeFile(path, `${JSON.stringify(sanitizeSession(s), null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
}

export async function loadSession(id: string): Promise<Session | null> {
  try {
    return JSON.parse(await readFile(join(SESSION_DIR, `${id}.json`), 'utf8')) as Session;
  } catch {
    return null;
  }
}

/** session ล่าสุด (สำหรับ --continue). ค่า default จำกัดเฉพาะ cwd ปัจจุบัน กัน context ข้าม project */
export async function latestSession(cwd: string | null = process.cwd()): Promise<Session | null> {
  try {
    const ids = (await readdir(SESSION_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    if (!ids.length) return null;
    let sessions = (await Promise.all(ids.map(loadSession))).filter((s): s is Session => s !== null);
    if (cwd) {
      const current = await canonicalPath(cwd);
      const pairs = await Promise.all(sessions.map(async (s) => ({ session: s, cwd: await canonicalPath(s.cwd) })));
      sessions = pairs.filter((p) => p.cwd === current).map((p) => p.session);
    }
    sessions.sort((a, b) => b.updated.localeCompare(a.updated));
    return sessions[0] ?? null;
  } catch {
    return null;
  }
}
