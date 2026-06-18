import { describe, expect, it } from 'vitest';
import {
  hasContinueAnyRequest,
  hasContinueRequest,
  hasResumeRequest,
  hasServeCommandRequest,
  parseArgs,
  parseBudgetUsd,
  parseServeArgs,
  parseThinkingConfigValue,
} from './cli-args.js';

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

  it('trims model values and ignores blanks', () => {
    expect(parseArgs(['--model', '  openai:gpt-5.5  ', 'fix'])).toMatchObject({
      model: 'openai:gpt-5.5',
      prompt: 'fix',
    });
    expect(parseArgs(['--model=  sonnet  ', 'fix'])).toMatchObject({
      model: 'sonnet',
      prompt: 'fix',
    });
    expect(parseArgs(['--model', '   ', 'fix'])).toMatchObject({
      model: undefined,
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

describe('parseThinkingConfigValue', () => {
  it('parses on/off flags and positive safe integer budgets', () => {
    expect(parseThinkingConfigValue('on')).toBe(true);
    expect(parseThinkingConfigValue(' ON ')).toBe(true);
    expect(parseThinkingConfigValue(' true ')).toBe(true);
    expect(parseThinkingConfigValue('off')).toBe(false);
    expect(parseThinkingConfigValue(' OFF ')).toBe(false);
    expect(parseThinkingConfigValue(' false ')).toBe(false);
    expect(parseThinkingConfigValue('4000')).toBe(4000);
    expect(parseThinkingConfigValue(' 4000 ')).toBe(4000);
  });

  it('rejects invalid, non-positive, and unsafe budgets', () => {
    for (const value of ['0', '-1', '0.5', '1e3', '0x10', 'Infinity', 'abc', '9'.repeat(400), '9007199254740993']) {
      expect(parseThinkingConfigValue(value)).toBeUndefined();
    }
  });
});

describe('parseServeArgs', () => {
  it('detects valid serve command shapes without consuming prompt text', () => {
    expect(hasServeCommandRequest(['serve'])).toBe(true);
    expect(hasServeCommandRequest(['serve', '--port', '9000'])).toBe(true);
    expect(hasServeCommandRequest(['serve', '--port=9000'])).toBe(true);
    expect(hasServeCommandRequest(['serve', '--model=sonnet'])).toBe(true);
    expect(hasServeCommandRequest(['serve', '-m', 'sonnet'])).toBe(true);
    expect(hasServeCommandRequest(['serve', 'coffee'])).toBe(false);
    expect(hasServeCommandRequest(['serve', '--port', '9000', 'coffee'])).toBe(false);
    expect(hasServeCommandRequest(['serve', '--model=sonnet', 'coffee'])).toBe(false);
    expect(hasServeCommandRequest(['serve', '--', 'coffee'])).toBe(false);
    expect(hasServeCommandRequest(['serve', '--unknown'])).toBe(false);
    expect(hasServeCommandRequest(['serve', '-x'])).toBe(false);
  });

  it('can validate gateway run arguments before delegating to serve', () => {
    expect(hasServeCommandRequest(['serve', ...['--port', '9000', '--model', 'sonnet']])).toBe(true);
    expect(hasServeCommandRequest(['serve', ...['--port', '9000', 'coffee']])).toBe(false);
    expect(hasServeCommandRequest(['serve', ...['--unknown']])).toBe(false);
  });

  it('routes serve commands with missing split values to serve validation', () => {
    expect(hasServeCommandRequest(['serve', '--port'])).toBe(true);
    expect(hasServeCommandRequest(['serve', '--model'])).toBe(true);
    expect(hasServeCommandRequest(['serve', '-m'])).toBe(true);
    expect(hasServeCommandRequest(['serve', '--port', '--model', 'sonnet'])).toBe(true);
  });

  it('defaults serve port and accepts split value flags', () => {
    expect(parseServeArgs([])).toEqual({ port: 8787, model: undefined, portError: undefined });
    expect(parseServeArgs(['--port', '9000', '--model', 'openai:gpt-5.5'])).toEqual({
      port: 9000,
      model: 'openai:gpt-5.5',
      portError: undefined,
    });
    expect(parseServeArgs(['-m', 'sonnet'])).toEqual({ port: 8787, model: 'sonnet', portError: undefined });
  });

  it('accepts inline serve port and model values', () => {
    expect(parseServeArgs(['--port=9001', '--model=openai:gpt-5.5'])).toEqual({
      port: 9001,
      model: 'openai:gpt-5.5',
      portError: undefined,
    });
  });

  it('trims serve model values before loading config overrides', () => {
    expect(parseServeArgs(['--model', '  openai:gpt-5.5  '])).toMatchObject({
      model: 'openai:gpt-5.5',
      modelError: undefined,
    });
    expect(parseServeArgs(['--model=  sonnet  '])).toMatchObject({
      model: 'sonnet',
      modelError: undefined,
    });
  });

  it('rejects malformed or missing serve ports', () => {
    expect(parseServeArgs(['--port=0']).portError).toBe('0');
    expect(parseServeArgs(['--port=65536']).portError).toBe('65536');
    expect(parseServeArgs(['--port=1.5']).portError).toBe('1.5');
    expect(parseServeArgs(['--port=']).portError).toBe('ต้องระบุค่า');
    expect(parseServeArgs(['--port', '-1']).portError).toBe('-1');
    expect(parseServeArgs(['--port'])).toMatchObject({ portError: 'ต้องระบุค่า' });
    expect(parseServeArgs(['--port', '--model', 'sonnet'])).toMatchObject({
      model: 'sonnet',
      portError: 'ต้องระบุค่า',
    });
  });

  it('rejects missing serve model values instead of silently using the default model', () => {
    expect(parseServeArgs(['--model'])).toMatchObject({ model: undefined, modelError: 'ต้องระบุค่า' });
    expect(parseServeArgs(['-m', '--port', '9000'])).toMatchObject({
      port: 9000,
      model: undefined,
      modelError: 'ต้องระบุค่า',
    });
    expect(parseServeArgs(['--model='])).toMatchObject({ model: undefined, modelError: 'ต้องระบุค่า' });
    expect(parseServeArgs(['--model', 'openai:gpt-5.5'])).toMatchObject({
      model: 'openai:gpt-5.5',
      modelError: undefined,
    });
  });
});
