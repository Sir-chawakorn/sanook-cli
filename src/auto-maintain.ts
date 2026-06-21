// ============================================================================
// src/auto-maintain.ts — "second brain ดูแลตัวเอง" — งาน maintenance ที่เคยต้องสั่งเอง
// (sanook brain consolidate / distill) ให้ทำอัตโนมัติ:
//   • startup: ถ้าครบ ~1 สัปดาห์ → consolidate memory + vault (dedup, archive stale, index) แบบ background
//   • exit / headless turn: distill บทสนทนา → durable memory (knowledge compound เอง)
// ทั้งหมด best-effort (ไม่ทำให้ flow ล้ม) และ "ไม่ลบของ" — ใช้ archive (กู้คืนได้) ไม่ใช่ delete.
// ปิดได้: config `autoMaintain=false` หรือ env SANOOK_DISABLE_AUTO_MAINTAIN=1.
// ============================================================================
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { appHomePath, envFlag, persistenceEnabled } from './brand.js';
import { loadConfig } from './config.js';

const STATE_FILE = 'auto-maintain.json';
/** วิ่ง vault/memory consolidation อย่างมากสัปดาห์ละครั้ง — กัน startup ทำงานหนักทุกครั้ง */
const CONSOLIDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** distill เก็บได้สูงสุดกี่ fact ต่อ session — กัน memory ท่วมจาก session เดียว */
const MAX_DISTILL_FACTS = 8;

interface AutoMaintainState {
  lastConsolidate: number;
}

type DistillableMessage = { role: 'user' | 'assistant'; content: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasTextContent(content: unknown): boolean {
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some(
    (part) =>
      part &&
      typeof part === 'object' &&
      'text' in part &&
      typeof (part as { text?: unknown }).text === 'string' &&
      (part as { text: string }).text.trim().length > 0,
  );
}

function isDistillableMessage(value: unknown): value is DistillableMessage {
  if (!isRecord(value)) return false;
  const { role, content } = value;
  return (role === 'user' || role === 'assistant') && hasTextContent(content);
}

/**
 * auto-maintenance เปิดโดย default. ปิดเมื่อ:
 *  - persistence ปิด (ไม่มีที่เก็บ memory อยู่แล้ว)
 *  - env SANOOK_DISABLE_AUTO_MAINTAIN=1
 *  - config autoMaintain === false (ผู้ใช้ตั้งปิดเอง)
 */
export async function autoMaintainEnabled(): Promise<boolean> {
  if (!persistenceEnabled()) return false;
  if (envFlag('SANOOK_DISABLE_AUTO_MAINTAIN')) return false;
  try {
    const cfg = await loadConfig({});
    return cfg.autoMaintain !== false;
  } catch {
    return true; // อ่าน config ไม่ได้ → default on
  }
}

async function readState(): Promise<AutoMaintainState> {
  try {
    const raw = await readFile(appHomePath(STATE_FILE), 'utf8');
    const v = JSON.parse(raw) as Partial<AutoMaintainState>;
    return { lastConsolidate: typeof v.lastConsolidate === 'number' ? v.lastConsolidate : 0 };
  } catch {
    return { lastConsolidate: 0 };
  }
}

async function writeState(state: AutoMaintainState): Promise<void> {
  try {
    await mkdir(appHomePath(), { recursive: true });
    await writeFile(appHomePath(STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    /* best-effort — ไม่ critical ถ้าเขียน state ไม่ได้ */
  }
}

/** true ถ้าถึงกำหนด consolidate รอบถัดไปแล้ว (เปิด + ครบ interval) — แยกไว้ให้ test ได้ */
export async function isConsolidationDue(now: number = Date.now()): Promise<boolean> {
  if (!(await autoMaintainEnabled())) return false;
  const { lastConsolidate } = await readState();
  if (!Number.isFinite(lastConsolidate) || lastConsolidate <= 0 || lastConsolidate > now) return true;
  return now - lastConsolidate >= CONSOLIDATE_INTERVAL_MS;
}

/**
 * เรียกตอน REPL เริ่ม (background, fire-and-forget): ถ้าครบสัปดาห์ → consolidate memory + vault
 * (dedup, archive stale ตาม decay, รัน retrieval ข้ามเพื่อความเร็ว) แล้วจดเวลาไว้. คืน status สั้น
 * ถ้ารัน, null ถ้าข้าม/ปิด. ไม่ throw (best-effort) เพื่อไม่กระทบการเปิด REPL.
 */
export async function maybeStartupMaintain(now: number = Date.now()): Promise<string | null> {
  if (!(await isConsolidationDue(now))) return null;
  // จดเวลา "ก่อน" รัน — กัน REPL หลายตัว/รันซ้อนยิง consolidate พร้อมกัน (จดทันทีถือว่า claim รอบนี้)
  await writeState({ lastConsolidate: now });
  try {
    const cfg = await loadConfig({});
    const { runBrainConsolidate } = await import('./brain-consolidate.js');
    const report = await runBrainConsolidate({
      brainPath: cfg.brainPath,
      apply: true,
      archive: true, // ย้าย stale → archive (กู้คืนได้) ไม่ลบ
      memory: true,
      runRetrieval: false, // ข้าม retrieval eval ตอน startup เพื่อความเร็ว
    });
    if (!report.ok) return null;
    const changes = (report.steps ?? []).reduce((n, s) => n + (s.applied?.length ?? 0), 0);
    return changes > 0 ? `auto-maintain: จัดระเบียบ memory + vault (${changes} รายการ)` : null;
  } catch {
    return null;
  }
}

/**
 * distill บทสนทนา → durable auto-memory (knowledge ที่ compound ข้าม session). เรียกตอนจบ session
 * (REPL exit) และตอนจบ turn (headless). best-effort, ไม่ throw. คืนจำนวน fact ที่เขียน.
 */
export async function autoDistillToMemory(messages: unknown): Promise<number> {
  if (!Array.isArray(messages) || !messages.length) return 0;
  if (!persistenceEnabled()) return 0;
  if (envFlag('SANOOK_DISABLE_AUTO_MAINTAIN')) return 0;
  if (!envFlag('SANOOK_AUTO_DISTILL') && !(await autoMaintainEnabled())) return 0;
  const distillableMessages = messages.filter(isDistillableMessage);
  if (!distillableMessages.length) return 0;
  try {
    const { distilledFactsFromMessages } = await import('./session-distill.js');
    const { appendMemory } = await import('./memory.js');
    const facts = distilledFactsFromMessages(distillableMessages).slice(0, MAX_DISTILL_FACTS);
    let written = 0;
    for (const fact of facts) {
      try {
        await appendMemory(fact);
        written += 1;
      } catch {
        // Keep auto-maintain best-effort, but only count facts that actually persisted.
      }
    }
    return written;
  } catch {
    return 0;
  }
}
