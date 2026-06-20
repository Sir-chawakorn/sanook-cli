import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerOption, setupProviderMenuLines, SETUP_PROVIDER_ORDER } from './setup-providers.js';

describe('setup provider menu', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists Codex right after OpenAI', () => {
    expect(SETUP_PROVIDER_ORDER.indexOf('openai')).toBe(1);
    expect(SETUP_PROVIDER_ORDER.indexOf('codex')).toBe(2);
  });

  it('codex → "login ChatGPT" hint, no API key', () => {
    const o = providerOption('codex');
    expect(o.value).toBe('codex');
    expect(o.label).toContain('OpenAI Codex');
    expect(o.label).toContain('login ChatGPT');
    expect(o.label).toContain('ไม่ใช้ API key');
  });

  it('static menu lines include Codex marker', () => {
    const lines = setupProviderMenuLines();
    expect(lines.some((line) => line.includes('★') && line.includes('OpenAI Codex'))).toBe(true);
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

  it('cloud provider shows a usable env key only after policy validation', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', `sk-ant-api03-${'A'.repeat(24)}`);
    expect(providerOption('anthropic').label).toContain('✓ key ใน env ใช้ได้');
  });

  it('cloud provider flags env keys that exist but fail policy validation', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', `sk-ant-oat01-${'A'.repeat(24)}`);
    const label = providerOption('anthropic').label;
    expect(label).toContain('key ใน env ใช้ไม่ได้');
    expect(label).not.toContain('✓');
  });
});
