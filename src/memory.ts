import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { appHomePath, BRAND, persistenceEnabled, worklogEnabled } from './brand.js';
import { redactKey } from './providers/keys.js';
import { loadStore, saveStore, mergeFact, maybeConsolidate, consolidate, renderPromptBlock, type NoteType } from './memory-store.js';

const MEMORY_FILE = BRAND.memoryFileName;
// auto-memory (สิ่งที่ agent จำเองข้าม session) ย้ายไปอยู่ใน ./memory-store.ts —
// memory.json เป็น source of truth, MEMORY.md เป็น view ที่ render จากมัน
// เดินขึ้นหยุดที่ project root — ไม่เลยขึ้นไปถึง filesystem root
// (กัน prompt-injection จาก SANOOK.md ที่ใครก็วางใน parent dir ที่ share กันได้)
const BOUNDARY_MARKERS = ['.git', 'package.json'];

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * โหลด project memory (SANOOK.md) แบบ hierarchical:
 * global (~/.sanook/SANOOK.md) → project root → ... → cwd
 * - หยุดเดินขึ้นที่ project boundary (.git/package.json) ไม่ถึง / (security)
 * - normalize cwd เป็น absolute ก่อนเดิน (กัน infinite loop จาก relative path)
 * ไฟล์ที่ specific กว่า (ใกล้ cwd) อยู่ท้าย = override general
 */
export async function loadMemory(cwd: string = process.cwd()): Promise<string> {
  const start = resolve(cwd); // → absolute เสมอ

  // chain จาก cwd ขึ้นไปจนเจอ project boundary (หรือถึง fs root)
  const chain: string[] = [];
  let dir = start;
  for (;;) {
    chain.push(dir);
    const atBoundary = (await Promise.all(BOUNDARY_MARKERS.map((mk) => exists(join(dir, mk))))).some(Boolean);
    if (atBoundary) break;
    const parent = dirname(dir);
    if (parent === dir) break; // ถึง fs root — guard กัน infinite loop
    dir = parent;
  }
  chain.reverse(); // project root ก่อน → cwd ท้าย (local override general)

  const paths = [appHomePath(MEMORY_FILE), ...chain.map((d) => join(d, MEMORY_FILE))];

  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    try {
      const content = (await readFile(p, 'utf8')).trim();
      if (content) blocks.push(`<memory src="${p}">\n${content}\n</memory>`);
    } catch {
      // ไม่มีไฟล์ = ข้าม
    }
  }
  return blocks.join('\n\n');
}

/**
 * โหลด auto-memory เข้า system prompt — render จาก structured store (./memory-store.ts)
 * เป็น block ที่ rank + cap แล้ว (top facts ตาม importance·recency, ≤ ~2k token กัน context-rot)
 * contract เดิม: '' ถ้าว่าง, ไม่งั้นคืน <auto_memory> block เดียวที่ self-contained
 */
export async function loadAutoMemory(): Promise<string> {
  try {
    return renderPromptBlock(await loadStore());
  } catch {
    return '';
  }
}

/**
 * โหลด context ของ second-brain vault ที่ user scaffold ไว้ (sanook brain) — ทำให้ agent
 * "รู้จัก" vault: inject Shared/AI-Context-Index.md (ไฟล์ที่ vault บอกให้อ่านก่อน) เข้า system prompt
 * brainPath มาจาก ~/.sanook/config.json · ไม่มี/ไฟล์หาย → คืน '' (เงียบ)
 */
export async function loadBrainContext(): Promise<string> {
  const brainPath = await getBrainPath();
  return brainPath ? buildBrainContext(brainPath) : '';
}

/** ประกอบ brain context จาก vault path (pure → testable) — entry + current-state + remembered facts */
export async function buildBrainContext(brainPath: string): Promise<string> {
  const parts: string[] = [];
  // 1. entry/pointers (Vault Structure Map ฯลฯ)
  const idx = await readTrimmed(join(brainPath, 'Shared', 'AI-Context-Index.md'), 3000);
  if (idx) parts.push(idx);
  // 2. current-state — เนื้อจริง (live focus) ไม่ใช่แค่ pointer
  const cs = await readTrimmed(join(brainPath, 'Shared', 'Operating-State', 'current-state.md'), 1500);
  if (cs) parts.push(`## current-state\n${cs}`);
  // 3. ปิด loop: fact ที่ remember ไว้ (Memory-Inbox) กลับเข้า context — ไม่งั้น vault = write-only
  const inbox = await inboxCandidates(join(brainPath, 'Shared', 'Memory-Inbox', 'memory-inbox.md'), 1200);
  if (inbox) parts.push(`## remembered (Memory-Inbox)\n${inbox}`);
  if (!parts.length) return '';
  return `<brain_vault path="${brainPath}" note="second-brain ของ user — สิ่งที่จำไว้/state ปัจจุบันอยู่ใน block นี้; route โน้ตตาม Vault Structure Map; อ่าน/เขียนไฟล์ใน vault ด้วย absolute path ได้">\n${parts.join('\n\n')}\n</brain_vault>`;
}

/** อ่านไฟล์ + trim หัว N ตัว ('' ถ้าไม่มี/ว่าง) */
async function readTrimmed(p: string, max: number): Promise<string> {
  try {
    const c = (await readFile(p, 'utf8')).trim();
    if (!c) return '';
    return c.length > max ? `${c.slice(0, max)}\n…` : c;
  } catch {
    return '';
  }
}

