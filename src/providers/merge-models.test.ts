import { describe, it, expect } from 'vitest';
import { mergeModelOptions } from './models.js';
import { PROVIDERS } from './registry.js';

describe('mergeModelOptions — no duplicate options (the "two identical choices" bug)', () => {
  it('every provider yields unique option values (no React key collision)', () => {
    for (const cfg of Object.values(PROVIDERS)) {
      const opts = mergeModelOptions(cfg, []);
      const values = opts.map((o) => o.value);
      expect(new Set(values).size, `${cfg.id} has duplicate model option values: ${values.join(', ')}`).toBe(values.length);
    }
  });

  it('aliases that map to the same id are merged into one labelled option', () => {
    // anthropic: haiku + fast → claude-haiku-4-5 (one option, both names shown)
    const opts = mergeModelOptions(PROVIDERS.anthropic, []);
    const haikuOpts = opts.filter((o) => o.value === 'claude-haiku-4-5');
    expect(haikuOpts).toHaveLength(1);
    expect(haikuOpts[0].label).toContain('haiku');
    expect(haikuOpts[0].label).toContain('fast');
  });

  it("hides the word 'default' from labels when a named alias exists (but keeps the id)", () => {
    const opts = mergeModelOptions(PROVIDERS.openai, []);
    expect(opts.some((o) => o.label.startsWith('default '))).toBe(false);
    expect(opts.some((o) => o.value === PROVIDERS.openai.models.default)).toBe(true); // default's id still selectable
  });

  it("keeps a model whose ONLY alias is 'default' (no empty/dead-end model list)", () => {
    // lmstudio: { default: 'local-model' } — must NOT vanish (was an empty Select before)
    const lm = mergeModelOptions(PROVIDERS.lmstudio, []);
    expect(lm.length).toBeGreaterThan(0);
    expect(lm.map((o) => o.value)).toContain('local-model');
    // ollama: default llama3.3 (unique id) must remain selectable alongside mistral
    const ol = mergeModelOptions(PROVIDERS.ollama, []);
    expect(ol.map((o) => o.value)).toContain('llama3.3');
    expect(ol.map((o) => o.value)).toContain('mistral');
  });

  it('remote ids dedupe against curated and against themselves', () => {
    const opts = mergeModelOptions(PROVIDERS.openai, ['gpt-5.5', 'brand-new-model', 'brand-new-model']);
    const values = opts.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length); // still unique
    expect(values).toContain('brand-new-model'); // genuinely new id kept
    expect(values.filter((v) => v === 'gpt-5.5')).toHaveLength(1); // gpt-5.5 already curated → not re-added
  });

  it('codex offers only ChatGPT-plan-safe models (no legacy *-codex ids)', () => {
    const opts = mergeModelOptions(PROVIDERS.codex, ['gpt-5-codex', 'gpt-5.3-codex']);
    expect(opts.map((o) => o.value).sort()).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5']);
  });
});
