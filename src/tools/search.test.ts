import { describe, expect, it } from 'vitest';
import { formatRipgrepOutput } from './search.js';

describe('ripgrep output formatting', () => {
  it('does not report truncation when output is exactly at the result cap', () => {
    const stdout = `${Array.from({ length: 200 }, (_v, i) => `file.ts:${i + 1}:needle`).join('\n')}\n`;

    const lines = formatRipgrepOutput(stdout).split('\n');

    expect(lines).toHaveLength(200);
    expect(lines.at(-1)).toBe('file.ts:200:needle');
    expect(lines.some((line) => line.includes('truncated'))).toBe(false);
  });

  it('reports truncation when output exceeds the result cap', () => {
    const stdout = `${Array.from({ length: 201 }, (_v, i) => `file.ts:${i + 1}:needle`).join('\n')}\n`;

    const lines = formatRipgrepOutput(stdout).split('\n');

    expect(lines).toHaveLength(201);
    expect(lines.at(199)).toBe('file.ts:200:needle');
    expect(lines.at(-1)).toBe('... [>200 matches, truncated]');
  });

  it('normalizes CRLF line separators', () => {
    expect(formatRipgrepOutput('file.ts:1:needle\r\nfile.ts:2:needle\r\n')).toBe('file.ts:1:needle\nfile.ts:2:needle');
  });
});