/** ดึงรายการ "- ..." ใต้ "## New Candidates" จาก memory-inbox (fact ที่ remember ไว้) */
async function inboxCandidates(p: string, max: number): Promise<string> {
  try {
    const after = (await readFile(p, 'utf8')).split('## New Candidates')[1];
    if (!after) return '';
    const lines = after
      .split('\n')
      .filter((l) => l.trim().startsWith('- ') && !l.includes('_('))
      .map((l) => l.trim());
    const text = lines.join('\n').trim();
    return text.length > max ? `${text.slice(0, max)}\n…` : text;
  } catch {
    return '';
  }
}

/** path ของ second-brain vault จาก config (undefined = ไม่ได้ตั้ง) */
export async function getBrainPath(): Promise<string | undefined> {
  try {
    const cfg = JSON.parse(await readFile(appHomePath('config.json'), 'utf8')) as {
      brainPath?: string;
    };
    return cfg.brainPath;
  } catch {
    return undefined;
  }
}

/**
 * route fact เข้า vault Memory-Inbox (candidate buffer ตาม §4) — "AI เขียนลง second brain ของคุณ"
 * เขียนเฉพาะถ้า memory-inbox.md มีจริง (กันสร้างไฟล์ใน path ที่ไม่ใช่ vault) · คืน true ถ้าเขียน
 */
export async function appendToVaultInbox(brainPath: string, fact: string): Promise<boolean> {
  const p = join(brainPath, 'Shared', 'Memory-Inbox', 'memory-inbox.md');
  let content: string;
  try {
    content = await readFile(p, 'utf8');
  } catch {
    return false; // ไม่ใช่ vault ที่มีไฟล์นี้ → ไม่ route
  }
  const safeFact = redactKey(fact);
  const line = `- ${safeFact.trim().replace(/\s+/g, ' ')}`;
  if (content.includes(line)) return false; // dedup
  const marker = '## New Candidates';
  const next = content.includes(marker)
    ? content.replace(marker, `${marker}\n${line}`)
    : `${content.trimEnd()}\n${line}\n`;
  await writeFile(p, next);
  return true;
}

/** บันทึก worklog ย่อเข้า vault Sessions/ (รายวัน) — "second brain จำว่าวันนี้ทำอะไร" */
export async function appendBrainWorklog(
  brainPath: string,
  entry: { prompt: string; summary: string; model: string; today: string },
): Promise<boolean> {
  if (!persistenceEnabled() || !worklogEnabled()) return false;
  const dir = join(brainPath, 'Sessions');
  if (!(await exists(dir))) return false; // ไม่ใช่ vault → ข้าม
  const topic = entry.prompt.trim().split(/\s+/).slice(0, 6).join(' ').slice(0, 50) || 'work';
  const file = join(dir, `${entry.today}-worklog.md`);
  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch {
    content = `---\ntags: [session, session-log, worklog]\nnote_type: session-log\ncreated: ${entry.today}\nupdated: ${entry.today}\nparent: "[[Sessions/_Index]]"\nai_surface: history\n---\n\n# ${entry.today} — Worklog (auto by ${BRAND.cliName})\n\nup:: [[Sessions/_Index]]\n`;
  }
  const block = `\n## ${topic}\n- prompt: ${redactKey(entry.prompt).trim().slice(0, 200)}\n- model: ${entry.model}\n- ${redactKey(entry.summary).trim().slice(0, 300)}\n`;
  // แทรกก่อน up:: ท้ายไฟล์ (กัน up:: หลุดไปกลาง)
  const out = content.includes('\nup:: ')
    ? content.replace(/\nup:: .*$/s, `\n${block}\nup:: [[Sessions/_Index]]\n`)
    : `${content.trimEnd()}\n${block}`;
  await writeFile(file, out);
  return true;
}

// in-process write serializer: the AI SDK runs tool calls from one model step concurrently, so two
// `remember` calls in a turn would otherwise load → mergeFact → save on the SAME baseline and the
// last save would clobber the first (lost update). Chaining the read-modify-write makes them sequential.
let memWriteChain: Promise<unknown> = Promise.resolve();
function withMemLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = memWriteChain.then(fn, fn); // run regardless of the prior task's outcome
  memWriteChain = run.catch(() => {}); // a rejection must not break the chain for the next writer
  return run;
}

/**
 * บันทึก fact ลง auto-memory (remember tool เรียก) — "Merge, Don't Append":
 * โหลด store → mergeFact (ADD/UPDATE/NOOP/SUPERSEDE) → save (ถ้าไม่ใช่ no-write op)
 * → consolidate เป็นระยะ → route เข้า vault inbox (best-effort) เหมือนเดิม
 * read-modify-write ของ store และ vault inbox ถูก serialize ด้วย withMemLock กัน lost-update ตอน parallel remember
 */
export async function appendMemory(fact: string, noteType?: NoteType): Promise<void> {
  if (!persistenceEnabled()) return;
  const safeFact = redactKey(fact);
  await withMemLock(async () => {
    const store = await loadStore();
    const { store: next, op } = mergeFact(store, { text: safeFact, trust: 'agent', noteType });
    // PROTECTED_HALT = ไม่เขียน (ขัดกับ protected fact); op อื่นเขียนหมด (NOOP ก็เขียนเพราะ touch accessCount)
    if (op !== 'PROTECTED_HALT') {
      const toSave = maybeConsolidate(next) ? consolidate(next).store : next;
      await saveStore(toSave);
    }
    // route เข้า vault second-brain ด้วย (best-effort) — ส่ง plain redacted string เหมือนเดิม
    const brain = await getBrainPath();
    if (brain) await appendToVaultInbox(brain, safeFact).catch(() => false);
  });
}
