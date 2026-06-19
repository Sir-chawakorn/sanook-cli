// `sanook memory log` — a read-only viewer over the BI-TEMPORAL memory store: see how a belief about
// the project evolved over time (what was true, when it was superseded, and by what). The store keeps
// superseded/archived facts with validFrom/invalidatedAt/supersededBy/supersedes edges — most coding
// CLIs overwrite memory, so this "decision evolution" view is genuinely differentiated. Pure +
// deterministic (no disk/clock of its own) → fully testable.
import { type MemoryStore, type Fact, tokens } from './memory-store.js';

export interface MemoryLogEntry {
  fact: Fact;
  supersededBy?: Fact; // the fact that replaced it (resolved from supersededBy id)
  supersedes: Fact[]; // facts it replaced (resolved from supersedes ids)
}

export interface MemoryStats {
  total: number;
  active: number;
  superseded: number;
  archived: number;
  byTier: Record<string, number>;
}

function relevance(query: string, fact: Fact): number {
  const q = tokens(query);
  if (!q.size) return 0;
  const ft = tokens(fact.text);
  let overlap = 0;
  for (const t of q) if (ft.has(t)) overlap++;
  return overlap;
}

/**
 * Facts matching `query` across ALL statuses (active + superseded + archived), each with its
 * evolution edges resolved. Empty query → the most recently CHANGED facts (superseded/archived first)
 * so `sanook memory log` with no args surfaces "what beliefs changed recently".
 */
export function memoryLog(store: MemoryStore, query = '', limit = 12): MemoryLogEntry[] {
  const byId = new Map(store.facts.map((f) => [f.id, f]));
  const q = query.trim();
  const ranked = q
    ? store.facts
        .map((f) => ({ f, score: relevance(q, f) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.f.updated - a.f.updated)
        .map((x) => x.f)
    : [...store.facts]
        .filter((f) => f.status !== 'active') // no query → highlight what CHANGED
        .sort((a, b) => (b.invalidatedAt ?? b.updated) - (a.invalidatedAt ?? a.updated));
  return ranked.slice(0, limit).map((f) => ({
    fact: f,
    supersededBy: f.supersededBy ? byId.get(f.supersededBy) : undefined,
    supersedes: f.supersedes.map((id) => byId.get(id)).filter((x): x is Fact => !!x),
  }));
}

export function memoryStats(store: MemoryStore): MemoryStats {
  const byTier: Record<string, number> = {};
  let active = 0, superseded = 0, archived = 0;
  for (const f of store.facts) {
    byTier[f.tier] = (byTier[f.tier] ?? 0) + 1;
    if (f.status === 'active') active++;
    else if (f.status === 'superseded') superseded++;
    else if (f.status === 'archived') archived++;
  }
  return { total: store.facts.length, active, superseded, archived, byTier };
}

function day(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch {
    return '?';
  }
}

const BADGE: Record<string, string> = { active: '● active', superseded: '↻ superseded', archived: '⌁ archived' };

export function renderMemoryLog(entries: MemoryLogEntry[], query = ''): string {
  if (!entries.length) {
    return query ? `ไม่เจอ fact ที่ตรงกับ "${query}" ใน memory (รวม superseded/archived)` : 'ยังไม่มี belief ที่เปลี่ยน (superseded/archived) — memory ยังนิ่ง';
  }
  const lines: string[] = [query ? `memory log — "${query}" (${entries.length})` : `memory log — recent changes (${entries.length})`];
  for (const e of entries) {
    const f = e.fact;
    const when = f.invalidatedAt ? `${day(f.validFrom)} → ${day(f.invalidatedAt)}` : `since ${day(f.validFrom)}`;
    lines.push('', `${BADGE[f.status] ?? f.status}  [${f.noteType}/${f.tier}]  ${when}`);
    lines.push(`  ${f.text}`);
    if (e.supersededBy) lines.push(`  ↳ superseded by: ${e.supersededBy.text} (${day(e.supersededBy.validFrom)})`);
    for (const s of e.supersedes) lines.push(`  ↳ supersedes: ${s.text}`);
  }
  return lines.join('\n');
}

export function renderMemoryStats(s: MemoryStats): string {
  const tiers = Object.entries(s.byTier).map(([t, n]) => `${t}:${n}`).join(' · ') || '(none)';
  return [
    `memory: ${s.total} fact(s)`,
    `  ● active ${s.active} · ↻ superseded ${s.superseded} · ⌁ archived ${s.archived}`,
    `  tiers: ${tiers}`,
  ].join('\n');
}
