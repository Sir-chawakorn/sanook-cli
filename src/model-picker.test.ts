import { describe, expect, it } from 'vitest';
import { initialModelPickerIndex, modelPickerOptions } from './model-picker.js';

describe('model picker options', () => {
  it('groups provider aliases by canonical model id and marks the current model', () => {
    const options = modelPickerOptions('sonnet');
    const current = options[initialModelPickerIndex(options)];

    expect(options.some((option) => option.label === 'anthropic:sonnet')).toBe(true);
    expect(options.some((option) => option.label === 'openai:smart/gpt')).toBe(true);
    expect(current.spec).toBe('anthropic:claude-sonnet-4-6');
    expect(current.current).toBe(true);
  });

  it('keeps local and delegate providers visible', () => {
    const options = modelPickerOptions('sonnet');

    expect(options.find((option) => option.provider === 'ollama')?.status).toBe('local');
    expect(options.find((option) => option.provider === 'codex')?.status).toBe('delegate');
  });
});
