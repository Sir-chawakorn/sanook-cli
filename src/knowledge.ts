import { loadStore, activeFacts } from './memory-store.js';
import { loadSkills } from './skills.js';
import { loadIndex } from './search/store.js';
import { foldFacts, foldSessions, foldSkills, loadRecentSessions } from './search/indexer.js';
import { rankSearch, type SearchHit } from './search/engine.js';
import { termList } from './search/index-core.js';

// recall = ค้น knowledge ที่สะสม (auto-memory + vault + skills + session เก่า) แบบ BM25
// เดิมเป็น substring term-count (ไม่มี ranking/IDF) → อัปเกรดเป็น real BM25 inverted index
// (src/search/) ที่ rank ข้าม corpus เดียวกัน + ตัด snippet ให้
//
// freshness: โหลด persisted index (มี vault chunks จาก `sanook index` ล่าสุด) แล้ว
// fold memory/session/skill "สด" ทุกครั้ง → fact ที่เพิ่ง remember ค้นเจอทันทีโดยไม่ต้อง reindex
// (vault chunk ต้อง `sanook index` ก่อน · ไม่มี index = ค้นเฉพาะ live corpora ก็ยังได้)
//
// semantic/hybrid (BYOK embeddings) เปิดผ่าน `sanook search` / MCP `sanook_search`;
// recall tool คง default = BM25 (เร็ว ฟรี deterministic) ไม่ยิง network ตอน agent เรียกบ่อยๆ

/** นับจำนวน term ที่ปรากฏใน text (case-insensitive) — เก็บไว้ใช้/ทดสอบ (legacy scorer) */
export function scoreText(text: string, terms: string[]): number {
  const l = text.toLowerCase();
  return terms.reduce((s, t) => s + (l.includes(t) ? 1 : 0), 0);
}

/** label สั้นต่อ hit (memory ไม่มี title → ใช้ snippet; vault มี path ต่อท้าย) */
function formatHit(h: SearchHit): string {
  const title = h.title.trim();
  const snippet = h.snippet.trim();
  const head = title ? [title, snippet].filter(Boolean).join(' — ') : snippet;
  const where = h.path ? `  (${h.path})` : '';
  return `[${h.source}] ${head}${where}`.trim();
}

/**
 * ค้น knowledge ข้าม memory + vault + skills + sessions ด้วย BM25 (ranked + snippet).
 * คืน plain-text สำหรับ agent อ่าน (สัญญาเดิม) — ใช้โดย recall tool.
 */
export async function recall(query: string, limit = 8): Promise<string> {
  if (termList(query).length === 0) {
    return 'query สั้นเกินไป — ใส่คำค้นยาวขึ้น';
  }

  const now = Date.now();
  const { index } = await loadIndex(); // persisted (vault chunks); empty ok

  // fold live corpora สด — memory/session/skill ล่าสุด (ไม่แตะไฟล์ persisted)
  try {
    foldFacts(index, activeFacts(await loadStore(now)), now);
  } catch {
    /* ยังไม่มี memory */
  }
  try {
    foldSessions(index, await loadRecentSessions());
  } catch {
    /* ยังไม่มี session */
  }
  try {
    foldSkills(
      index,
      (await loadSkills()).map((s) => ({
        id: `skill:${s.name}`,
        name: s.name,
        text: `${s.description} ${s.whenToUse ?? ''}`.trim(),
      })),
    );
  } catch {
    /* ยังไม่มี skill */
  }

  const res = rankSearch(index, query, { mode: 'fts', limit });
  if (!res.hits.length) return `ไม่เจอความรู้เกี่ยวกับ "${query}" ใน memory/vault/skills/sessions`;
  return res.hits.map(formatHit).join('\n');
}
