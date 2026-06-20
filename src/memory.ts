import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { buildContextPackBlock, listContextPacks, readContextPackExcerpt, selectContextPack } from './context-pack.js';
import { buildProjectContextBlock, resolveVaultProject } from './project-registry.js';
import { appHomePath, BRAND, brainTranscriptEnvForced, persistenceEnabled, worklogEnabled } from './brand.js';
import { redactKey } from './providers/keys.js';
import { loadStore, saveStore, mergeFact, maybeConsolidate, consolidate, renderPromptBlock, type NoteType, type Incoming } from './memory-store.js';
import { renderPersonaProfile, type PersonaAnswers } from './persona.js';

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
export async function loadBrainContext(cwd: string = process.cwd()): Promise<string> {
  const brainPath = await getBrainPath();
  return brainPath ? buildBrainContext(brainPath, { cwd }) : '';
}

export type BrainContextPartStatus = 'present' | 'empty' | 'missing';

export interface BrainContextPart {
  id: 'ai-context-index' | 'current-state' | 'memory-inbox' | 'context-pack' | 'project-workspace';
  label: string;
  relPath: string;
  path: string;
  content: string;
  chars: number;
  maxChars: number;
  status: BrainContextPartStatus;
}

export interface BuildBrainContextOptions {
  /** When set, auto-select a matching Shared/Context-Packs/ bundle for this task. */
  taskQuery?: string;
  /** When set, auto-detect Projects/<slug>/ hot context from repo_path ↔ cwd. */
  cwd?: string;
  /** Force a vault project slug instead of cwd auto-detect. */
  projectSlug?: string;
}

/** ประกอบ source parts ชุดเดียวกับที่ inject เข้า prompt จริง — ให้ CLI inspect ได้โดยไม่ drift */
export async function buildBrainContextParts(brainPath: string, options: BuildBrainContextOptions = {}): Promise<BrainContextPart[]> {
  const idx = await readTrimmedPart({
    id: 'ai-context-index',
    label: 'AI Context Index',
    brainPath,
    relPath: 'Shared/AI-Context-Index.md',
    maxChars: 3000,
  });
  const currentState = await readTrimmedPart({
    id: 'current-state',
    label: 'Current State',
    brainPath,
    relPath: 'Shared/Operating-State/current-state.md',
    maxChars: 1500,
    wrap: (content) => `## current-state\n${content}`,
  });
  const inbox = await readInboxPart(brainPath, 'Shared/Memory-Inbox/memory-inbox.md', 1200);
  const parts: BrainContextPart[] = [idx, currentState, inbox];
  const project = await resolveVaultProject({
    brainPath,
    cwd: options.cwd,
    slug: options.projectSlug,
  });
  if (project) {
    const block = await buildProjectContextBlock(brainPath, project);
    parts.push({
      id: 'project-workspace',
      label: `Project (${project.slug})`,
      relPath: `${project.relDir}/`,
      path: join(brainPath, project.relDir),
      content: block,
      chars: block.length,
      maxChars: 3500,
      status: block ? 'present' : 'empty',
    });
  }
  const taskQuery = options.taskQuery?.trim();
  if (taskQuery) {
    const packs = await listContextPacks(brainPath);
    const selected = selectContextPack(taskQuery, packs);
    if (selected) {
      const relPath = selected.pack.relPath;
      const path = join(brainPath, relPath);
      const maxChars = 1200;
      const excerpt = await readContextPackExcerpt(brainPath, selected.pack, maxChars);
      parts.push({
        id: 'context-pack',
        label: `Context Pack (${selected.pack.slug})`,
        relPath,
        path,
        content: excerpt,
        chars: excerpt.length,
        maxChars,
        status: excerpt ? 'present' : 'empty',
      });
    }
  }
  return parts;
}

export function renderBrainContext(brainPath: string, parts: readonly BrainContextPart[]): string {
  const content = parts.map((part) => part.content).filter(Boolean);
  if (!content.length) return '';
  return `<brain_vault path="${brainPath}" note="second-brain ของ user — สิ่งที่จำไว้/state ปัจจุบันอยู่ใน block นี้; route โน้ตตาม Vault Structure Map; อ่าน/เขียนไฟล์ใน vault ด้วย absolute path ได้">\n${content.join('\n\n')}\n</brain_vault>`;
}

