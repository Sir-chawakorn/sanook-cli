// Persona questionnaire — questions, durable-fact mapping, and the vault profile note.
// Pure / no-UI so it stays unit-testable; the Ink wizard (src/ui/persona-wizard.tsx)
// renders PERSONA_QUESTIONS and the persist layer (src/memory.ts) uses personaFacts /
// renderPersonaProfile to write to auto-memory + the second-brain vault.

export type PersonaQuestionType = 'text' | 'select';

export interface PersonaOption {
  /** label shown in the menu (A/B/C/D-style) */
  label: string;
  /** stored value — natural phrase so the fact reads well; '__other__' triggers a free-text follow-up */
  value: string;
}

export interface PersonaQuestion {
  id: string;
  /** the question shown to the user */
  prompt: string;
  type: PersonaQuestionType;
  /** select options (A/B/C/D) — only for type 'select' */
  options?: PersonaOption[];
  /** placeholder / hint for text input */
  placeholder?: string;
  /** label used in the vault profile table */
  label: string;
  /** build a durable owner fact from the answer; return null to skip (e.g. empty) */
  fact: (value: string) => string | null;
}

/** sentinel value: a select option that drops into a free-text follow-up */
export const PERSONA_OTHER = '__other__';

const otherOption: PersonaOption = { label: 'อื่นๆ (พิมพ์เอง)', value: PERSONA_OTHER };

/**
 * The questionnaire. Mix of A/B/C/D selects and free-text inputs so the agent learns
 * who the owner is + how they want to be worked with. Text answers may be left blank
 * (Enter to skip) — blanks are not written as facts.
 */
