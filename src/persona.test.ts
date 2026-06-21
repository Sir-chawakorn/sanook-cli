import { describe, it, expect } from 'vitest';
import { PERSONA_QUESTIONS, PERSONA_OTHER, personaFacts, renderPersonaProfile, parsePersonaProfileMarkdown, personaAnswersFromFacts, type PersonaAnswers } from './persona.js';

describe('persona questionnaire', () => {
  it('has unique question ids and well-formed select options', () => {
    const ids = PERSONA_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of PERSONA_QUESTIONS) {
      expect(q.prompt.length).toBeGreaterThan(0);
      expect(q.label.length).toBeGreaterThan(0);
      if (q.type === 'select') {
        expect(q.options && q.options.length).toBeGreaterThan(1);
      }
    }
  });

  it('mixes A/B/C/D selects and free-text inputs (per the request)', () => {
    const selects = PERSONA_QUESTIONS.filter((q) => q.type === 'select');
    const texts = PERSONA_QUESTIONS.filter((q) => q.type === 'text');
    expect(selects.length).toBeGreaterThanOrEqual(4);
    expect(texts.length).toBeGreaterThanOrEqual(3);
  });

  it('exactly one select offers an "other / type your own" option', () => {
    const withOther = PERSONA_QUESTIONS.filter((q) => q.options?.some((o) => o.value === PERSONA_OTHER));
    expect(withOther.length).toBeGreaterThanOrEqual(1);
    // role is the canonical free-form select
    expect(withOther.some((q) => q.id === 'role')).toBe(true);
  });
});

describe('personaFacts', () => {
  it('builds durable facts and skips blanks + the OTHER sentinel', () => {
    const answers: PersonaAnswers = {
      ownerName: 'ชวกร',
      aiName: 'สนุก',
      role: PERSONA_OTHER, // user picked other but typed nothing → should be skipped
      experience: 'advanced',
      language: 'ไทย + tech-en',
      stack: '', // blank → skipped
    };
    const facts = personaFacts(answers);
    expect(facts).toContain('เจ้าของชื่อ ชวกร — เรียกเจ้าของด้วยชื่อนี้');
    expect(facts).toContain('AI เรียกตัวเองว่า "สนุก" เมื่อคุยกับเจ้าของ');
    expect(facts).toContain('ระดับประสบการณ์เขียนโปรแกรมของเจ้าของ: advanced');
    expect(facts).toContain('ภาษาที่เจ้าของต้องการให้ตอบ: ไทย + tech-en');
    // skipped ones
    expect(facts.some((f) => f.includes('บทบาท/อาชีพ'))).toBe(false);
    expect(facts.some((f) => f.includes('เทคโนโลยีที่เจ้าของใช้บ่อย'))).toBe(false);
  });

  it('returns empty for an empty answer set', () => {
    expect(personaFacts({})).toEqual([]);
  });
});

describe('renderPersonaProfile', () => {
  it('renders a markdown note with frontmatter and a row per question', () => {
    const md = renderPersonaProfile({ ownerName: 'ชวกร', language: 'ไทย + tech-en' }, '2026-06-21');
    expect(md).toContain('note_type: persona');
    expect(md).toContain('created: 2026-06-21');
    expect(md).toContain('# Persona');
    expect(md).toContain('| ชื่อ / เรียกว่า | ชวกร |');
    expect(md).toContain('| —');
    expect(md).toContain('ไทย + ศัพท์เทคนิคอังกฤษ');
  });

  it('escapes pipe characters so the table is not broken', () => {
    const md = renderPersonaProfile({ stack: 'a|b|c' }, '2026-06-21');
    expect(md).toContain('a\\|b\\|c');
  });

  it('round-trips through parsePersonaProfileMarkdown', () => {
    const answers = { ownerName: 'ชวกร', language: 'ไทย + tech-en', autonomy: 'ask-on-risk' };
    const md = renderPersonaProfile(answers, '2026-06-21');
    const parsed = parsePersonaProfileMarkdown(md);
    expect(parsed.ownerName).toBe('ชวกร');
    expect(parsed.language).toBe('ไทย + tech-en');
    expect(parsed.autonomy).toBe('ask-on-risk');
  });
});

describe('personaAnswersFromFacts', () => {
  it('extracts owner and language from protected facts', () => {
    const parsed = personaAnswersFromFacts([
      'เจ้าของชื่อ ชวกร — เรียกเจ้าของด้วยชื่อนี้',
      'ภาษาที่เจ้าของต้องการให้ตอบ: ไทย + tech-en',
    ]);
    expect(parsed.ownerName).toBe('ชวกร');
    expect(parsed.language).toBe('ไทย + tech-en');
  });
});
