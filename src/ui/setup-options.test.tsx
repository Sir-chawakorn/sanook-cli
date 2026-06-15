import { describe, it, expect } from 'vitest';
import { providerOption } from './setup.js';

// P2: provider menu labels — hint per provider so the choice is obvious (env-independent cases)
describe('providerOption hints', () => {
  it('codex → "login ChatGPT" hint, no API key', () => {
    const o = providerOption('codex');
    expect(o.value).toBe('codex');
    expect(o.label).toContain('OpenAI Codex');
    expect(o.label).toContain('login ChatGPT');
    expect(o.label).toContain('ไม่ใช้ API key'); // บอกชัดว่าไม่ต้องใส่ key
  });

  it('local provider (ollama) → "local" hint', () => {
    const o = providerOption('ollama');
    expect(o.label).toContain('local');
    expect(o.label).toContain('ไม่ต้อง key');
  });

  it('cloud provider label carries its name', () => {
    expect(providerOption('anthropic').label).toContain('Anthropic');
    expect(providerOption('openai').label).toContain('OpenAI');
  });
});
