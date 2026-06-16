import { describe, expect, it } from 'vitest';
import { parseArgs } from './cli-args.js';

describe('parseArgs', () => {
  it('parses headless prompt flags', () => {
    expect(parseArgs(['-m', 'openai:gpt-5.5', '-b', '0.25', '--json', '--yes', 'fix', 'tests'])).toMatchObject({
      model: 'openai:gpt-5.5',
      budget: 0.25,
      json: true,
      yes: true,
      prompt: 'fix tests',
    });
  });

  it('consumes resume flags without turning them into prompts', () => {
    expect(parseArgs(['--continue-any']).prompt).toBe('');
    expect(parseArgs(['-c']).prompt).toBe('');
    expect(parseArgs(['--continue', 'summarize', 'state']).prompt).toBe('summarize state');
  });

  it('maps output-format aliases', () => {
    expect(parseArgs(['--output-format', 'json', 'x']).json).toBe(true);
    expect(parseArgs(['--output-format', 'final', 'x']).quiet).toBe(true);
    expect(parseArgs(['--output-format', 'quiet', 'x']).quiet).toBe(true);
  });
});
