import { readFileSync, appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { appHomePath, persistenceEnabled } from '../brand.js';

// prompt history แบบ persist ข้าม session (เลียน shell history) — เก็บที่ ~/.sanook/history
const HISTORY_PATH = appHomePath('history');
const MAX_ENTRIES = 500;

function historyLines(): string[] {
  return readFileSync(HISTORY_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function trimHistoryFile(): void {
  const lines = historyLines();
  if (lines.length <= MAX_ENTRIES) return;
  writeFileSync(HISTORY_PATH, `${lines.slice(-MAX_ENTRIES).join('\n')}\n`, { mode: 0o600 });
}

function lastPersistedPrompt(): string | undefined {
  try {
    return historyLines().at(-1);
  } catch {
    return undefined;
  }
}

function persistedPrompt(prompt: string): string {
  return prompt.replace(/[\r\n]+/g, ' ');
}

function samePersistedPrompt(persisted: string, last?: string): boolean {
  return last !== undefined && persisted === persistedPrompt(last.trim());
}

/** โหลด prompt เก่า (เก่า→ใหม่) สำหรับ Up/Down navigation ใน REPL */
export function loadHistory(): string[] {
  if (!persistenceEnabled()) return [];
  try {
    return historyLines().slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** append 1 prompt (ข้ามถ้าซ้ำกับอันล่าสุด / เป็น slash command / ว่าง) */
export function appendHistory(prompt: string, last?: string): void {
  if (!persistenceEnabled()) return;
  const p = prompt.trim();
  if (!p || p.startsWith('/')) return;
  const persisted = persistedPrompt(p);
  if (samePersistedPrompt(persisted, last) || persisted === lastPersistedPrompt()) return;
  try {
    mkdirSync(appHomePath(), { recursive: true });
    appendFileSync(HISTORY_PATH, `${persisted}\n`, { mode: 0o600 });
    trimHistoryFile();
    chmodSync(HISTORY_PATH, 0o600);
  } catch {
    /* เขียนไม่ได้ = ไม่เป็นไร (history เป็น nice-to-have) */
  }
}
