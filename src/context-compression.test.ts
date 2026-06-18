import { describe, expect, it } from 'vitest';
import { selectiveCompressText } from './context-compression.js';

describe('selectiveCompressText', () => {
  it('keeps short text unchanged', () => {
    const input = 'short context';
    expect(selectiveCompressText(input).text).toBe(input);
    expect(selectiveCompressText(input).changed).toBe(false);
  });

  it('shrinks long logs while preserving important error and path lines', () => {
    const noise = Array.from({ length: 160 }, (_, i) => `debug heartbeat ${i} ${'x'.repeat(80)}`).join('\n');
    const input = [
      'COMMAND npm test',
      noise,
      'src/loop.ts:42 ERROR timeout while calling model',
      'Traceback: useful stack line',
      noise,
      'FINAL status failed',
    ].join('\n');

    const out = selectiveCompressText(input, { targetChars: 2_000, minChars: 1_000 });
    expect(out.changed).toBe(true);
    expect(out.text.length).toBeLessThan(input.length / 2);
    expect(out.text).toContain('src/loop.ts:42 ERROR timeout');
    expect(out.text).toContain('Traceback');
    expect(out.text).toContain('selective context compression');
  });

  it('preserves code and diff structure better than random repeated lines', () => {
    const input = [
      'header',
      ...Array.from({ length: 100 }, (_, i) => `same repeated boilerplate ${i % 5}`),
      'diff --git a/src/app.ts b/src/app.ts',
      '@@ -1,3 +1,4 @@',
      '+export function compactContext() { return true; }',
      'interface ImportantShape { ok: boolean }',
      ...Array.from({ length: 100 }, (_, i) => `more repeated boilerplate ${i % 7}`),
      'tail',
    ].join('\n');

    const out = selectiveCompressText(input, { targetChars: 1_800, minChars: 800 });
    expect(out.changed).toBe(true);
    expect(out.text).toContain('diff --git');
    expect(out.text).toContain('compactContext');
    expect(out.text).toContain('ImportantShape');
  });

  it('uses the current query to preserve relevant plain-text lines', () => {
    const input = [
      'start',
      ...Array.from({ length: 90 }, (_, i) => `ERROR unrelated failure ${i} src/unrelated-${i}.ts`),
      'plain business rule about invoiceReconciliationWindow and retention',
      ...Array.from({ length: 90 }, (_, i) => `WARNING unrelated warning ${i} src/noise-${i}.ts`),
      'end',
    ].join('\n');

    const out = selectiveCompressText(input, {
      targetChars: 1_400,
      minChars: 500,
      query: 'optimize invoiceReconciliationWindow handling',
    });
    expect(out.changed).toBe(true);
    expect(out.text).toContain('invoiceReconciliationWindow');
  });
});
