import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';

// session store — จำ conversation + ความคืบหน้า เพื่อ "ทำงานต่อได้" ไม่ลืมว่าทำถึงไหน
const SESSION_DIR = join(homedir(), '.sanook', 'sessions');

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

export async function saveSession(s: Session): Promise<void> {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(join(SESSION_DIR, `${s.id}.json`), `${JSON.stringify(s, null, 2)}\n`);
}

export async function loadSession(id: string): Promise<Session | null> {
  try {
    return JSON.parse(await readFile(join(SESSION_DIR, `${id}.json`), 'utf8')) as Session;
  } catch {
    return null;
  }
}

/** session ล่าสุด (สำหรับ --continue) */
export async function latestSession(): Promise<Session | null> {
  try {
    const ids = (await readdir(SESSION_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    if (!ids.length) return null;
    const sessions = (await Promise.all(ids.map(loadSession))).filter((s): s is Session => s !== null);
    sessions.sort((a, b) => b.updated.localeCompare(a.updated));
    return sessions[0] ?? null;
  } catch {
    return null;
  }
}
