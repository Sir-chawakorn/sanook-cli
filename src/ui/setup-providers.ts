import { PROVIDERS, hasUsableEnvKey } from '../providers/registry.js';
import { resolveKeyFromEnv } from '../providers/keys.js';

/** Provider menu order — Codex sits right after OpenAI (ChatGPT plan vs API key). */
export const SETUP_PROVIDER_ORDER = [
  'anthropic',
  'openai',
  'codex',
  'google',
  'xai',
  'mistral',
  'groq',
  'ollama',
  'lmstudio',
] as const;

/** label + hint ต่อ provider: เจอ key ใน env / local / ChatGPT-login / ต้องมี key — ให้เลือกง่ายขึ้น */
export function providerOption(id: string): { label: string; value: string } {
  const p = PROVIDERS[id];
  let hint: string;
  if (p.kind === 'delegate') hint = 'login ChatGPT · ไม่ใช้ API key';
  else if (!p.requiresKey) hint = 'local · ไม่ต้อง key';
  else if (hasUsableEnvKey(id)) hint = '✓ key ใน env ใช้ได้';
  else if (resolveKeyFromEnv(p.envVar, p.envFallbacks)) hint = 'key ใน env ใช้ไม่ได้';
  else hint = 'ต้องมี API key';
  return { label: `${p.label}  —  ${hint}`, value: p.id };
}

export function setupProviderOptions(): Array<{ label: string; value: string }> {
  return SETUP_PROVIDER_ORDER.filter((id) => PROVIDERS[id]).map((id) => providerOption(id));
}

/** Static lines so every provider (incl. Codex) is visible before scrolling the Select. */
export function setupProviderMenuLines(): string[] {
  return setupProviderOptions().map((option, index) => {
    const marker = option.value === 'codex' ? '★' : '·';
    return `   ${marker} ${index + 1}. ${option.label}`;
  });
}