export const PERSONA_QUESTIONS: PersonaQuestion[] = [
  {
    id: 'ownerName',
    prompt: 'เรียกคุณว่าอะไรดี? (ชื่อ / ชื่อเล่น)',
    type: 'text',
    label: 'ชื่อ / เรียกว่า',
    placeholder: 'เช่น ชวกร, พี่หนึ่ง',
    fact: (v) => (v ? `เจ้าของชื่อ ${v} — เรียกเจ้าของด้วยชื่อนี้` : null),
  },
  {
    id: 'aiName',
    prompt: 'อยากให้ AI เรียกตัวเองว่าอะไร?',
    type: 'text',
    label: 'AI เรียกตัวเองว่า',
    placeholder: 'เช่น สนุก, ผู้ช่วย',
    fact: (v) => (v ? `AI เรียกตัวเองว่า "${v}" เมื่อคุยกับเจ้าของ` : null),
  },
  {
    id: 'role',
    prompt: 'อาชีพ / บทบาทหลักของคุณคืออะไร?',
    type: 'select',
    label: 'บทบาท / อาชีพ',
    options: [
      { label: 'นักพัฒนา / โปรแกรมเมอร์', value: 'นักพัฒนา/โปรแกรมเมอร์' },
      { label: 'นักเรียน / นักศึกษา', value: 'นักเรียน/นักศึกษา' },
      { label: 'ครู / อาจารย์', value: 'ครู/อาจารย์' },
      { label: 'เจ้าของธุรกิจ / ฟรีแลนซ์', value: 'เจ้าของธุรกิจ/ฟรีแลนซ์' },
      otherOption,
    ],
    fact: (v) => (v ? `บทบาท/อาชีพของเจ้าของ: ${v}` : null),
  },
  {
    id: 'experience',
    prompt: 'ระดับประสบการณ์การเขียนโปรแกรมของคุณ?',
    type: 'select',
    label: 'ประสบการณ์',
    options: [
      { label: 'เริ่มต้น (beginner)', value: 'beginner' },
      { label: 'ระดับกลาง (intermediate)', value: 'intermediate' },
      { label: 'ระดับสูง (advanced)', value: 'advanced' },
      { label: 'เชี่ยวชาญ (expert)', value: 'expert' },
      { label: 'ไม่ใช่สายโค้ด', value: 'ไม่ใช่สายโค้ด' },
    ],
    fact: (v) => (v ? `ระดับประสบการณ์เขียนโปรแกรมของเจ้าของ: ${v}` : null),
  },
  {
    id: 'language',
    prompt: 'อยากให้ AI ตอบเป็นภาษาอะไร?',
    type: 'select',
    label: 'ภาษา',
    options: [
      { label: 'ไทยล้วน', value: 'ไทย' },
      { label: 'ไทย + ศัพท์เทคนิคอังกฤษ', value: 'ไทย + tech-en' },
      { label: 'อังกฤษล้วน', value: 'English' },
    ],
    fact: (v) => (v ? `ภาษาที่เจ้าของต้องการให้ตอบ: ${v}` : null),
  },
  {
    id: 'tone',
    prompt: 'อยากให้โทนการสื่อสารเป็นแบบไหน?',
    type: 'select',
    label: 'โทน',
    options: [
      { label: 'กระชับ ตรงประเด็น', value: 'กระชับ ตรงประเด็น' },
      { label: 'ละเอียด อธิบายเยอะ', value: 'ละเอียด อธิบายเยอะ' },
      { label: 'เป็นกันเอง สนุก', value: 'เป็นกันเอง สนุก' },
      { label: 'ทางการ สุภาพ', value: 'ทางการ สุภาพ' },
    ],
    fact: (v) => (v ? `โทนการสื่อสารที่เจ้าของชอบ: ${v}` : null),
  },
  {
    id: 'depth',
    prompt: 'เวลาอธิบายโค้ด/คำตอบ อยากได้ละเอียดแค่ไหน?',
    type: 'select',
    label: 'ความละเอียดของคำอธิบาย',
    options: [
      { label: 'เอาแค่คำตอบ / โค้ด', value: 'เอาแค่คำตอบ' },
      { label: 'คำตอบ + เหตุผลสั้นๆ', value: 'คำตอบ + เหตุผลสั้นๆ' },
      { label: 'อธิบายละเอียดทีละขั้น', value: 'อธิบายละเอียดทีละขั้น' },
    ],
    fact: (v) => (v ? `ระดับความละเอียดที่เจ้าของอยากได้เวลาอธิบาย: ${v}` : null),
  },
  {
    id: 'autonomy',
    prompt: 'อยากให้ AI ทำงานแบบไหน?',
    type: 'select',
    label: 'Autonomy',
    options: [
      { label: 'ask-on-risk — ทำเลย ถามเฉพาะตอนเสี่ยง', value: 'ask-on-risk' },
      { label: 'act-first — ลงมือก่อน รายงานทีหลัง', value: 'act-first' },
      { label: 'ask-first — ถามก่อนทุกครั้ง', value: 'ask-first' },
    ],
    fact: (v) => (v ? `ระดับ autonomy ที่เจ้าของเลือก: ${v}` : null),
  },
  {
    id: 'stack',
    prompt: 'ภาษา / เทคโนโลยีที่ใช้บ่อย? (Enter เพื่อข้าม)',
    type: 'text',
    label: 'เทคโนโลยีที่ใช้บ่อย',
    placeholder: 'เช่น TypeScript, React, Python, PostgreSQL',
    fact: (v) => (v ? `เทคโนโลยีที่เจ้าของใช้บ่อย: ${v}` : null),
  },
  {
    id: 'domains',
    prompt: 'สนใจ / ทำงานด้านไหนเป็นหลัก? (Enter เพื่อข้าม)',
    type: 'text',
    label: 'ด้านที่สนใจ',
    placeholder: 'เช่น web, AI/ML, mobile, การศึกษา',
    fact: (v) => (v ? `ด้านที่เจ้าของทำงาน/สนใจ: ${v}` : null),
  },
  {
    id: 'goals',
    prompt: 'ตอนนี้กำลังโฟกัสทำอะไร / เป้าหมายหลัก? (Enter เพื่อข้าม)',
    type: 'text',
    label: 'เป้าหมาย / โฟกัส',
    placeholder: 'เช่น สร้าง CLI ของตัวเอง, เรียน Rust',
    fact: (v) => (v ? `เป้าหมาย/สิ่งที่เจ้าของกำลังโฟกัส: ${v}` : null),
  },
  {
    id: 'preferences',
    prompt: 'มีอะไรที่ชอบ / ไม่ชอบให้ AI ทำไหม? (Enter เพื่อข้าม)',
    type: 'text',
    label: 'สิ่งที่ชอบ/ไม่ชอบ',
    placeholder: 'เช่น อย่าใส่ emoji, ใส่คอมเมนต์ภาษาไทย',
    fact: (v) => (v ? `สิ่งที่เจ้าของชอบ/ไม่ชอบให้ AI ทำ: ${v}` : null),
  },
  {
    id: 'emoji',
    prompt: 'ใช้ emoji ในคำตอบไหม?',
    type: 'select',
    label: 'การใช้ emoji',
    options: [
      { label: 'ใช้ได้', value: 'ใช้ได้' },
      { label: 'ใช้น้อยๆ', value: 'ใช้น้อยๆ' },
      { label: 'ไม่ใช้เลย', value: 'ไม่ใช้เลย' },
    ],
    fact: (v) => (v ? `การใช้ emoji ที่เจ้าของต้องการ: ${v}` : null),
  },
  {
    id: 'timezone',
    prompt: 'Timezone / เวลาทำงานปกติ? (Enter เพื่อข้าม)',
    type: 'text',
    label: 'Timezone / เวลาทำงาน',
    placeholder: 'เช่น Asia/Bangkok, ชอบทำงานกลางคืน',
    fact: (v) => (v ? `Timezone/เวลาทำงานของเจ้าของ: ${v}` : null),
  },
];

