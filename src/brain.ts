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
const FOLDERS: { dir: string; role: string }[] = [
  // Core (MVV)
  { dir: 'Projects', role: 'workspace ของงานจริง — 1 โฟลเดอร์ = 1 โปรเจค (overview/context/current-state)' },
  { dir: 'Sessions', role: 'flat chronological log ของงาน + checkpoint (YYYY-MM-DD-<topic>.md)' },
  { dir: 'Intake', role: 'staging ของ task framing + raw input ก่อนจัดเข้าที่' },
  { dir: 'Runbooks', role: 'ขั้นตอนทำซ้ำได้ (setup/deploy/maintain) แบบ step-by-step' },
  { dir: 'Templates', role: 'แม่แบบโน้ต — instantiate จากที่นี่ตอนสร้างโน้ตใหม่' },
  { dir: 'Bugs', role: 'bug report ลงวันที่ ไม่ลบ (status frontmatter)' },
  { dir: 'Handoffs', role: 'baton ส่งงานค้างระหว่าง agent/session (state + next steps)' },
  // Direction
  { dir: 'Goals', role: 'north-star + objective รายไตรมาส/ปี + track progress' },
  { dir: 'Areas', role: 'PARA — โดเมนงานต่อเนื่องที่ไม่มีวันจบ (brand/trading/content...)' },
  // Knowledge pipeline
  { dir: 'Research', role: 'research อิงแหล่ง + market scan + reference synthesis (มี citation)' },
  { dir: 'Learning', role: 'knowledge hub ตาม topic (curated lessons, deep-dive MOC)' },
  { dir: 'Distillations', role: 'pattern/principle ที่กลั่นแล้ว (เห็น ≥3 ครั้ง) — atomic, evergreen' },
  { dir: 'Retrospectives', role: 'reflection หลังงาน (what worked/failed)' },
  { dir: 'Reviews', role: 'review เป็นรอบ (weekly/monthly) + vault health' },
  { dir: 'Traces', role: 'exploration/reasoning chain ยาว (คำถามใหญ่เกินโน้ตเดียว)' },
  { dir: 'Prompts', role: 'prompt pack + execution standard ต่อ task-family' },
  { dir: 'Acceptance', role: 'golden case pass/fail ต่อ task-family' },
  { dir: 'Checklists', role: 'preflight/postflight gate ต่อ task-family' },
  // Frontier loops
  { dir: 'Playbooks', role: 'tactic playbook ที่เก่งขึ้นเอง ต่อ task-family' },
  { dir: 'Evals', role: 'quality loop (error-analysis + self-eval + golden-set)' },
  { dir: 'Entities', role: 'canonical page ต่อ entity/concept (LLM-wiki)' },
  // Shared (สมองกลาง) — Shared/_Index เองชี้ Home
  { dir: 'Shared', role: 'สมองกลาง: memory + rules + coordination (เข้าผ่าน AI-Context-Index)' },
  { dir: 'Shared/Operating-State', role: 'live ops layer (current-state + metrics/health)' },
  { dir: 'Shared/User-Memory', role: 'preference/response-example/signal ของเจ้าของ' },
  { dir: 'Shared/Decision-Memory', role: 'log การตัดสินใจ locked (latest-wins + supersedes)' },
  { dir: 'Shared/Memory-Inbox', role: 'buffer observation ที่ยังไม่ promote (เคลียร์ทุก weekly)' },
  { dir: 'Shared/Rules', role: 'กฎ operating always-on (memory/frontmatter/graph/formatting)' },
  { dir: 'Shared/Tech-Standards', role: 'มาตรฐานเทคนิค (MCP/stack/DoD/verification)' },
  { dir: 'Shared/Core-Facts', role: 'invariant truth (human-owned, agent-read-only)' },
  { dir: 'Shared/Coordination', role: 'multi-agent: NOW.md baton + task-board + agent-registry' },
  { dir: 'Shared/Working-Memory', role: 'scratchpad ชั่วคราวต่อ task (NOT durable)' },
  { dir: 'Shared/User-Persona', role: 'identity profile ของเจ้าของ (static)' },
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
  const parent = dir === 'Shared' || !dir.includes('/') ? 'Home' : 'Shared/_Index';
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
