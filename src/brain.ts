import { chmod, readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appHomePath, BRAND } from './brand.js';

/** ขยาย ~ ขึ้นต้น path เป็น home dir */
export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p;
}

// bundled rich templates (Home/USER/constitution/core memory/Templates) — sibling ของ skills/ ใน package
// (ship ผ่าน package.json "files", ไม่ผ่าน tsc — เหมือน BUNDLED_SKILLS ใน skills.ts)
const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'second-brain');
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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
  vaultName: BRAND.defaultVaultName,
  autonomy: 'ask-on-risk',
};

/**
 * โฟลเดอร์ทั้งหมด + บทบาท (จาก GEMINI.md §B.0 Folder Role Table) → generate _Index.md ให้ทุกอัน
 * top-level parent = Home · Shared/<x> parent = Shared/_Index (Shared เองชี้ Home)
 */
// ⚠ sync กับ second-brain/Vault Structure Map.md — แก้ role/โฟลเดอร์ ต้องแก้ทั้งสองที่ (มี test กัน drift)
// portable scaffold parity กับ GEMINI.md §B (vault-builder) — ทุกโฟลเดอร์มี _Index ที่บอก role + ใส่อะไร + ไม่ใส่อะไร
interface Folder {
  dir: string;
  role: string;
  put?: string; // ใส่อะไรที่นี่
  avoid?: string; // ไม่ใส่อะไรที่นี่ (กัน routing ผิด)
  links?: string[]; // seed links ที่ควรอยู่ใน generated _Index
}
export const FOLDERS: Folder[] = [
  // ── Core (MVV) ──
  { dir: 'Projects', role: 'workspace ของงานจริง — 1 โฟลเดอร์ = 1 โปรเจค', put: 'deliverable + overview/context/current-state ของ project', avoid: 'ความรู้ทั่วไป (→Learning) · log งาน (→Sessions)' },
  { dir: 'Sessions', role: 'flat chronological log ของงาน (YYYY-MM-DD-<topic>.md)', put: 'session log 7 หัวข้อ + checkpoint', avoid: 'code/config · subfolder (Sessions = flat เสมอ)' },
  { dir: 'Intake', role: 'จุดรับของใหม่เข้า vault ก่อนกระจายเข้าปลายทาง', put: 'task framing + raw input ที่รอจัด', avoid: 'durable knowledge (จัดเข้าปลายทางก่อน)' },
  { dir: 'Intake/_Quarantine', role: 'external content (web/paste) ที่ยัง untrusted', put: 'web clip/paste/email ก่อน scan injection (ดู Runbooks/ingest-quarantine)', avoid: 'content ที่ scan ผ่านแล้ว (→Raw Sources)' },
  { dir: 'Intake/Raw Sources', role: 'ต้นฉบับ external ที่ผ่าน scan แล้ว — immutable read-only', put: 'original หลัง scan · source:: ชี้มาที่นี่ได้', avoid: 'โน้ตที่ derived/สรุปแล้ว' },
  { dir: 'Skills', role: 'reusable unit ที่ executable + ผ่าน verification command', put: 'script/command ที่รัน test ผ่าน (ดู Shared/Rules/skills-admission)', avoid: 'prose how-to (→Runbooks) · unverified (→Memory-Inbox)' },
  { dir: 'Runbooks', role: 'prose how-to ที่อ่านแล้วทำตามเอง', put: 'ขั้นตอน setup/deploy/maintain + loop driver', avoid: 'runnable unit (→Skills)' },
  { dir: 'Templates', role: 'แม่แบบโน้ต — instantiate จากที่นี่', put: 'template ไว้ instantiate (session/bug/handoff/project)', avoid: 'โน้ตจริง' },
  { dir: 'Bugs', role: 'bug report reproducible ลงวันที่ ไม่ลบ', put: 'bug report (global flat) + link กลับ project · system/OS → Bugs/System-OS/', avoid: 'bug ที่ reproduce ไม่ได้' },
  { dir: 'Bugs/System-OS', role: 'bug report ระดับระบบ/OS/toolchain ที่ไม่ผูกกับ project เดียว', put: 'OS, shell, package manager, permission, filesystem, or app-runtime bugs', avoid: 'bug ของ project เฉพาะ (→Bugs หรือ Projects/<proj>/Bugs)' },
  { dir: 'Handoffs', role: 'เอกสารส่งมอบงานค้าง 1 ชิ้น (snapshot)', put: 'state + next steps ส่งต่อ agent/session', avoid: 'live coordination (→Shared/Coordination)' },
  // ── Direction ──
  { dir: 'Goals', role: 'north-star + objective รายไตรมาส/ปี (finite, มีวันจบ)', put: 'objective + track progress', avoid: 'live status (→Operating-State) · โดเมนต่อเนื่อง (→Areas)' },
  { dir: 'Areas', role: 'PARA — โดเมนงานต่อเนื่องที่ไม่มีวันจบ', put: 'brand/trading/content/products ฯลฯ', avoid: 'งานที่มีวันจบ (→Projects/Goals)' },
  // ── Knowledge pipeline ──
  { dir: 'Research', role: 'finding ที่อิงแหล่งภายนอก (มี source::)', put: 'สรุปอิงแหล่ง + market scan + citation', avoid: 'ความรู้ที่กลั่นเอง (→Learning)' },
  { dir: 'Learning', role: 'knowledge ที่ตัวเองกลั่น/deep-dive ตาม topic', put: 'topic MOC ที่ไม่มี external source', avoid: 'finding อิงแหล่ง (→Research)' },
  { dir: 'Distillations', role: 'หลักการ evergreen ที่กลั่นนิ่งแล้ว (≥3 ครั้ง) — atomic', put: 'principle ที่ reusable + นิ่งแล้ว', avoid: 'สิ่งที่ยังปรับเปลี่ยน (→Playbooks)' },
  { dir: 'Retrospectives', role: 'reflection หลังงาน (event-triggered)', put: 'what worked/failed หลังงานเสร็จ', avoid: 'review ตามรอบเวลา (→Reviews)' },
  { dir: 'Reviews', role: 'review ตาม cadence (time-triggered)', put: 'weekly/monthly + vault health + consolidation trace', avoid: 'reflection รายงาน (→Retrospectives)' },
  { dir: 'Traces', role: 'exploration/reasoning chain ยาว', put: 'การสืบสวนหลายขั้น (คำถามใหญ่เกินโน้ตเดียว)', avoid: 'คำตอบสั้น (→โน้ตปกติ)' },
  { dir: 'Prompts', role: 'prompt text/template ที่หยิบมารันได้ทันที', put: 'prompt/execution standard ต่อ task-family', avoid: 'fixtures (→Acceptance) · tactic (→Playbooks)' },
  { dir: 'Acceptance', role: 'golden input→expected-output fixtures', put: 'case ที่ใช้ตัดสิน done/not-done', avoid: 'gate ticklist (→Checklists) · runner (→Evals)' },
  { dir: 'Checklists', role: 'preflight/postflight gate (ticklist)', put: 'ticklist ก่อน-หลังลงมือ ต่อ task-family', avoid: 'expected output (→Acceptance)' },
  // ── Frontier loops (self-improving) ──
  { dir: 'Playbooks', role: 'กลยุทธ์/ลำดับการตัดสินใจที่ปรับดีขึ้นจากผลจริง (ACE)', put: 'tactic/heuristic ที่ดีขึ้นจากผล (counter [H/W])', avoid: 'prompt text (→Prompts) · runnable (→Skills)' },
  { dir: 'Evals', role: 'quality loop (runner + ผล) — error-analysis + self-eval', put: 'failure-taxonomy/self-eval-rubric/golden-set/correction-pairs/quality-ledger', avoid: 'golden case เอง (→Acceptance)' },
  { dir: 'Entities', role: 'canonical page ต่อ entity/person/org/concept (LLM-wiki, bi-temporal)', put: 'หน้า canonical ของ entity ที่เจอ ≥2 sessions', avoid: 'event log (→Sessions)' },
  // ── Shared (สมองกลาง) — Shared/_Index เองชี้ Home ──
  { dir: 'Shared', role: 'สมองกลาง: memory + rules + coordination', put: 'เข้าผ่าน AI-Context-Index', avoid: 'โน้ตงานทั่วไป' },
  { dir: 'Shared/Operating-State', role: 'live status/metrics ตอนนี้', put: 'current-state + health/queue + workbench', avoid: 'objective (→Goals)' },
  { dir: 'Shared/User-Memory', role: 'สิ่งที่ AI เรียนรู้เกี่ยวกับเจ้าของ (mutable)', put: 'preference/response-example/signal', avoid: 'identity static (→User-Persona)' },
  { dir: 'Shared/Decision-Memory', role: 'การตัดสินใจที่ AI บันทึก (latest-wins + supersedes)', put: 'decision locked + เหตุผล', avoid: 'ground truth คน (→Core-Facts)' },
  { dir: 'Shared/Memory-Inbox', role: 'candidate durable memory ที่ยังไม่ชัด/ขัดกัน', put: 'observation รอ promote (เคลียร์ทุก weekly)', avoid: 'durable ที่ชัดแล้ว (→ปลายทาง)' },
  { dir: 'Shared/Rules', role: 'กฎ operating always-on', put: 'memory-write-protocol/frontmatter/context-assembly/formatting/staleness', avoid: 'how-to ทำงาน (→Runbooks)' },
  { dir: 'Shared/Tech-Standards', role: 'มาตรฐานเทคนิคกลาง', put: 'MCP/stack/DoD/verification rulebook', avoid: 'กฎ memory/format (→Rules)' },
  { dir: 'Shared/Core-Facts', role: 'ground truth ที่เจ้าของเขียนเอง (read-only, invariant)', put: 'protected-facts ที่ AI ห้ามแก้/supersede', avoid: 'decision ที่ AI ตัด (→Decision-Memory)' },
  { dir: 'Shared/Coordination', role: 'live coordination ของหลาย agent พร้อมกัน', put: 'NOW.md baton + task-board + agent-registry', avoid: 'เอกสารส่งมอบครั้งเดียว (→Handoffs)' },
  { dir: 'Shared/Coordination/task-board', role: 'file-Kanban task cards สำหรับ multi-agent coordination', put: 'task file ต่อชิ้นงาน มี claimed_by/status/frontmatter', avoid: 'session narrative (→Sessions) · handoff snapshot (→Handoffs)' },
  { dir: 'Shared/Working-Memory', role: 'scratchpad ระหว่าง 1 task (ลบทิ้งได้)', put: 'ของชั่วคราวระหว่างทำงาน', avoid: 'อะไรที่จะเก็บ (→Memory-Inbox)' },
  { dir: 'Shared/User-Persona', role: 'identity profile ที่เปลี่ยนน้อยมาก (human-owned)', put: 'บทบาท/ค่านิยม/ภาษา/timezone (read-only)', avoid: 'สิ่งที่ AI เรียนรู้ (→User-Memory)' },
  { dir: 'Shared/Provenance', role: 'lineage ledger — ทุก claim ชี้ source:: ได้', put: 'บรรทัด ingest ต่อแหล่ง (ingest-log)', avoid: 'โน้ต derived (ใส่ source:: แทน)' },
  { dir: 'Shared/Archive', role: 'cold storage (ไม่ลบ)', put: 'โน้ต stale/retired ที่ออกจาก retrieval', avoid: 'ของที่ยังใช้' },
  { dir: 'Shared/Scripts', role: 'automation maintenance (lint/graph audit/metrics)', put: 'สคริปต์ maintenance ที่รันจริง', avoid: 'one-off ที่ retired (→Scripts-Archive)' },
  { dir: 'Shared/Scripts-Archive', role: 'สคริปต์ one-off ที่ retired', put: 'script เก่าเก็บเป็นประวัติ', avoid: 'script ที่ยังใช้ (→Scripts)' },
  { dir: 'Shared/mcp-servers', role: 'vendored local MCP server bundle (code/README)', put: 'โค้ด/README ของ MCP server (config อยู่ Tech-Standards)', avoid: 'config การต่อ (→Tech-Standards/mcp.json)' },
  {
    dir: 'Shared/Context-Packs',
    role: 'full-context bundle ต่อ domain/task-type',
    put: 'pack รวม context พร้อมโหลด',
    avoid: 'โน้ตเดี่ยว (→ปลายทางปกติ)',
    links: [
      '- [[Shared/Context-Packs/second-brain-maintenance]] — แก้ vault structure, routing, memory policy, indexes, runbooks, agent adapters',
      '- [[Shared/Context-Packs/coding-release]] — แก้ code/tests/build/release/CLI scripts',
      '- [[Shared/Context-Packs/research-to-framework]] — research/experiment → framework update',
    ],
  },
  { dir: 'Shared/Context7-Docs', role: 'cached external lib doc (regenerable — gitignore)', put: 'cache ของ context7/lib doc', avoid: 'durable knowledge (→Learning/Research)' },
  { dir: 'Shared/AI-Threads', role: 'saved AI reasoning/conversation trail (ไม่ใช่ source of truth)', put: 'thread ที่เก็บไว้ review/resume/promote', avoid: 'durable decision (promote → Decision-Memory)' },
  { dir: 'Shared/Prompting', role: 'prompt-engineering pattern (style/structure)', put: 'pattern การเขียน prompt ที่ reuse', avoid: 'prompt asset ต่อ task (→Prompts)' },
  { dir: 'Shared/Glossary', role: 'vocabulary กลาง (routes ไป category pages)', put: 'term + นิยาม กลาง', avoid: 'entity page (→Entities)' },
  { dir: 'Shared/Assets', role: 'รูป/logo/binary ของ vault', put: 'image/logo/asset', avoid: 'โน้ต .md' },
  // ── AI agent config / vendor exports ──
  { dir: '.agents', role: 'agent-specific assets (skills/workflows) ของ vault นี้', put: 'skill + workflow guide ที่ agent ใช้', avoid: 'โน้ตงาน (→ปลายทางปกติ)' },
  { dir: '.agents/skills', role: 'skill folders (SKILL.md) ที่ agent โหลด on-demand', put: 'SKILL.md ต่อ skill', avoid: 'prose how-to (→Runbooks)' },
  { dir: '.agents/workflows', role: 'workflow guide (multi-step orchestration)', put: 'workflow ที่ทำซ้ำได้', avoid: 'one-off task' },
  { dir: 'copilot', role: 'vendor export (conversation/custom-prompt/memory snapshot) — review/promote, ไม่ใช่ source of truth', put: 'export จาก Copilot ที่เก็บใน-vault', avoid: 'durable (promote เข้า durable layer)' },
  // ── Optional / machine-local ที่ยังเกี่ยวกับ coding workflow ──
  { dir: 'Tools', role: 'utility/tooling เฉพาะเครื่องหรือเฉพาะ vault', put: 'local helper, binary wrapper, one-off utility ที่ยังใช้อยู่', avoid: 'durable knowledge (→Learning/Runbooks) · verified executable skill (→Skills)' },
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

function copySafeMcpServers(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const servers: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(value as Record<string, unknown>)) {
    if (!RESERVED_OBJECT_KEYS.has(name)) servers[name] = server;
  }
  return servers;
}

