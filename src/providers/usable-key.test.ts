import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hasUsableEnvKey, detectEnvProvider } from './registry.js';

// env ของ provider ทั้งหมด — clear ก่อนเทสกัน key จริงบนเครื่องรันมารบกวน
const PROVIDER_ENV = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'MISTRAL_API_KEY', 'GROQ_API_KEY', 'ZHIPU_API_KEY', 'ZAI_API_KEY', 'GLM_API_KEY', 'MINIMAX_API_KEY',
];

describe('hasUsableEnvKey / detectEnvProvider — reject OAuth & malformed tokens (no false "ready")', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of PROVIDER_ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of PROVIDER_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('valid direct API key → usable + detected', () => {
    process.env.ANTHROPIC_API_KEY = `sk-ant-api03-${'A'.repeat(24)}`;
    expect(hasUsableEnvKey('anthropic')).toBe(true);
    expect(detectEnvProvider()?.provider).toBe('anthropic');
  });

  it('Claude.ai OAuth token (sk-ant-oat…) → NOT usable; wizard not skipped', () => {
    process.env.ANTHROPIC_API_KEY = `sk-ant-oat01-${'A'.repeat(24)}`;
    expect(hasUsableEnvKey('anthropic')).toBe(false);
    expect(detectEnvProvider()).toBeNull(); // → bin.ts จะ needsSetup=true (เข้า wizard)
  });

  it('malformed key → NOT usable', () => {
    process.env.ANTHROPIC_API_KEY = 'not-a-real-key';
    expect(hasUsableEnvKey('anthropic')).toBe(false);
  });

  it('no key set → not usable, nothing detected', () => {
    expect(hasUsableEnvKey('anthropic')).toBe(false);
    expect(detectEnvProvider()).toBeNull();
  });

  it('local provider (ollama) → always usable (no key required)', () => {
    expect(hasUsableEnvKey('ollama')).toBe(true);
  });

  it('delegate provider (codex) → not an env-key provider; readiness is checked separately', () => {
    expect(hasUsableEnvKey('codex')).toBe(false);
  });
});