export type PersonaAnswers = Record<string, string>;

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

/** Build durable owner facts (protected tier) from the answers, skipping blanks/sentinels. */
export function personaFacts(answers: PersonaAnswers): string[] {
  const out: string[] = [];
  for (const q of PERSONA_QUESTIONS) {
    const v = clean(answers[q.id]);
    if (!v || v === PERSONA_OTHER) continue;
    const fact = q.fact(v);
    if (fact) out.push(fact);
  }
  return out;
}

/** human-friendly label for a stored select value (falls back to the raw value / free text). */
function answerLabel(q: PersonaQuestion, value: string): string {
  if (q.type === 'select' && q.options) {
    const hit = q.options.find((o) => o.value === value);
    if (hit && hit.value !== PERSONA_OTHER) return hit.label;
  }
  return value;
}

/** Render the second-brain persona profile note (markdown) from the answers. */
export function renderPersonaProfile(answers: PersonaAnswers, today: string): string {
  const rows = PERSONA_QUESTIONS.map((q) => {
    const v = clean(answers[q.id]);
    const shown = v && v !== PERSONA_OTHER ? answerLabel(q, v) : '—';
    return `| ${q.label} | ${shown.replace(/\|/g, '\\|')} |`;
  }).join('\n');

  return `---
tags: [persona, identity, user-owned]
note_type: persona
created: ${today}
updated: ${today}
source: "sanook persona"
parent: "[[Shared/User-Persona/_Index]]"
---

# Persona — โปรไฟล์เจ้าของ

> สร้างจากคำสั่ง \`sanook persona\` — AI อ่านบริบทนี้เพื่อเข้าใจเจ้าของและปรับสไตล์การทำงาน.
> แก้ไขได้โดยตรง หรือรัน \`sanook persona\` ใหม่เพื่ออัปเดต (เขียนทับไฟล์นี้).

## โปรไฟล์

| หัวข้อ | ค่า |
|---|---|
${rows}

up:: [[Shared/User-Persona/_Index]]
`;
}
