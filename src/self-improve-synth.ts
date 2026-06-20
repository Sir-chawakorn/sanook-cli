// Default skill synthesizer for self-improvement. Tries the model (cheap sibling) to write a
// proper runbook; if no key resolves or the model output isn't usable, falls back to a deterministic
// template built from the observed prompts — so a skill is ALWAYS created on the Nth repeat without
// depending on fragile LLM JSON. Kept out of self-improve.ts so the detection core stays offline.
import { generateText } from 'ai';
import { resolveModel, fastSibling, PROVIDERS, parseSpec } from './providers/registry.js';
import { redactKey } from './providers/keys.js';
import type { SkillDraft, SkillSynthesizer, TaskFamily } from './self-improve.js';
import { slugifySkillName } from './self-improve.js';

const SYNTH_PROMPT =
  'คุณกำลังสร้าง "skill" (runbook ทำซ้ำได้) จากคำสั่งที่ผู้ใช้สั่งซ้ำหลายครั้ง. ' +
  'ตอบเป็น JSON อย่างเดียว (ไม่มีข้อความอื่น) รูปแบบ: ' +
  '{"name":"slug-a-z0-9-","description":"1 บรรทัดบอกว่า skill ทำอะไร","when_to_use":"เมื่อไรควรหยิบมาใช้","steps":["ขั้นตอน 1","ขั้นตอน 2"]}. ' +
  'name ต้องเป็น slug a-z 0-9 - สั้นๆ. steps เป็นขั้นตอนที่ทำให้ครั้งหน้าทำงานนี้ได้เร็วและไม่พลาด.\n\nคำสั่งที่สั่งซ้ำ:\n';

interface ParsedSkill {
  name?: unknown;
  description?: unknown;
  when_to_use?: unknown;
  steps?: unknown;
}

function templateDraft(family: TaskFamily): SkillDraft {
  const top = family.terms.slice(0, 4).join('-');
  const name = slugifySkillName(top || family.samples[0] || 'recurring-task');
  const requests = family.samples.map((s) => `- ${s}`).join('\n');
  const body = [
    '## When to Use',
    `งานเกี่ยวกับ: ${family.terms.slice(0, 8).join(', ')}`,
    '',
    '## Observed requests',
    requests,
    '',
    '## Steps',
    '_(สร้างอัตโนมัติจากงานที่ทำซ้ำ — เพิ่มขั้นตอน/คำสั่งที่ใช้จริงได้)_',
    '',
    '## Common Errors / Gotchas',
    '_(เติมข้อควรระวังที่เจอระหว่างทำงานนี้)_',
  ].join('\n');
  return {
    name,
    description: `งานที่ทำซ้ำ: ${family.samples[0]?.slice(0, 80) ?? family.terms.slice(0, 5).join(' ')}`,
    whenToUse: `เมื่อเจองานเกี่ยวกับ ${family.terms.slice(0, 5).join(', ')}`,
    body,
  };
}

function draftFromModelText(text: string, family: TaskFamily): SkillDraft | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: ParsedSkill;
  try {
    parsed = JSON.parse(match[0]) as ParsedSkill;
  } catch {
    return null;
  }
  const name = typeof parsed.name === 'string' ? parsed.name : '';
  const description = typeof parsed.description === 'string' ? parsed.description : '';
  const whenToUse = typeof parsed.when_to_use === 'string' ? parsed.when_to_use : undefined;
  const steps = Array.isArray(parsed.steps) ? parsed.steps.filter((s): s is string => typeof s === 'string') : [];
  if (!name.trim() || !steps.length) return null;
  const fallback = templateDraft(family);
  const body = [
    '## When to Use',
    whenToUse || fallback.whenToUse || '',
    '',
    '## Steps',
    steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    '',
    '## Observed requests',
    family.samples.map((s) => `- ${s}`).join('\n'),
  ].join('\n');
  return { name, description: description || fallback.description, whenToUse, body };
}

/** สร้าง synthesizer: ลอง model ก่อน (ค่าย sibling ถูก) → ถ้าไม่ได้ key/parse พัง ใช้ template */
export function defaultSkillSynthesizer(mainModel: string): SkillSynthesizer {
  return async (family: TaskFamily): Promise<SkillDraft | null> => {
    // delegate provider (codex) ไม่มี generateText ตรง → ใช้ template ทันที
    if (PROVIDERS[parseSpec(mainModel).provider]?.kind === 'delegate') return templateDraft(family);
    const transcript = family.samples.map((s, i) => `${i + 1}. ${s}`).join('\n');
    try {
      const { text } = await generateText({
        model: resolveModel(fastSibling(mainModel)),
        prompt: SYNTH_PROMPT + redactKey(transcript),
        maxOutputTokens: 700,
      });
      return draftFromModelText(text, family) ?? templateDraft(family);
    } catch {
      return templateDraft(family); // ไม่มี key / network ล้ม → ยังสร้าง skill ได้
    }
  };
}
