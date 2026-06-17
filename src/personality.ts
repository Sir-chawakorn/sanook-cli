export interface PersonalityDef {
  label: string;
  prompt: string;
}

export const PERSONALITIES: Record<string, PersonalityDef> = {
  concise: {
    label: 'Concise',
    prompt: 'Keep responses short, direct, and practical. Prefer the smallest useful answer.',
  },
  friendly: {
    label: 'Friendly',
    prompt: 'Use a warm, encouraging tone while staying precise and useful.',
  },
  formal: {
    label: 'Formal',
    prompt: 'Use a polished, professional tone. Avoid slang and keep recommendations structured.',
  },
  direct: {
    label: 'Direct',
    prompt: 'Be blunt, decisive, and action-oriented. Lead with the answer and avoid hedging.',
  },
  teacher: {
    label: 'Teacher',
    prompt: 'Explain the reasoning clearly and teach as you go, without becoming long-winded.',
  },
  researcher: {
    label: 'Researcher',
    prompt: 'Be evidence-minded. Distinguish facts, assumptions, and uncertainty clearly.',
  },
  creative: {
    label: 'Creative',
    prompt: 'Offer imaginative options and phrasing while keeping the implementation grounded.',
  },
  thai: {
    label: 'Thai-first',
    prompt: 'Prefer Thai for user-facing prose unless the user asks for another language.',
  },
};

export function normalizePersonalityName(raw: string | undefined): string | null {
  const name = raw?.trim().toLowerCase();
  if (!name) return null;
  if (['none', 'default', 'neutral', 'off', 'clear'].includes(name)) return 'none';
  return PERSONALITIES[name] ? name : null;
}

export function personalityPrompt(name: string | undefined): string {
  const normalized = normalizePersonalityName(name);
  if (!normalized || normalized === 'none') return '';
  const def = PERSONALITIES[normalized];
  return def ? `Personality overlay (${def.label}): ${def.prompt}` : '';
}

export function personalityListText(): string {
  return [
    'personality ที่เลือกได้:',
    '  none — ปิด personality overlay',
    ...Object.entries(PERSONALITIES).map(([name, def]) => `  ${name} — ${def.label}`),
    '',
    'ใช้: /personality <name>',
  ].join('\n');
}