/** generate _Index.md ของโฟลเดอร์ — frontmatter + role + ใส่อะไร/ไม่ใส่อะไร + up:: (ตาม §18 / §B.3 rule 2-3) */
function renderIndex(f: Folder, cfg: BrainConfig): string {
  const name = f.dir.split('/').pop() ?? f.dir;
  // parent = _Index ของโฟลเดอร์แม่ (nested) หรือ Home (top-level)
  const parent = f.dir.includes('/') ? `${f.dir.split('/').slice(0, -1).join('/')}/_Index` : 'Home';
  const selfIndex = `${f.dir}/_Index`;
  const tag = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `---
tags: [index, moc, ${tag}]
note_type: moc
created: ${cfg.today}
updated: ${cfg.today}
parent: "[[${parent}]]"
---

# ${name}

> ${f.role}

## ใส่ที่นี่
${f.put ?? '_(ดู role ด้านบน)_'}

## ไม่ใส่ที่นี่
${f.avoid ?? '_(—)_'}

## AI Routing Contract

- ก่อนเขียน: เช็กว่าเนื้อหาตรง "ใส่ที่นี่" และไม่เข้า "ไม่ใส่ที่นี่"; ถ้าก้ำกึ่งอ่าน [[Vault Structure Map]] ก่อน
- ก่อนสร้างไฟล์ใหม่: ค้นหาโน้ตเดิมในโฟลเดอร์นี้และโฟลเดอร์ใกล้เคียงก่อน เพื่อ merge/update แทน append ซ้ำ
- เมื่อสร้างโน้ตในโฟลเดอร์นี้: ตั้ง \`parent: "[[${selfIndex}]]"\` และท้ายไฟล์ \`up:: [[${selfIndex}]]\`
- หลังเขียน: เชื่อม link ไป source/project/session/decision ที่เกี่ยวข้อง และอัปเดต hub/index ถ้าโน้ตนี้ควรถูกค้นเจอในอนาคต

> รายละเอียดทุกโฟลเดอร์ + decision rules → [[Vault Structure Map]]

_(ยังว่าง — โน้ตในโฟลเดอร์นี้จะถูกลิงก์ที่นี่)_

${f.links?.length ? `## Seed Notes\n\n${f.links.join('\n')}\n\n` : ''}
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

  // 1) folders + generated _Index (role + ใส่อะไร/ไม่ใส่อะไร)
  for (const f of FOLDERS) {
    await mkdir(join(targetPath, f.dir), { recursive: true });
    await writeIfMissing(join(targetPath, f.dir, '_Index.md'), renderIndex(f, cfg), created, skipped);
  }

  // 2) rich seed files (substitute placeholders)
  for (const rel of await walk(TEMPLATE_DIR)) {
    if (rel.split('/').pop() === '_Index.md') continue; // generated จาก FOLDERS[] แล้ว ไม่ copy ซ้ำจาก template source
    // Projects/<slug>/ are per-user workspaces — scaffold via `sanook brain new project`, not bundled copy
    if (rel.startsWith('Projects/') && rel !== 'Projects/_Index.md') continue;
    const raw = await readFile(join(TEMPLATE_DIR, rel), 'utf8');
    await writeIfMissing(join(targetPath, rel), substitute(raw, cfg), created, skipped);
  }

  // 3) make Obsidian recognise it as a vault
  await writeIfMissing(join(targetPath, '.obsidian', 'app.json'), '{}\n', created, skipped);

  return { created, skipped };
}

