// ============================================================================
// src/memory-store.ts — self-organizing auto-memory store (single source of
// truth for PATHS + the Fact FORMAT + all pure transform fns + the FS boundary).
//
// Why this module exists: the old auto-memory was a flat append-only list of
// "- <fact>" lines. The writer (memory.ts) and reader (knowledge.ts) each
// hardcoded the same path and assumed one fact per physical line, so they could
// silently drift, and there was no merge/importance/decay — duplicates piled up
// and stale facts became prompt noise.
//
// Now: `memory.json` (version 2) is the source of truth; `MEMORY.md` is a
// derived, ranked, human-readable view re-rendered on every write. Merge,
// decay, and consolidation are PURE Fact[]→Fact[] functions with an injected
// clock, so they unit-test with zero filesystem. This encodes the vault's own
// memory doctrine in code: "Merge, Don't Append" (Mem0-style ADD/UPDATE/NOOP/
// SUPERSEDE), bi-temporal soft-delete (history stays queryable), importance +
// recency decay with a real archive action, a protected tier, and an inbox TTL.
// No network, no embeddings — similarity is deterministic token Jaccard.
// ============================================================================
import { chmod, mkdir, readFile, rename, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { appHomePath, BRAND, persistenceEnabled } from './brand.js';
import { redactKey } from './providers/keys.js';

// ---- enums / taxonomy ------------------------------------------------------
export const TRUST = ['owner', 'agent', 'derived', 'untrusted'] as const;
export const STATUS = ['active', 'superseded', 'archived'] as const;
export const TIER = ['protected', 'durable', 'inbox'] as const;
// fixed taxonomy; .catch('reference') means an invented type falls back instead of throwing
export const NOTE_TYPE = ['preference', 'decision', 'convention', 'fact', 'entity', 'skill', 'reference'] as const;

export type NoteType = (typeof NOTE_TYPE)[number];
export type Trust = (typeof TRUST)[number];
export type Tier = (typeof TIER)[number];

// ---- schema ----------------------------------------------------------------
export const FactSchema = z
  .object({
    id: z.string(), // 'm_' + 6 chars of fnv1a(normalize(text)) — stable across runs/migrations
    text: z.string().min(1), // atomic claim, already redactKey()'d
    noteType: z.enum(NOTE_TYPE).catch('reference'),
    tier: z.enum(TIER).default('durable'), // protected = owner ground-truth, never auto-superseded/archived
    trust: z.enum(TRUST).default('agent'),
    tags: z.array(z.string()).default([]),
    importance: z.number().min(0).max(1).default(0.5),
    accessCount: z.number().int().min(0).default(0),
    status: z.enum(STATUS).default('active'), // bi-temporal partition
    validFrom: z.number(), // when it started being true
    invalidatedAt: z.number().nullable().default(null), // set on supersede/archive; null = still true
    supersededBy: z.string().nullable().default(null),
    supersedes: z.array(z.string()).default([]), // two-sided edge
    related: z.array(z.string()).default([]),
    parent: z.string().default('auto-memory'), // anti-orphan: every fact has an `up`
    source: z.string().nullable().default(null),
    created: z.number(),
    updated: z.number(),
    lastAccessed: z.number(),
    reviewAfter: z.number().nullable().default(null), // staleness signal consolidation acts on
  })
  .strict();

export type Fact = z.infer<typeof FactSchema>;

export const MetaSchema = z
  .object({
    lastConsolidated: z.number().default(0),
    activeAtLastConsolidate: z.number().int().default(0),
    migratedFrom: z.string().nullable().default(null),
  })
  .strict();

export const StoreSchema = z
  .object({ version: z.literal(2), meta: MetaSchema, facts: z.array(FactSchema) })
  .strict();

export type MemoryStore = z.infer<typeof StoreSchema>;

export type MergeOp = 'ADD' | 'UPDATE' | 'NOOP' | 'SUPERSEDE' | 'QUARANTINE' | 'PROTECTED_HALT';
export interface MergeResult {
  store: MemoryStore;
  op: MergeOp;
  fact: Fact | null;
  flag?: string;
}
export interface ConsolidateReport {
  archived: string[];
  merged: string[];
  promoted: string[];
  needsReview: string[];
}
export interface Incoming {
  text: string;
  noteType?: NoteType;
  trust?: Trust;
  tier?: Tier;
  source?: string | null;
  sourceResolved?: boolean; // for derived/untrusted facts: does source resolve in the ingest ledger?
}

// ---- tuning constants ------------------------------------------------------
const NEAR_DUP = 0.82; // sim ≥ this ⇒ same fact (NOOP/UPDATE)
const RELATED = 0.45; // RELATED ≤ sim < NEAR_DUP ⇒ related; supersede only on a clear contradiction
const HALF_LIFE_DAYS = 30; // importance halves every 30 days untouched
const ARCHIVE_FLOOR = 0.15; // effImportance below this (and untouched/stale) ⇒ archive
const DAY_MS = 86_400_000;
const INBOX_TTL_MS = 14 * DAY_MS; // inbox items must not linger > 2 weeks
const CONSOLIDATE_EVERY_MS = DAY_MS; // cadence: at most once a day …
const CONSOLIDATE_EVERY_N = 25; // … or after +25 new active facts
const PROMPT_CAP = 6000; // ~2k tokens — bounded retrieval (anti context-rot)
const PROMPT_NOTE = 'สิ่งที่จำไว้จาก session ก่อน'; // MUST match the legacy <auto_memory note="…"> text

// importance prior by note type
const PRIOR: Record<NoteType, number> = {
  decision: 0.7,
  convention: 0.7,
  preference: 0.6,
  entity: 0.55,
  skill: 0.6,
  fact: 0.5,
  reference: 0.5,
};

// negation / polarity-flip tokens (en + th) used for deterministic contradiction detection
const NEGATION = new Set([
  'not', 'never', 'no', "n't", 'instead', 'stop', 'stopped', 'quit', 'avoid', 'drop', 'dropped',
  'ไม่', 'เลิก', 'หยุด', 'แทน', 'งด',
]);
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'is', 'are', 'was', 'be', 'in', 'on', 'at', 'for', 'with', 'and',
  'or', 'use', 'uses', 'using', 'now', 'then', 'this', 'that', 'it', 'as', 'by', 'we', 'i',
  'ใน', 'ที่', 'เป็น', 'และ', 'กับ', 'ของ', 'ให้', 'จะ', 'ได้',
]);

