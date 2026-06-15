import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { appHomePath, persistenceEnabled } from '../brand.js';

// prompt history แบบ persist ข้าม session (เลียน shell history) — เก็บที่ ~/.sanook/history
const HISTORY_PATH = appHomePath('history');
const MAX_ENTRIES = 500;

/** โหลด prompt เก่า (เก่า→ใหม่) สำหรับ Up/Down navigation ใน REPL */
export function loadHistory(): string[] {
  try {
    const lines = readFileSync(HISTORY_PATH, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** append 1 prompt (ข้ามถ้าซ้ำกับอันล่าสุด / เป็น slash command / ว่าง) */
export function appendHistory(prompt: string, last?: string): void {
  if (!persistenceEnabled()) return;
  const p = prompt.trim();
  if (!p || p === last) return;
  try {
    mkdirSync(appHomePath(), { recursive: true });
    appendFileSync(HISTORY_PATH, `${p.replace(/\n/g, ' ')}\n`, { mode: 0o600 });
  } catch {
    /* เขียนไม่ได้ = ไม่เป็นไร (history เป็น nice-to-have) */
  }
}