/**
 * wire filesystem MCP server ชี้ไป vault ใน ~/.sanook/mcp.json (merge — ไม่ทับ server เดิม)
 * → agent อ่าน/เขียน vault ที่เพิ่ง scaffold ได้ทันที (ไม่ต้อง hand-author mcp.json)
 */
export async function wireBrainMcp(vaultPath: string): Promise<'added' | 'exists'> {
  const mcpPath = appHomePath('mcp.json');
  let cfg: { mcpServers?: Record<string, unknown> } = {};
  try {
    const parsed = JSON.parse(await readFile(mcpPath, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cfg = parsed as typeof cfg;
  } catch {
    /* ยังไม่มีไฟล์ */
  }
  cfg.mcpServers = copySafeMcpServers(cfg.mcpServers);
  const existing = cfg.mcpServers['second-brain'];
  const existingCommand = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as { command?: unknown }).command : undefined;
  const existingArgs = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as { args?: unknown }).args : undefined;
  if (
    typeof existingCommand === 'string' &&
    existingCommand.trim() &&
    Array.isArray(existingArgs) &&
    existingArgs.length > 0 &&
    existingArgs.every((arg) => typeof arg === 'string')
  ) {
    return 'exists';
  }
  cfg.mcpServers['second-brain'] = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', vaultPath],
  };
  await mkdir(dirname(mcpPath), { recursive: true });
  await writeFile(mcpPath, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  await chmod(mcpPath, 0o600).catch(() => {});
  return 'added';
}