// ---- path constants (the SINGLE source — kills the memory.ts vs knowledge.ts drift) ----
export const MEMORY_DIR = appHomePath('memory');
export const MEMORY_JSON = join(MEMORY_DIR, 'memory.json'); // source of truth
export const AUTO_MEMORY_FILE = join(MEMORY_DIR, 'MEMORY.md'); // derived view (legacy name kept)
const MEMORY_BAK = join(MEMORY_DIR, 'MEMORY.md.bak');

// ============================================================================
// Pure helpers (no FS, clock only via injected `now`)
// ============================================================================

/** lowercase, punctuation→space, collapse whitespace. Keeps Thai chars intact. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** token set (length > 1). Thai (no word breaks) collapses to coarse tokens — accepted no-network tradeoff. */
export function tokens(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter((t) => t.length > 1));
}

/** content tokens that carry meaning (drop stopwords + negation) — used for "shared subject" tests. */
function subjectTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokens(text)) if (t.length >= 3 && !STOPWORDS.has(t) && !NEGATION.has(t)) out.add(t);
  return out;
}

/** Jaccard similarity over token sets (0..1). Two empties ⇒ 0. */
export function sim(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** stable content-hashed id: 'm_' + 6 url-safe chars of FNV-1a(normalize(text)). */
export function deriveId(text: string): string {
  const s = normalize(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h >>>= 0;
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alpha[h & 63];
    h = Math.floor(h / 64);
  }
  return `m_${out}`;
}

/** effective importance = stored importance decayed by recency, with an access-count floor. */
export function effImportance(f: Fact, now: number): number {
  const days = Math.max(0, (now - f.lastAccessed) / DAY_MS);
  const recency = 0.5 ** (days / HALF_LIFE_DAYS);
  const base = f.importance * recency;
  const floor = Math.min(0.4, f.accessCount * 0.05);
  return Math.max(base, floor);
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** tri-state contradiction signal (deterministic, no LLM). Conservative: only "yes" on a clear polarity flip. */
function contradiction(a: string, b: string, sameCategory: boolean): 'yes' | 'ambiguous' | 'no' {
  if (!sameCategory) return 'no';
  const subjA = subjectTokens(a);
  const subjB = subjectTokens(b);
  let shared = false;
  for (const t of subjA) if (subjB.has(t)) { shared = true; break; }
  if (!shared) return 'no';
  const negA = [...tokens(a)].some((t) => NEGATION.has(t));
  const negB = [...tokens(b)].some((t) => NEGATION.has(t));
  if (negA !== negB) return 'yes'; // one negates, the other affirms the same subject ⇒ clear flip
  return 'ambiguous'; // same subject, differing detail, no clear flip ⇒ keep both, defer to owner
}

const CATEGORY: ReadonlySet<NoteType> = new Set(['preference', 'decision', 'convention']);

/** an empty version-2 store. */
export function emptyStore(_now: number = Date.now()): MemoryStore {
  return { version: 2, meta: { lastConsolidated: 0, activeAtLastConsolidate: 0, migratedFrom: null }, facts: [] };
}

/** active (retrievable) facts. */
export function activeFacts(store: MemoryStore): Fact[] {
  return store.facts.filter((f) => f.status === 'active');
}

function newFact(inc: Required<Pick<Incoming, 'text'>> & Incoming, now: number): Fact {
  const noteType = inc.noteType ?? 'reference';
  return {
    id: deriveId(inc.text),
    text: inc.text,
    noteType,
    tier: inc.tier ?? 'durable',
    trust: inc.trust ?? 'agent',
    tags: [],
    importance: PRIOR[noteType] ?? 0.5,
    accessCount: 0,
    status: 'active',
    validFrom: now,
    invalidatedAt: null,
    supersededBy: null,
    supersedes: [],
    related: [],
    parent: 'auto-memory',
    source: inc.source ?? null,
    created: now,
    updated: now,
    lastAccessed: now,
    reviewAfter: null,
  };
}

const tokenCount = (t: string): number => tokens(t).size;
const withFacts = (store: MemoryStore, facts: Fact[]): MemoryStore => ({ ...store, facts });

/**
 * Merge an incoming fact into the store — Mem0-style ADD / UPDATE / NOOP / SUPERSEDE,
 * plus PROTECTED_HALT and QUARANTINE. Deterministic, no network, pure (clock injected).
 * redactKey is applied here too (defense in depth) before anything touches the text.
 */
export function mergeFact(store: MemoryStore, incoming: Incoming, now: number = Date.now()): MergeResult {
  const text = redactKey(incoming.text).trim().replace(/\s+/g, ' ');
  if (!text) return { store, op: 'NOOP', fact: null };
  const inc: Incoming = { ...incoming, text };
  const noteType = inc.noteType ?? 'reference';
  const sameCat = CATEGORY.has(noteType);
  const facts = store.facts.slice();

  // 1) PROTECTED GATE — never auto-supersede owner ground-truth; halt + flag on conflict.
  for (const m of facts) {
    if (m.tier !== 'protected' || m.status !== 'active') continue;
    if (sim(text, m.text) >= RELATED && contradiction(m.text, text, CATEGORY.has(m.noteType) && sameCat) === 'yes') {
      return { store, op: 'PROTECTED_HALT', fact: null, flag: `conflicts with protected fact: ${m.text}` };
    }
  }

  // 2) PROVENANCE GATE — derived/untrusted text with an unresolved source is quarantined to the inbox tier.
  if ((inc.trust === 'derived' || inc.trust === 'untrusted') && !inc.sourceResolved) {
    const f = newFact(inc, now);
    f.tier = 'inbox';
    f.reviewAfter = now + INBOX_TTL_MS;
    facts.push(f);
    return { store: withFacts(store, facts), op: 'QUARANTINE', fact: f };
  }

  const tier: Tier = inc.tier ?? 'durable';
  const norm = normalize(text);

  // 3a) EXACT normalized duplicate (same tier, active) ⇒ NOOP + touch.
  // Robust even when token-Jaccard is 0 (e.g. 1-char facts) — keeps idempotent remember + bumps the importance signal.
  const exactIdx = facts.findIndex((m) => m.status === 'active' && m.tier === tier && normalize(m.text) === norm);
  if (exactIdx >= 0) {
    const m = facts[exactIdx];
    facts[exactIdx] = { ...m, accessCount: m.accessCount + 1, lastAccessed: now, updated: now };
    return { store: withFacts(store, facts), op: 'NOOP', fact: facts[exactIdx] };
  }

  // 3b) FUZZY MATCH — best active fact in the SAME tier by token-Jaccard similarity.
  let best: Fact | undefined;
  let bestSim = 0;
  for (const m of facts) {
    if (m.status !== 'active' || m.tier !== tier) continue;
    const s = sim(text, m.text);
    if (s > bestSim || (s === bestSim && best && m.created > best.created)) {
      best = m;
      bestSim = s;
    }
  }

  const idx = best ? facts.indexOf(best) : -1;

  if (best && bestSim >= NEAR_DUP) {
    // near-dup but not identical ⇒ UPDATE in place, keep id, longer text wins
    const longerWins = tokenCount(text) > tokenCount(best.text) ? text : best.text;
    const updated: Fact = {
      ...best,
      text: longerWins,
      importance: clamp01(Math.max(best.importance, PRIOR[noteType] ?? 0.5) + 0.05),
      accessCount: best.accessCount + 1,
      updated: now,
      lastAccessed: now,
    };
    facts[idx] = updated;
    return { store: withFacts(store, facts), op: 'UPDATE', fact: updated };
  }

  if (best && bestSim >= RELATED) {
    const c = contradiction(best.text, text, CATEGORY.has(best.noteType) && sameCat);
    if (c === 'yes') {
      // SUPERSEDE — bi-temporal soft-delete: old stays queryable, new points back to it
      const fresh = newFact(inc, now);
      fresh.supersedes = [best.id];
      fresh.related = [best.id];
      fresh.importance = Math.max(0.55, best.importance);
      facts[idx] = { ...best, status: 'superseded', invalidatedAt: now, supersededBy: fresh.id, updated: now };
      facts.push(fresh);
      return { store: withFacts(store, facts), op: 'SUPERSEDE', fact: fresh };
    }
    // related (or ambiguous contradiction) ⇒ ADD but link + flag for review, never silently merge/supersede
    const fresh = newFact(inc, now);
    fresh.related = [best.id];
    if (c === 'ambiguous') fresh.reviewAfter = now + INBOX_TTL_MS;
    facts.push(fresh);
    return { store: withFacts(store, facts), op: 'ADD', fact: fresh };
  }

  // 4) genuinely new ⇒ ADD
  const fresh = newFact(inc, now);
  facts.push(fresh);
  return { store: withFacts(store, facts), op: 'ADD', fact: fresh };
}

/** stable iteration order so consolidate() is idempotent. */
function byCreatedThenId(a: Fact, b: Fact): number {
  return a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Sleep-time consolidation — pure, idempotent. Touch-decay → archive → merge overlapping →
 * inbox drain/TTL → promote recurring → stamp meta. Running twice is a no-op.
 */
export function consolidate(store: MemoryStore, now: number = Date.now()): { store: MemoryStore; report: ConsolidateReport } {
  const report: ConsolidateReport = { archived: [], merged: [], promoted: [], needsReview: [] };
  let facts = store.facts.slice().sort(byCreatedThenId);

  // STEP 1 — ARCHIVE stale, untouched, low-value (soft delete; protected exempt)
  facts = facts.map((f) => {
    if (
      f.status === 'active' &&
      f.tier !== 'protected' &&
      f.reviewAfter !== null &&
      now > f.reviewAfter &&
      f.accessCount === 0 &&
      effImportance(f, now) < ARCHIVE_FLOOR
    ) {
      report.archived.push(f.id);
      return { ...f, status: 'archived' as const, invalidatedAt: now };
    }
    return f;
  });

  // STEP 2 — MERGE OVERLAPPING active facts that escaped inline merge (fold younger into oldest)
  const removed = new Set<number>();
  for (let i = 0; i < facts.length; i++) {
    if (removed.has(i) || facts[i].status !== 'active') continue;
    for (let j = i + 1; j < facts.length; j++) {
      const keep = facts[i];
      const dup = facts[j];
      if (removed.has(j) || dup.status !== 'active' || keep.tier !== dup.tier) continue;
      if (sim(keep.text, dup.text) >= NEAR_DUP) {
        facts[i] = {
          ...keep,
          text: tokenCount(keep.text) >= tokenCount(dup.text) ? keep.text : dup.text,
          importance: clamp01(Math.max(keep.importance, dup.importance)),
          accessCount: keep.accessCount + dup.accessCount,
          tags: [...new Set([...keep.tags, ...dup.tags])],
          updated: now,
        };
        removed.add(j);
        report.merged.push(dup.id);
      }
    }
  }
  if (removed.size) facts = facts.filter((_, idx) => !removed.has(idx));

  // STEP 3 — INBOX DRAIN / TTL: promote agent-origin items past TTL, flag untrusted for review
  const durableTexts = facts.filter((f) => f.status === 'active' && f.tier === 'durable').map((f) => f.text);
  facts = facts.map((f) => {
    if (f.status !== 'active' || f.tier !== 'inbox' || now < f.created + INBOX_TTL_MS) return f;
    const hasDurableDup = durableTexts.some((t) => sim(t, f.text) >= NEAR_DUP);
    if (f.trust !== 'untrusted' && !hasDurableDup) {
      report.promoted.push(f.id);
      return { ...f, tier: 'durable' as const, reviewAfter: null, updated: now };
    }
    report.needsReview.push(f.id);
    return { ...f, reviewAfter: now };
  });

  // STEP 4 — PROMOTE recurring (accessed ≥ 3) to an importance floor (idempotent: max, not increment)
  facts = facts.map((f) => {
    if (f.status === 'active' && f.tier !== 'protected' && f.accessCount >= 3 && f.importance < 0.8) {
      report.promoted.push(f.id);
      return { ...f, importance: 0.8 };
    }
    return f;
  });

  const next: MemoryStore = {
    ...store,
    facts,
    meta: { ...store.meta, lastConsolidated: now, activeAtLastConsolidate: facts.filter((f) => f.status === 'active').length },
  };
  return { store: next, report };
}

/** should consolidation run? (cadence only — caller also guards persistenceEnabled). */
export function maybeConsolidate(store: MemoryStore, now: number = Date.now()): boolean {
  const activeN = activeFacts(store).length;
  return now - store.meta.lastConsolidated >= CONSOLIDATE_EVERY_MS || activeN - store.meta.activeAtLastConsolidate >= CONSOLIDATE_EVERY_N;
}

/** rank active facts: protected first, then effective importance, then recency, then id. */
function ranked(store: MemoryStore, now: number): Fact[] {
  return activeFacts(store).sort((a, b) => {
    const pa = a.tier === 'protected' ? 1 : 0;
    const pb = b.tier === 'protected' ? 1 : 0;
    return pb - pa || effImportance(b, now) - effImportance(a, now) || b.updated - a.updated || (a.id < b.id ? -1 : 1);
  });
}

/** the human/git Markdown view (full active set, ranked). */
export function renderView(store: MemoryStore, now: number = Date.now()): string {
  const lines = ranked(store, now).map((f) => `- ${f.text}`);
  return `# ${BRAND.autoMemoryTitle}\n\n${lines.join('\n')}\n`;
}

/** the system-prompt block: '' when empty, else a single capped, head-biased <auto_memory> block. */
export function renderPromptBlock(store: MemoryStore, now: number = Date.now()): string {
  const picked: string[] = [];
  let size = 0;
  for (const f of ranked(store, now)) {
    const line = `- ${f.text}`;
    if (picked.length && size + line.length + 1 > PROMPT_CAP) break;
    picked.push(line);
    size += line.length + 1;
  }
  if (!picked.length) return '';
  return `<auto_memory note="${PROMPT_NOTE}">\n${picked.join('\n')}\n</auto_memory>`;
}

/** classify a legacy bare line into a note type (tiny keyword heuristic). */
function inferNoteType(text: string): NoteType {
  const l = text.toLowerCase();
  if (/(ชอบ|prefer|likes?|favou?rite)/.test(l)) return 'preference';
  if (/(ตัดสินใจ|decided|decision|chose|switch)/.test(l)) return 'decision';
  if (/(convention|always|เสมอ|ทุกครั้ง|never)/.test(l)) return 'convention';
  return 'reference';
}

/** one-time, idempotent, lossless migration of the flat "# title \n - fact" markdown into a store. */
export function migrateFromFlat(md: string, now: number = Date.now()): MemoryStore {
  let store = emptyStore();
  const header = `# ${BRAND.autoMemoryTitle}`;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line || line === header || line.startsWith('#')) continue;
    const text = redactKey(line.replace(/^[-*]\s+/, '').trim()).replace(/\s+/g, ' ');
    if (!text) continue;
    store = mergeFact(store, { text, trust: 'agent', noteType: inferNoteType(text) }, now).store;
  }
  store.meta.migratedFrom = 'v1-flat';
  return store;
}

// ============================================================================
// FS boundary — the ONLY place that touches disk. Honors persistenceEnabled,
// 0o600 permissions, and atomic write (tmp+rename). loadStore never writes.
// ============================================================================
async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the store. Reads memory.json (source of truth) if present and valid; else lazily
 * migrates a legacy MEMORY.md IN MEMORY (no write — read paths stay pure); else empty.
 * An unreadable/wrong-version json degrades gracefully rather than crashing the agent.
 */
export async function loadStore(now: number = Date.now()): Promise<MemoryStore> {
  try {
    const parsed = StoreSchema.safeParse(JSON.parse(await readFile(MEMORY_JSON, 'utf8')));
    if (parsed.success) return parsed.data;
  } catch {
    /* no json yet, or malformed → fall through */
  }
  try {
    const md = await readFile(AUTO_MEMORY_FILE, 'utf8');
    if (md.trim()) return migrateFromFlat(md, now); // legacy file → migrate in memory, persisted on next write
  } catch {
    /* no legacy file either */
  }
  return emptyStore();
}

async function writeSecure(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
}

/**
 * Persist the store: memory.json via tmp+rename (atomic), then re-render MEMORY.md.
 * Both files are 0o600. On the very first json write, the legacy MEMORY.md is backed up
 * to MEMORY.md.bak so raw legacy text is never destroyed. No-op when persistence is disabled.
 */
export async function saveStore(store: MemoryStore, now: number = Date.now()): Promise<void> {
  if (!persistenceEnabled()) return;
  await mkdir(MEMORY_DIR, { recursive: true });
  const firstJson = !(await exists(MEMORY_JSON));
  if (firstJson && (await exists(AUTO_MEMORY_FILE))) {
    await copyFile(AUTO_MEMORY_FILE, MEMORY_BAK).catch(() => {});
    await chmod(MEMORY_BAK, 0o600).catch(() => {});
  }
  const tmp = join(MEMORY_DIR, `memory.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await chmod(tmp, 0o600).catch(() => {});
    await rename(tmp, MEMORY_JSON);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  await writeSecure(AUTO_MEMORY_FILE, renderView(store, now));
}
