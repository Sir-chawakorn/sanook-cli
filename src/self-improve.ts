// ============================================================================
// src/self-improve.ts — Hermes-style "Self-improvement": when the user keeps asking
// for the SAME kind of task, Sanook notices, writes a reusable skill automatically,
// and announces it in the terminal ("✨ Self-improvement: created skill …").
//
// How it works (cheap, deterministic detection · LLM only fires on the Nth repeat):
//   1) every completed turn, the prompt is reduced to a TERM SIGNATURE and matched
//      (token-Jaccard) against a small persistent ledger at ~/.sanook/self-improve/ledger.json.
//   2) when a task family reaches the threshold (default 3) and no skill exists for it yet,
//      we synthesize a SKILL.md (model if a key resolves, else a deterministic template) and
//      save it via skills.saveSkill — then mark the family so we never duplicate it.
//
// Pure functions (signature, match, ledger transforms) are unit-tested with an injected
// clock and no FS/LLM. The orchestrator takes an injected `synthesize` so tests stay offline.
// ============================================================================
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { appHomePath, persistenceEnabled, selfImproveEnabled, selfImproveThreshold } from './brand.js';
import { termList } from './search/index-core.js';

export const LEDGER_PATH = appHomePath('self-improve', 'ledger.json');
const MAX_SAMPLES = 6; // prompts kept per task family (for synthesis context)
const MAX_FAMILIES = 200; // ledger cap (drop oldest)
const MATCH_THRESHOLD = 0.5; // token-Jaccard ≥ this ⇒ "same kind of task"
const MAX_SIG_TERMS = 12;

export const TaskFamilySchema = z.object({
  sig: z.string(),
  terms: z.array(z.string()),
  samples: z.array(z.string()),
  count: z.number().int().nonnegative(),
  skillCreated: z.boolean().default(false),
  skillName: z.string().nullable().default(null),
  firstSeen: z.number(),
  lastSeen: z.number(),
});
export type TaskFamily = z.infer<typeof TaskFamilySchema>;

export const LedgerSchema = z.object({
  version: z.literal(1).default(1),
  families: z.array(TaskFamilySchema).default([]),
});
export type Ledger = z.infer<typeof LedgerSchema>;

export function emptyLedger(): Ledger {
  return { version: 1, families: [] };
}

/** prompt → ชุด term สำคัญ (ตัด slash-command / @mention / ของสั้น) — เป็น signature ของงาน */
export function signatureTerms(prompt: string): string[] {
  const cleaned = prompt
    .replace(/^\s*\/\w+\s*/, '') // ตัด /command นำหน้า
    .replace(/@[^\s]+/g, ' ') // ตัด @file mention
    .replace(/\[\[\s*paste[^\]]*\]\]/gi, ' '); // ตัด paste token
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of termList(cleaned)) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_SIG_TERMS) break;
  }
  return out;
}

export function signatureKey(terms: string[]): string {
  return [...terms].sort().join(' ');
}

/** token-Jaccard ระหว่าง 2 ชุด term (0..1) */
export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  return inter / (setA.size + setB.size - inter);
}

export interface RecordResult {
  ledger: Ledger;
  family: TaskFamily;
  /** เพิ่งแตะ threshold + ยังไม่เคยสร้าง skill → ควร synthesize */
  shouldCreateSkill: boolean;
}

/**
 * บันทึก task 1 ครั้งเข้า ledger — match กับ family เดิมด้วย Jaccard, ไม่งั้นเปิด family ใหม่.
 * คืน shouldCreateSkill=true เมื่อ count ถึง threshold ครั้งแรก (ยังไม่เคยสร้าง skill).
 */
