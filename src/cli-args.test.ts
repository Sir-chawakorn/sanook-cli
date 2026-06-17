import { describe, expect, it } from 'vitest';
import { hasContinueAnyRequest, hasContinueRequest, hasResumeRequest, parseArgs, parseBudgetUsd } from './cli-args.js';

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
    expect(parseArgs(['--resume', 'abc123', 'summarize', 'state'])).toMatchObject({
      resume: 'abc123',
      prompt: 'summarize state',
    });
    expect(parseArgs(['-r', 'abc123']).resume).toBe('abc123');
  });

  it('detects split and inline resume requests', () => {
    expect(hasResumeRequest(['--resume', 'abc123'])).toBe(true);
    expect(hasResumeRequest(['-r', 'abc123'])).toBe(true);
    expect(hasResumeRequest(['--resume=abc123'])).toBe(true);
    expect(hasResumeRequest(['--continue'])).toBe(false);
  });

  it('detects continue requests before the option terminator', () => {
    expect(hasContinueRequest(['--continue'])).toBe(true);
    expect(hasContinueRequest(['-c'])).toBe(true);
    expect(hasContinueRequest(['--continue-any'])).toBe(true);
    expect(hasContinueAnyRequest(['--continue-any'])).toBe(true);
    expect(hasContinueAnyRequest(['--continue'])).toBe(false);
  });

  it('treats arguments after -- as prompt text', () => {
    const argv = ['--model', 'openai:gpt-5.5', '--', '-r', 'abc123', '--continue-any', 'fix'];

    expect(parseArgs(argv)).toMatchObject({
      model: 'openai:gpt-5.5',
      resume: undefined,
      prompt: '-r abc123 --continue-any fix',
    });
    expect(hasResumeRequest(argv)).toBe(false);
    expect(hasContinueRequest(argv)).toBe(false);
    expect(hasContinueAnyRequest(argv)).toBe(false);
  });

  it('maps output-format aliases', () => {
    expect(parseArgs(['--output-format', 'json', 'x']).json).toBe(true);
    expect(parseArgs(['--output-format', 'final', 'x']).quiet).toBe(true);
    expect(parseArgs(['--output-format', 'quiet', 'x']).quiet).toBe(true);
  });

  it('accepts inline values for long value flags', () => {
    expect(parseArgs(['--model=openai:gpt-5.5', '--budget=0.25', '--output-format=json', '--resume=abc123', 'fix'])).toMatchObject({
      model: 'openai:gpt-5.5',
      budget: 0.25,
      json: true,
      resume: 'abc123',
      prompt: 'fix',
    });
  });

  it('does not let missing option values consume following flags', () => {
    expect(parseArgs(['--model', '--json', 'fix'])).toMatchObject({
      model: undefined,
      json: true,
      prompt: 'fix',
    });
    expect(parseArgs(['--budget', '--quiet', 'fix'])).toMatchObject({
      budget: undefined,
      quiet: true,
      prompt: 'fix',
    });
    expect(parseArgs(['--resume', '--plan', 'fix'])).toMatchObject({
      resume: undefined,
      planMode: true,
      prompt: 'fix',
    });
    expect(parseArgs(['--model', '--budget=0.25', 'fix'])).toMatchObject({
      model: undefined,
      budget: 0.25,
      prompt: 'fix',
    });
    expect(parseArgs(['--model', '--unknown-mode', 'fix'])).toMatchObject({
      model: undefined,
      prompt: '--unknown-mode fix',
    });
  });

  it('normalizes invalid budgets to undefined', () => {
    expect(parseArgs(['--budget', 'abc', 'fix'])).toMatchObject({
      budget: undefined,
      prompt: 'fix',
    });
    expect(parseArgs(['--budget=Infinity', 'fix'])).toMatchObject({
      budget: undefined,
      prompt: 'fix',
    });
    expect(parseArgs(['--budget=1abc', 'fix'])).toMatchObject({
      budget: undefined,
      prompt: 'fix',
    });
    expect(parseArgs(['--budget', '0', 'fix'])).toMatchObject({
      budget: undefined,
      prompt: 'fix',
    });
    expect(parseArgs(['--budget=-0.25', 'fix'])).toMatchObject({
      budget: undefined,
      prompt: 'fix',
    });
    expect(parseArgs(['--budget=0x10', 'fix'])).toMatchObject({
      budget: undefined,
      prompt: 'fix',
    });
    expect(parseArgs(['--budget=0b10', 'fix'])).toMatchObject({
      budget: undefined,
      prompt: 'fix',
    });
    expect(parseArgs(['--budget=1e', 'fix'])).toMatchObject({
      budget: undefined,
      prompt: 'fix',
    });
    expect(parseArgs(['--budget=1e+', 'fix'])).toMatchObject({
      budget: undefined,
      prompt: 'fix',
    });
    expect(parseArgs(['--budget=.', 'fix'])).toMatchObject({
      budget: undefined,
      prompt: 'fix',
    });
  });

  it('accepts decimal budget forms only', () => {
    expect(parseArgs(['--budget=.25', 'fix'])).toMatchObject({
      budget: 0.25,
      prompt: 'fix',
    });
    expect(parseArgs(['--budget=1e-3', 'fix'])).toMatchObject({
      budget: 0.001,
      prompt: 'fix',
    });
  });

  it('keeps negative numeric values distinct from short flags without accepting invalid budgets', () => {
    expect(parseArgs(['--budget', '-0.25', 'fix'])).toMatchObject({
      budget: undefined,
      prompt: 'fix',
    });
    expect(parseArgs(['--model', '-1', 'fix'])).toMatchObject({
      model: '-1',
      prompt: 'fix',
    });
    expect(parseArgs(['--model', '-q', 'fix'])).toMatchObject({
      model: undefined,
      quiet: true,
      prompt: 'fix',
    });
  });

  it('accepts Hermes-style yolo aliases as auto-approve', () => {
    expect(parseArgs(['--yolo', 'fix']).yes).toBe(true);
    expect(parseArgs(['--dangerously-skip-permissions', 'fix']).yes).toBe(true);
  });
});

describe('parseBudgetUsd', () => {
  it('parses only positive finite decimal budget values', () => {
    expect(parseBudgetUsd('0.25')).toBe(0.25);
    expect(parseBudgetUsd(' .25 ')).toBe(0.25);
    expect(parseBudgetUsd('1e-3')).toBe(0.001);

    for (const value of ['0', '-0.25', '0x10', '0b10', '1abc', 'Infinity', '1e', '.']) {
      expect(parseBudgetUsd(value)).toBeUndefined();
    }
  });
});
