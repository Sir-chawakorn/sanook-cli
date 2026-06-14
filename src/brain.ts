import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** ขยาย ~ ขึ้นต้น path เป็น home dir */
export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p;
}

// bundled rich templates (Home/USER/constitution/core memory/Templates) — sibling ของ skills/ ใน package
// (ship ผ่าน package.json "files", ไม่ผ่าน tsc — เหมือน BUNDLED_SKILLS ใน skills.ts)
const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'second-brain');

export type Autonomy = 'ask-first' | 'ask-on-risk' | 'act-first';

export interface BrainConfig {
  ownerName: string;
  aiName: string;
  aiPronoun: string;
  language: string;
  tone: string;
  vaultName: string;
  autonomy: Autonomy;
  today: string; // YYYY-MM-DD — ส่งเข้ามา (ไม่เรียก Date ใน engine → test ได้ deterministic)
}

export const BRAIN_DEFAULTS: Omit<BrainConfig, 'today'> = {
  ownerName: 'Owner',
  aiName: 'ผู้ช่วย',
  aiPronoun: 'เรา',
  language: 'ไทย + tech-en',
  tone: 'กระชับ ตรงประเด็น สุภาพ',
  vaultName: 'Second Brain',
  autonomy: 'ask-on-risk',
};

/**
 * โฟลเดอร์ทั้งหมด + บทบาท (จาก GEMINI.md §B.0 Folder Role Table) → generate _Index.md ให้ทุกอัน
 * top-level parent = Home · Shared/<x> parent = Shared/_Index (Shared เองชี้ Home)
 */
// ⚠ sync กับ second-brain/Vault Structure Map.md — แก้ role/โฟลเดอร์ ต้องแก้ทั้งสองที่ (มี test กัน drift)
export const FOLDERS: { dir: string; role: string }[] = [
  // Core (MVV)
  { dir: 'Projects', role: 'workspace ของงานจริง — 1 โฟลเดอร์ = 1 โปรเจค (overview/context/current-state)' },
  { dir: 'Sessions', role: 'flat chronological log ของงาน + checkpoint (YYYY-MM-DD-<topic>.md)' },
  { dir: 'Intake', role: 'จุดรับของใหม่เข้า vault (raw input + task framing) ก่อนกระจายเข้าปลายทาง' },
  { dir: 'Intake/_Quarantine', role: 'external content (web/paste) ที่ยัง untrusted — scan injection ก่อน promote (ดู Runbooks/ingest-quarantine)' },
  { dir: 'Intake/Raw Sources', role: 'ต้นฉบับ external ที่ผ่าน scan แล้ว — immutable read-only, source:: ชี้มาที่นี่ได้' },
  { dir: 'Skills', role: 'reusable unit ที่ executable + ผ่าน verification command — ไม่ใช่ prose (นั่นคือ Runbooks) ดู Shared/Rules/skills-admission' },
  { dir: 'Runbooks', role: 'prose how-to ที่อ่านแล้วทำตามเอง (setup/deploy/maintain) — ไม่ใช่ runnable unit (นั่นคือ Skills)' },
  { dir: 'Templates', role: 'แม่แบบโน้ต — instantiate จากที่นี่ตอนสร้างโน้ตใหม่' },
  { dir: 'Bugs', role: 'bug report reproducible ลงวันที่ ไม่ลบ — project bug ก็มาที่นี่ (global, flat) + link กลับ project' },
  { dir: 'Handoffs', role: 'เอกสารส่งมอบงานค้าง 1 ชิ้น (state + next steps) — snapshot ครั้งเดียว ไม่ใช่ live coordination' },
  // Direction
  { dir: 'Goals', role: 'north-star + objective รายไตรมาส/ปี (finite, มีวันจบ) — ไม่เก็บ live status (นั่นคือ Operating-State)' },
  { dir: 'Areas', role: 'PARA — โดเมนงานต่อเนื่องที่ไม่มีวันจบ (brand/trading/content...)' },
  // Knowledge pipeline
  { dir: 'Research', role: 'finding ที่อิงแหล่งภายนอก (มี source::) + market scan + reference synthesis' },
  { dir: 'Learning', role: 'knowledge ที่ตัวเองกลั่น/deep-dive ตาม topic (ไม่มี external source) — curated MOC' },
  { dir: 'Distillations', role: 'หลักการ evergreen ที่กลั่นนิ่งแล้ว (เห็น ≥3 ครั้ง) — atomic' },
  { dir: 'Retrospectives', role: 'reflection หลังงาน (event-triggered: what worked/failed)' },
  { dir: 'Reviews', role: 'review ตาม cadence (time-triggered: weekly/monthly) + vault health' },
  { dir: 'Traces', role: 'exploration/reasoning chain ยาว (คำถามใหญ่เกินโน้ตเดียว)' },
  { dir: 'Prompts', role: 'prompt text/template ที่หยิบมารันได้ทันที (input ให้ LLM)' },
  { dir: 'Acceptance', role: 'golden input→expected-output fixtures ที่ใช้ตัดสิน done/not-done — ไม่ใช่ checklist, ไม่ใช่ runner (นั่นคือ Evals)' },
  { dir: 'Checklists', role: 'preflight/postflight gate (ticklist ก่อน-หลังลงมือ) — ไม่เก็บ expected output' },
  // Frontier loops
  { dir: 'Playbooks', role: 'กลยุทธ์/ลำดับการตัดสินใจที่ปรับดีขึ้นจากผลจริง (how-to-decide) — ไม่ใช่ prompt text, ไม่ใช่ runnable unit' },
  { dir: 'Evals', role: 'quality loop ที่รัน Acceptance/golden-set แล้ว error-analysis + self-eval (runner + ผล, ไม่เก็บ case เอง)' },
  { dir: 'Entities', role: 'canonical page ต่อ entity/person/org/concept (LLM-wiki, bi-temporal)' },
  // Shared (สมองกลาง) — Shared/_Index เองชี้ Home
  { dir: 'Shared', role: 'สมองกลาง: memory + rules + coordination (เข้าผ่าน AI-Context-Index)' },
  { dir: 'Shared/Operating-State', role: 'live status/metrics ตอนนี้ (current-state + health/queue)' },
  { dir: 'Shared/User-Memory', role: 'สิ่งที่ AI เรียนรู้เกี่ยวกับเจ้าของระหว่างทำงาน — preference/response-example (mutable)' },
  { dir: 'Shared/Decision-Memory', role: 'การตัดสินใจที่ AI บันทึก locked (latest-wins + supersedes)' },
  { dir: 'Shared/Memory-Inbox', role: 'candidate durable memory ที่ยังไม่ชัด/ขัดกัน — รอ promote (เคลียร์ทุก weekly)' },
  { dir: 'Shared/Rules', role: 'กฎ operating always-on (memory/frontmatter/context-assembly/graph)' },
  { dir: 'Shared/Tech-Standards', role: 'มาตรฐานเทคนิค (MCP/stack/DoD/verification)' },
  { dir: 'Shared/Core-Facts', role: 'ground truth ที่เจ้าของเขียนเอง — read-only, AI ไม่ supersede/ไม่แก้' },
  { dir: 'Shared/Coordination', role: 'live coordination ของหลาย agent พร้อมกัน (NOW.md baton + task-board + registry) — ไม่ใช่เอกสารส่งมอบ (นั่นคือ Handoffs)' },
  { dir: 'Shared/Working-Memory', role: 'scratchpad ระหว่าง 1 task — ลบทิ้งได้หลังจบ ไม่มีวัน promote' },
  { dir: 'Shared/User-Persona', role: 'identity profile ที่เปลี่ยนน้อยมาก (บทบาท/ค่านิยม/ภาษา/timezone) — human-owned, read-only' },
  { dir: 'Shared/Provenance', role: 'lineage ledger — ทุก claim ชี้ source:: ได้ (ingest-log)' },
  { dir: 'Shared/Archive', role: 'cold storage — โน้ตที่ stale/retired ออกจาก retrieval (ไม่ลบ)' },
];