/** ประกอบ brain context จาก vault path (pure → testable) — entry + current-state + remembered facts + optional context pack */
export async function buildBrainContext(brainPath: string, options: BuildBrainContextOptions = {}): Promise<string> {
  return renderBrainContext(brainPath, await buildBrainContextParts(brainPath, options));
}

/** Build a standalone context-pack block for per-turn injection (turn-retrieval path). */
export { buildContextPackBlock };

async function readTrimmedPart(input: {
  id: BrainContextPart['id'];
  label: string;
  brainPath: string;
  relPath: string;
  maxChars: number;
  wrap?: (content: string) => string;
}): Promise<BrainContextPart> {
  const p = join(input.brainPath, input.relPath);
  try {
    const raw = (await readFile(p, 'utf8')).trim();
    const trimmed = raw.length > input.maxChars ? `${raw.slice(0, input.maxChars)}\n…` : raw;
    const content = trimmed ? input.wrap?.(trimmed) ?? trimmed : '';
    return {
      id: input.id,
      label: input.label,
      relPath: input.relPath,
      path: p,
      content,
      chars: content.length,
      maxChars: input.maxChars,
      status: content ? 'present' : 'empty',
    };
  } catch {
    return {
      id: input.id,
      label: input.label,
      relPath: input.relPath,
      path: p,
      content: '',
      chars: 0,
      maxChars: input.maxChars,
      status: 'missing',
    };
  }
}

/** ดึงรายการ "- ..." ใต้ "## New Candidates" จาก memory-inbox (fact ที่ remember ไว้) */
async function inboxCandidates(p: string, max: number): Promise<string> {
  try {
    return inboxCandidatesFromText(await readFile(p, 'utf8'), max);
  } catch {
    return '';
  }
}

