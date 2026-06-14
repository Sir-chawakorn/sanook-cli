import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSkills } from './skills.js';
import { appHomePath } from './brand.js';

// recall = ค้น knowledge ที่สะสม (auto-memory + skills + session เก่า) แบบ keyword scoring
// "second brain ค้นได้" — ให้ agent reuse ของเดิม ไม่เริ่มจากศูนย์/ไม่ลืมว่าเคยทำอะไร
const AUTO_MEM = appHomePath('memory', 'MEMORY.md');
const SESSIONS = appHomePath('sessions');

interface Hit {
  src: string;
  text: string;
  score: number;
}

/** นับจำนวน term ที่ปรากฏใน text (case-insensitive) */
export function scoreText(text: string, terms: string[]): number {
  const l = text.toLowerCase();
  return terms.reduce((s, t) => s + (l.includes(t) ? 1 : 0), 0);
}

function termsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export async function recall(query: string, limit = 8): Promise<string> {
  const terms = termsOf(query);
  if (!terms.length) return 'query สั้นเกินไป — ใส่คำค้นยาวขึ้น';
  const hits: Hit[] = [];

  // 1) auto-memory (ทีละบรรทัด)
  try {
    for (const line of (await readFile(AUTO_MEM, 'utf8')).split('\n')) {
      const t = line.trim();
      const sc = scoreText(t, terms);
      if (sc > 0 && t) hits.push({ src: 'memory', text: t, score: sc });
    }
  } catch {
    /* ยังไม่มี memory */
  }

  // 2) skills (weight สูงขึ้นนิด — เป็น procedure พร้อมใช้)
  for (const s of await loadSkills()) {
    const sc = scoreText(`${s.name} ${s.description} ${s.whenToUse ?? ''}`, terms);
    if (sc > 0) hits.push({ src: 'skill', text: `${s.name}: ${s.description}`, score: sc + 1 });
  }

  // 3) sessions เก่า (ค้นใน user message แรก — งานที่เคยสั่ง)
  try {
    const files = (await readdir(SESSIONS)).filter((f) => f.endsWith('.json')).slice(-40);
    for (const f of files) {
      try {
        const s = JSON.parse(await readFile(join(SESSIONS, f), 'utf8')) as {
          id?: string;
          messages?: { role: string; content: unknown }[];
        };
        const firstUser = (s.messages ?? []).find((m) => m.role === 'user');
        const text = typeof firstUser?.content === 'string' ? firstUser.content : '';
        const sc = scoreText(text, terms);
        if (sc > 0 && text) hits.push({ src: `session:${s.id ?? f}`, text: text.slice(0, 120), score: sc });
      } catch {
        /* session พัง = ข้าม */
      }
    }
  } catch {
    /* ยังไม่มี session */
  }

  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, limit);
  if (!top.length) return `ไม่เจอความรู้เกี่ยวกับ "${query}" ใน memory/skills/sessions`;
  return top.map((h) => `[${h.src}] ${h.text}`).join('\n');
}