/** แทน {{KEY}} ด้วยค่าจริงจาก config */
export function substitute(text: string, cfg: BrainConfig): string {
  const map: Record<string, string> = {
    OWNER_NAME: cfg.ownerName,
    OWNER_ADDRESS: cfg.ownerName,
    AI_NAME: cfg.aiName,
    AI_PRONOUN: cfg.aiPronoun,
    LANGUAGE: cfg.language,
    TONE: cfg.tone,
    VAULT_NAME: cfg.vaultName,
    AUTONOMY: cfg.autonomy,
    DATE: cfg.today,
  };
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (key in map ? map[key] : whole));
}

/** generate _Index.md ของโฟลเดอร์ — frontmatter + role + up:: (ตาม §18 / §B.3 rule 2-3) */
function renderIndex(dir: string, role: string, cfg: BrainConfig): string {
  const name = dir.split('/').pop() ?? dir;
  // parent = _Index ของโฟลเดอร์แม่ (nested) หรือ Home (top-level)
  const parent = dir.includes('/') ? `${dir.split('/').slice(0, -1).join('/')}/_Index` : 'Home';
  const tag = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `---
tags: [index, moc, ${tag}]
note_type: moc
created: ${cfg.today}
updated: ${cfg.today}
parent: "[[${parent}]]"
---

# ${name}

> ${role}

_(ยังว่าง — โน้ตในโฟลเดอร์นี้จะถูกลิงก์ที่นี่)_

up:: [[${parent}]]
`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** write ถ้ายังไม่มี (create-if-missing — §B.3 rule 1: ห้ามทับของเดิม) */
async function writeIfMissing(
  path: string,
  content: string,
  created: string[],
  skipped: string[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (await exists(path)) {
    skipped.push(path);
    return;
  }
  await writeFile(path, content, 'utf8');
  created.push(path);
}

/** เดิน bundled template dir → คืน rel path ของไฟล์ทั้งหมด (ไม่มี dir → คืน []) */
async function walk(dir: string, base: string = dir): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

/**
 * สร้างโครง second-brain ที่ targetPath — create-if-missing เสมอ
 * 1) ทุกโฟลเดอร์ใน FOLDERS + _Index.md (generated)
 * 2) rich seed files จาก bundled second-brain/ (Home/USER/constitution/core memory/Templates) + substitute
 * 3) .obsidian/app.json ว่าง (ให้ Obsidian จำเป็น vault)
 */
export async function scaffoldBrain(
  targetPath: string,
  cfg: BrainConfig,
): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];

  // 1) folders + generated _Index
  for (const { dir, role } of FOLDERS) {
    await mkdir(join(targetPath, dir), { recursive: true });
    await writeIfMissing(join(targetPath, dir, '_Index.md'), renderIndex(dir, role, cfg), created, skipped);
  }

  // 2) rich seed files (substitute placeholders)
  for (const rel of await walk(TEMPLATE_DIR)) {
    const raw = await readFile(join(TEMPLATE_DIR, rel), 'utf8');
    await writeIfMissing(join(targetPath, rel), substitute(raw, cfg), created, skipped);
  }

  // 3) make Obsidian recognise it as a vault
  await writeIfMissing(join(targetPath, '.obsidian', 'app.json'), '{}\n', created, skipped);

  return { created, skipped };
}
