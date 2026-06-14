import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appHomePath, appProjectPath } from './brand.js';

// skills = วิธีทำงานเฉพาะทาง/runbook ที่โหลด on-demand (progressive disclosure)
// agent เห็นแค่ name+description ใน system prompt → โหลดเต็มด้วย `skill` tool เมื่อ task ตรง
// self-improvement: agent สร้าง skill เองด้วย `create_skill` เมื่อเจอ procedure ที่ reuse ได้
// 3 ชั้น: bundled (ship กับ CLI) → global (~/.sanook) → project (.sanook) — ชั้นหลัง override ชื่อซ้ำ
const BUNDLED_SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const GLOBAL_SKILLS = appHomePath('skills');
const projectSkills = (): string => appProjectPath(process.cwd(), 'skills');

export interface Skill {
  name: string;
  description: string;
  whenToUse?: string;
  path: string;
}

/** minimal frontmatter parser (key: value ใน --- block) — ไม่พึ่ง YAML dep */
export function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (k) meta[k] = v;
  }
  return { meta, body: m[2] };
}

/** ป้องกัน path traversal — ชื่อ skill ต้องเป็น slug ปลอดภัย */
export function isValidSkillName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);
}

/** scan project + global skills → list (name+description เท่านั้น สำหรับ inject). project ทับ global ชื่อซ้ำ */
export async function loadSkills(): Promise<Skill[]> {
  const out = new Map<string, Skill>();
  // bundled ก่อน → global → project ทับ (specific กว่าอยู่ท้าย)
  for (const dir of [BUNDLED_SKILLS, GLOBAL_SKILLS, projectSkills()]) {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // ไม่มีโฟลเดอร์ = ข้าม
    }
    for (const e of entries) {
      if (!e.isDirectory() || !isValidSkillName(e.name)) continue;
      const p = join(dir, e.name, 'SKILL.md');
      try {
        const { meta } = parseFrontmatter(await readFile(p, 'utf8'));
        out.set(meta.name || e.name, {
          name: meta.name || e.name,
          description: meta.description ?? '',
          whenToUse: meta.when_to_use,
          path: p,
        });
      } catch {
        // ไม่มี SKILL.md = ข้าม
      }
    }
  }
  return [...out.values()];
}

/** อ่านเนื้อหา SKILL.md เต็ม (skill tool เรียกเมื่อ agent ตัดสินใจใช้) */
export async function getSkillBody(name: string): Promise<string | null> {
  if (!isValidSkillName(name)) return null;
  for (const dir of [projectSkills(), GLOBAL_SKILLS, BUNDLED_SKILLS]) {
    try {
      return await readFile(join(dir, name, 'SKILL.md'), 'utf8');
    } catch {
      /* ลอง dir ถัดไป */
    }
  }
  return null;
}

/** สร้าง/อัปเดต skill (create_skill tool เรียก) — เขียนลง global skills */
export async function saveSkill(name: string, description: string, body: string, whenToUse?: string): Promise<string> {
  if (!isValidSkillName(name)) {
    throw new Error(`ชื่อ skill ไม่ถูกต้อง: "${name}" — ใช้ a-z 0-9 - เท่านั้น`);
  }
  const dir = join(GLOBAL_SKILLS, name);
  await mkdir(dir, { recursive: true });
  const fm = [
    '---',
    `name: ${name}`,
    `description: ${description.replace(/\n/g, ' ').trim()}`,
    ...(whenToUse ? [`when_to_use: ${whenToUse.replace(/\n/g, ' ').trim()}`] : []),
    '---',
    '',
    body.trim(),
    '',
  ].join('\n');
  const p = join(dir, 'SKILL.md');
  await writeFile(p, fm);
  return p;
}

/** render รายชื่อ skill (name+desc) สำหรับ inject เข้า system prompt */
export function renderAvailableSkills(skills: Skill[]): string {
  if (!skills.length) return '';
  // truncate description กัน system prompt บวมเมื่อ skill เยอะ (whenToUse/body เต็มอ่านผ่าน skill/find_skills tool)
  const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
  const lines = skills.map((s) => `- ${s.name}: ${trunc(s.description, 140)}`);
  return `<available_skills note="โหลดเต็มด้วย skill tool · ค้นด้วย find_skills เมื่อไม่แน่ใจว่าตัวไหนตรง">\n${lines.join('\n')}\n</available_skills>`;
}