export function recordTask(ledger: Ledger, prompt: string, now: number, createThresholdOverride?: number): RecordResult {
  const createThreshold = createThresholdOverride ?? selfImproveThreshold();
  const terms = signatureTerms(prompt);
  const sample = prompt.trim().replace(/\s+/g, ' ').slice(0, 240);

  // งานสั้น/generic เกินไป (term น้อย) → ไม่ติดตาม (กัน false positive เช่น "ok", "ลองอีกที")
  if (terms.length < 3) {
    return { ledger, family: phantomFamily(terms, sample, now), shouldCreateSkill: false };
  }

  const families = ledger.families.slice();
  let bestIdx = -1;
  let bestSim = 0;
  for (let i = 0; i < families.length; i += 1) {
    const s = jaccard(terms, families[i].terms);
    if (s > bestSim) {
      bestSim = s;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0 && bestSim >= MATCH_THRESHOLD) {
    const prev = families[bestIdx];
    const samples = prev.samples.includes(sample) ? prev.samples : [...prev.samples, sample].slice(-MAX_SAMPLES);
    // keep family.terms = the first-seen signature (stable) so Jaccard doesn't drift/shrink as the family grows
    const next: TaskFamily = { ...prev, samples, count: prev.count + 1, lastSeen: now };
    families[bestIdx] = next;
    const shouldCreateSkill = !next.skillCreated && next.count >= createThreshold;
    return { ledger: { ...ledger, families: capFamilies(families) }, family: next, shouldCreateSkill };
  }

  const fresh: TaskFamily = {
    sig: signatureKey(terms),
    terms,
    samples: [sample],
    count: 1,
    skillCreated: false,
    skillName: null,
    firstSeen: now,
    lastSeen: now,
  };
  families.push(fresh);
  return { ledger: { ...ledger, families: capFamilies(families) }, family: fresh, shouldCreateSkill: false };
}

/** mark ว่า family นี้สร้าง skill แล้ว (กันสร้างซ้ำ) */
export function markSkillCreated(ledger: Ledger, sig: string, skillName: string): Ledger {
  return {
    ...ledger,
    families: ledger.families.map((f) => (f.sig === sig ? { ...f, skillCreated: true, skillName } : f)),
  };
}

function capFamilies(families: TaskFamily[]): TaskFamily[] {
  if (families.length <= MAX_FAMILIES) return families;
  return [...families].sort((x, y) => y.lastSeen - x.lastSeen).slice(0, MAX_FAMILIES);
}

function phantomFamily(terms: string[], sample: string, now: number): TaskFamily {
  return { sig: signatureKey(terms), terms, samples: [sample], count: 0, skillCreated: false, skillName: null, firstSeen: now, lastSeen: now };
}

// ---- FS (gated by persistence) ---------------------------------------------

export async function loadLedger(): Promise<Ledger> {
  try {
    const parsed = LedgerSchema.safeParse(JSON.parse(await readFile(LEDGER_PATH, 'utf8')));
    return parsed.success ? parsed.data : emptyLedger();
  } catch {
    return emptyLedger();
  }
}

export async function saveLedger(ledger: Ledger): Promise<void> {
  if (!persistenceEnabled()) return;
  await mkdir(dirname(LEDGER_PATH), { recursive: true });
  await writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
}

// ---- orchestrator ----------------------------------------------------------

export interface SkillDraft {
  name: string;
  description: string;
  whenToUse?: string;
  body: string;
}

/** synthesize: (family) → SkillDraft | null. Injected so tests stay offline. */
export type SkillSynthesizer = (family: TaskFamily) => Promise<SkillDraft | null>;

export interface AutoSkillResult {
  created: boolean;
  skillName?: string;
  count?: number;
  path?: string;
  /** ข้อความแจ้งใน terminal (✨) — undefined ถ้าไม่ได้สร้าง */
  announcement?: string;
}

export interface MaybeAutoSkillDeps {
  synthesize: SkillSynthesizer;
  saveSkill: (name: string, description: string, body: string, whenToUse?: string) => Promise<string>;
  existingSkillNames?: Set<string>;
  now?: number;
}

/**
 * เรียกหลังจบ turn (best-effort, fire-and-forget). บันทึก task เข้า ledger; ถ้าถึง threshold
 * และยังไม่เคยมี skill → synthesize + save + mark + คืน announcement สำหรับโชว์ใน terminal.
 */
export async function maybeAutoSkill(prompt: string, deps: MaybeAutoSkillDeps): Promise<AutoSkillResult> {
  if (!selfImproveEnabled()) return { created: false };
  const now = deps.now ?? Date.now();
  const ledger = await loadLedger();
  const rec = recordTask(ledger, prompt, now);
  await saveLedger(rec.ledger);
  if (!rec.shouldCreateSkill) return { created: false };

  const draft = await deps.synthesize(rec.family).catch(() => null);
  if (!draft || !draft.name.trim()) return { created: false };

  const name = uniqueSkillName(draft.name, deps.existingSkillNames);
  let path: string;
  try {
    path = await deps.saveSkill(name, draft.description, draft.body, draft.whenToUse);
  } catch {
    return { created: false };
  }
  await saveLedger(markSkillCreated(rec.ledger, rec.family.sig, name)).catch(() => {});
  return {
    created: true,
    skillName: name,
    count: rec.family.count,
    path,
    announcement: `✨ Self-improvement: สร้าง skill \`${name}\` อัตโนมัติ จากงานที่ทำซ้ำ ${rec.family.count} ครั้ง — ครั้งหน้าหยิบใช้ได้เลย (\`sanook skill list\`)`,
  };
}

/** slug ชื่อ skill ให้ไม่ชนของเดิม (เติม -2, -3, …) */
export function uniqueSkillName(raw: string, existing?: Set<string>): string {
  const base = slugifySkillName(raw);
  if (!existing || !existing.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}

export function slugifySkillName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || `auto-skill-${Date.now().toString(36).slice(-4)}`;
}