function inboxCandidatesFromText(content: string, max: number): string {
  const lines = content.split('\n');
  const markerIndex = lines.findIndex((line) => line.trim() === '## New Candidates');
  if (markerIndex === -1) return '';
  const sectionLines: string[] = [];
  for (const line of lines.slice(markerIndex + 1)) {
    if (/^#{1,6}\s+/.test(line.trim())) break;
    sectionLines.push(line);
  }
  const candidates = sectionLines
    .filter((l) => l.trim().startsWith('- ') && !l.includes('_('))
    .map((l) => l.trim());
  const text = candidates.join('\n').trim();
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

async function readInboxPart(brainPath: string, relPath: string, maxChars: number): Promise<BrainContextPart> {
  const p = join(brainPath, relPath);
  try {
    const content = inboxCandidatesFromText(await readFile(p, 'utf8'), maxChars);
    const wrapped = content ? `## remembered (Memory-Inbox)\n${content}` : '';
    return {
      id: 'memory-inbox',
      label: 'Memory Inbox',
      relPath,
      path: p,
      content: wrapped,
      chars: wrapped.length,
      maxChars,
      status: wrapped ? 'present' : 'empty',
    };
  } catch {
    return {
      id: 'memory-inbox',
      label: 'Memory Inbox',
      relPath,
      path: p,
      content: '',
      chars: 0,
      maxChars,
      status: 'missing',
    };
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
 * เปิด/ปิดการเก็บ "บทสนทนาเต็ม" (prompt + คำตอบ AI ทุก turn) ลง vault หรือไม่ —
 * config.brainTranscript = true (persistent) หรือ env SANOOK_BRAIN_TRANSCRIPT (force ชั่วคราว)
 */
export async function brainTranscriptEnabled(): Promise<boolean> {
  if (!persistenceEnabled()) return false;
  if (brainTranscriptEnvForced()) return true;
  try {
    const cfg = JSON.parse(await readFile(appHomePath('config.json'), 'utf8')) as {
      brainTranscript?: boolean;
    };
    return cfg.brainTranscript === true;
  } catch {
    return false;
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
function worklogHeader(today: string): string {
  return `---\ntags: [session, session-log, worklog]\nnote_type: session-log\ncreated: ${today}\nupdated: ${today}\nparent: "[[Sessions/_Index]]"\nai_surface: history\n---\n\n# ${today} — Worklog (auto by ${BRAND.cliName})\n`;
}

function chatTranscriptHeader(today: string): string {
  return `---\ntags: [session, transcript, chat]\nnote_type: session-log\ncreated: ${today}\nupdated: ${today}\nparent: "[[Sessions/_Index]]"\nai_surface: history\n---\n\n# ${today} — Chat transcript (auto by ${BRAND.cliName})\n\n> บทสนทนาเต็มของ session นี้ — เก็บอัตโนมัติทุก turn\n`;
}

function ensureSessionNoteScaffold(content: string, header: string): string {
  const clean = content.trimEnd();
  let next = clean;
  if (!next) next = header.trimEnd();
  else if (!next.includes('note_type: session-log')) next = `${header.trimEnd()}\n\n${next}`;
  if (!next.includes('\nup:: ')) next = `${next.trimEnd()}\n\nup:: [[Sessions/_Index]]`;
  return `${next.trimEnd()}\n`;
}

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
    content = '';
  }
  content = ensureSessionNoteScaffold(content, worklogHeader(entry.today));
  const block = `\n## ${topic}\n- prompt: ${redactKey(entry.prompt).trim().slice(0, 200)}\n- model: ${entry.model}\n- ${redactKey(entry.summary).trim().slice(0, 300)}\n`;
  // แทรกก่อน up:: ท้ายไฟล์ (กัน up:: หลุดไปกลาง)
  const out = content.includes('\nup:: ')
    ? content.replace(/\nup:: .*$/s, `\n${block}\nup:: [[Sessions/_Index]]\n`)
    : `${content.trimEnd()}\n${block}`;
  await writeFile(file, out);
  return true;
}

/**
 * เก็บ "บทสนทนาเต็ม" ลง vault Sessions/<date>-<sid>-chat.md — ต่อ 1 turn = 1 block (prompt + คำตอบ AI)
 * ต่างจาก worklog (ย่อ prompt + cost): อันนี้เก็บข้อความจริงที่คุยกัน เพื่อ "ทุกอย่างที่คุยไปอยู่ใน second brain"
 * - gate: brainTranscriptEnabled() (config.brainTranscript / env) + ต้องมีโฟลเดอร์ Sessions/ (เป็น vault จริง)
 * - redact API key ทั้ง 2 ฝั่ง · serialize การเขียนไฟล์เดียวกันด้วย withMemLock กัน turn ชนกัน
 */
export async function appendBrainTranscript(
  brainPath: string,
  entry: { sessionId: string; prompt: string; answer: string; model: string; createdIso?: string },
): Promise<boolean> {
  if (!(await brainTranscriptEnabled())) return false;
  const dir = join(brainPath, 'Sessions');
  if (!(await exists(dir))) return false; // ไม่ใช่ vault → ข้าม
  const created = entry.createdIso ?? new Date().toISOString();
  const today = created.slice(0, 10);
  const sid = entry.sessionId.slice(-6) || 'session';
  const file = join(dir, `${today}-${sid}-chat.md`);
  const time = created.slice(11, 16); // HH:MM (UTC)
  const prompt = redactKey(entry.prompt).trim();
  const answer = redactKey(entry.answer).trim();
  if (!prompt && !answer) return false;

  return withMemLock(async () => {
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      content = '';
    }
    content = ensureSessionNoteScaffold(content, chatTranscriptHeader(today));
    const block = [`\n## ${time} · ${entry.model}`, '', '**You:**', '', prompt || '_(empty)_', '', `**${BRAND.agentName}:**`, '', answer || '_(no text output)_', ''].join('\n');
    const out = content.includes('\nup:: ')
      ? content.replace(/\nup:: .*$/s, `\n${block}\nup:: [[Sessions/_Index]]\n`)
      : `${content.trimEnd()}\n${block}`;
    await writeFile(file, out);
    return true;
  });
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

/**
 * เขียน persona/identity ที่เก็บตอน setup (ขั้นที่ 9) ลง durable auto-memory เป็น owner ground-truth
 * (tier protected, trust owner) → หลัง setup เสร็จ agent "จำ" ว่าเจ้าของชื่ออะไร / เรียก AI ว่าอะไร /
 * ภาษา + autonomy ทันที โดยไม่ต้องรอ remember. ใช้คู่กับ scaffoldBrain ที่ substitute ลงไฟล์ vault อยู่แล้ว.
 * idempotent: เขียนซ้ำ = NOOP (mergeFact). ข้ามค่า default/ว่าง เพื่อไม่ปน noise.
 */
export async function seedPersonaMemory(input: {
  ownerName?: string;
  aiName?: string;
  language?: string;
  autonomy?: string;
  defaults?: { ownerName?: string; aiName?: string };
}): Promise<number> {
  if (!persistenceEnabled()) return 0;
  const facts: Incoming[] = [];
  const owner = input.ownerName?.trim();
  const ai = input.aiName?.trim();
  const lang = input.language?.trim();
  const autonomy = input.autonomy?.trim();
  if (owner && owner !== input.defaults?.ownerName) facts.push({ text: `เจ้าของชื่อ ${owner} — เรียกเจ้าของด้วยชื่อนี้`, noteType: 'entity', trust: 'owner', tier: 'protected' });
  if (ai && ai !== input.defaults?.aiName) facts.push({ text: `AI เรียกตัวเองว่า "${ai}" เมื่อคุยกับเจ้าของ`, noteType: 'preference', trust: 'owner', tier: 'protected' });
  if (lang) facts.push({ text: `ภาษาที่เจ้าของต้องการให้ตอบ: ${lang}`, noteType: 'preference', trust: 'owner', tier: 'protected' });
  if (autonomy) facts.push({ text: `ระดับ autonomy ที่เจ้าของเลือก: ${autonomy}`, noteType: 'preference', trust: 'owner', tier: 'protected' });
  if (!facts.length) return 0;
  let written = 0;
  await withMemLock(async () => {
    let store = await loadStore();
    for (const inc of facts) {
      const { store: next, op } = mergeFact(store, { ...inc, text: redactKey(inc.text) });
      // persist any store mutation (NOOP bumps accessCount, QUARANTINE holds the fact aside),
      // but only count facts actually remembered as new/changed — so a re-run with identical
      // answers reports "nothing new" instead of falsely claiming N facts were saved.
      if (op !== 'PROTECTED_HALT') {
        store = next;
        if (op === 'ADD' || op === 'UPDATE' || op === 'SUPERSEDE') written += 1;
      }
    }
    await saveStore(store);
  });
  return written;
}

/**
 * เขียน persona facts จาก `sanook persona` ลง durable auto-memory เป็น owner ground-truth
 * (tier protected, trust owner) → agent "จำ" persona ทันทีทุก session โดยไม่ต้องรอ remember.
 * idempotent: เขียนซ้ำ = merge/NOOP. รับ plain-string facts (สร้างจาก personaFacts()).
 */
export async function seedPersonaFacts(facts: string[]): Promise<number> {
  if (!persistenceEnabled()) return 0;
  const list = facts.map((f) => f.trim()).filter(Boolean);
  if (!list.length) return 0;
  let written = 0;
  await withMemLock(async () => {
    let store = await loadStore();
    for (const text of list) {
      const { store: next, op } = mergeFact(store, {
        text: redactKey(text),
        noteType: 'preference',
        trust: 'owner',
        tier: 'protected',
      });
      // persist any store mutation (NOOP bumps accessCount, QUARANTINE holds the fact aside),
      // but only count facts actually remembered as new/changed — so a re-run with identical
      // answers reports "nothing new" instead of falsely claiming N facts were saved.
      if (op !== 'PROTECTED_HALT') {
        store = next;
        if (op === 'ADD' || op === 'UPDATE' || op === 'SUPERSEDE') written += 1;
      }
    }
    await saveStore(store);
  });
  return written;
}

/**
 * เขียนโปรไฟล์ persona ลง second-brain vault ที่ Shared/User-Persona/persona.md
 * (เขียนทับเสมอ — ไฟล์นี้เป็น canonical output ของ `sanook persona`). คืน false ถ้าไม่ใช่ vault จริง.
 */
export async function writePersonaProfile(brainPath: string, answers: PersonaAnswers): Promise<boolean> {
  const personaDir = join(brainPath, 'Shared', 'User-Persona');
  if (!(await exists(personaDir))) return false; // ไม่ใช่ vault ที่ scaffold แล้ว → ข้าม
  const today = new Date().toISOString().slice(0, 10);
  const md = redactKey(renderPersonaProfile(answers, today));
  await writeFile(join(personaDir, 'persona.md'), md);
  return true;
}
