import { describe, expect, it } from 'vitest';
import { inlineValue, isFlagLike, takeValue } from './cli-option-values.js';

describe('cli option value helpers', () => {
  it('parses inline option values without treating empty assignments as values', () => {
    expect(inlineValue('--model', '--model=openai:gpt-5.5')).toBe('openai:gpt-5.5');
    expect(inlineValue('--model', '--models=openai:gpt-5.5')).toBeUndefined();
    expect(inlineValue('--model', '--model=')).toBeUndefined();
    expect(inlineValue('-d', '-d=7')).toBe('7');
  });

  it('takes split values without consuming following flags', () => {
    expect(takeValue(['--model', 'openai:gpt-5.5'], 0)).toEqual({
      value: 'openai:gpt-5.5',
      nextIndex: 1,
    });
    expect(takeValue(['--model', ''], 0)).toEqual({ nextIndex: 0 });
    expect(takeValue(['--model', '--json'], 0)).toEqual({ nextIndex: 0 });
    expect(takeValue(['--model', '-q'], 0)).toEqual({ nextIndex: 0 });
  });

  it('keeps negative numbers available as option values', () => {
    expect(isFlagLike('-q')).toBe(true);
    expect(isFlagLike('--json')).toBe(true);
    expect(isFlagLike('-1')).toBe(false);
    expect(isFlagLike('-0.25')).toBe(false);
    expect(takeValue(['--budget', '-0.25'], 0)).toEqual({
      value: '-0.25',
      nextIndex: 1,
    });
  });
});
