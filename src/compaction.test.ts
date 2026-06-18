import { describe, it, expect } from 'vitest';
import { estimateTokens, autoCompact, truncateText, summarizeCompact, messagesToText, selectivelyCompressStaleToolResults } from './compaction.js';
import type { ModelMessage } from 'ai';

describe('estimateTokens', () => {
  it('นับจาก chars/4', () => {
    expect(estimateTokens([{ role: 'user', content: 'a'.repeat(400) }])).toBe(100);
  });
});

describe('truncateText', () => {
  it('ข้อความสั้น → คงเดิม', () => {
    expect(truncateText('short')).toBe('short');
  });
  it('ข้อความยาว → ตัดกลาง เก็บหัว+ท้าย', () => {
    const out = truncateText('A'.repeat(2000));
    expect(out).toContain('pruned');
    expect(out.length).toBeLessThan(2000);
  });
});

describe('autoCompact', () => {
  it('ไม่เกิน limit → คืน ref เดิม (no-op)', () => {
    const msgs: ModelMessage[] = [{ role: 'user', content: 'hi' }];
    expect(autoCompact(msgs, 1000)).toBe(msgs);
  });

  it('เกิน limit → sliding window (user แรก + recent + marker)', () => {
    const msgs: ModelMessage[] = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: 'x'.repeat(4000),
    }));
    const out = autoCompact(msgs, 10_000, 10);
    expect(out.length).toBeLessThan(msgs.length);
    expect(out.some((m) => typeof m.content === 'string' && m.content.includes('ถูกตัด'))).toBe(true);
  });

  it('เก็บ system preamble ที่นำหน้าไว้เสมอ', () => {
    const system: ModelMessage[] = [
      { role: 'system', content: 'SYSTEM A' },
      { role: 'system', content: 'SYSTEM B' },
    ];
    const body: ModelMessage[] = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: 'x'.repeat(4000),
    }));
    const out = autoCompact([...system, ...body], 10_000, 10);
    expect(out[0]).toBe(system[0]);
    expect(out[1]).toBe(system[1]);
    expect(out.some((m) => typeof m.content === 'string' && m.content.includes('ถูกตัด'))).toBe(true);
  });
});

describe('selectivelyCompressStaleToolResults', () => {
  function toolText(message: ModelMessage): string {
    const part = Array.isArray(message.content) ? (message.content[0] as any) : undefined;
    return part?.output?.value ?? '';
  }

  it('compresses old huge tool output but keeps the recent tail unchanged', () => {
    const oldOutput = [
      'read_file src/app.ts',
      ...Array.from({ length: 120 }, (_, i) => `debug noise ${i} ${'x'.repeat(80)}`),
      'src/app.ts:99 ERROR important failure',
      ...Array.from({ length: 120 }, (_, i) => `more noise ${i} ${'y'.repeat(80)}`),
    ].join('\n');
    const recentOutput = `${oldOutput}\nrecent tail must stay full`;
    const msgs: ModelMessage[] = [
      { role: 'user', content: 'inspect' },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'old', toolName: 'read_file', output: { type: 'text', value: oldOutput } }] as never,
      },
      { role: 'assistant', content: 'ok' },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'recent', toolName: 'read_file', output: { type: 'text', value: recentOutput } }] as never,
      },
    ];

    const out = selectivelyCompressStaleToolResults(msgs, 2, 2_000, 1_000);
    expect(out).not.toBe(msgs);
    expect(JSON.stringify(out[1])).toContain('important failure');
    expect(JSON.stringify(out[1]).length).toBeLessThan(JSON.stringify(msgs[1]).length / 2);
    expect(out[3]).toBe(msgs[3]);
  });

  it('returns the same reference when no stale tool output is large enough', () => {
    const msgs: ModelMessage[] = [
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'x', toolName: 'grep', output: { type: 'text', value: 'short' } }] as never,
      },
    ];
    expect(selectivelyCompressStaleToolResults(msgs, 0)).toBe(msgs);
  });

  it('uses a tighter budget for older stale tool outputs', () => {
    const large = (label: string): string =>
      [
        `${label} start`,
        ...Array.from({ length: 220 }, (_, i) => `${label} log ${i} ${'x'.repeat(90)}`),
        `${label} ERROR preserve me`,
        ...Array.from({ length: 220 }, (_, i) => `${label} tail ${i} ${'y'.repeat(90)}`),
      ].join('\n');
    const msgs: ModelMessage[] = ['oldest', 'middle', 'newest'].map((label) => ({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: label, toolName: 'run_bash', output: { type: 'text', value: large(label) } }] as never,
    }));

    const out = selectivelyCompressStaleToolResults(msgs, 0, 6_000, 1_000);
    expect(toolText(out[0]).length).toBeLessThan(toolText(out[2]).length);
    expect(toolText(out[0])).toContain('oldest ERROR preserve me');
    expect(toolText(out[2])).toContain('newest ERROR preserve me');
  });
});

describe('messagesToText', () => {
  it('flattens user/assistant/tool into a transcript', () => {
    const t = messagesToText([
      { role: 'user', content: 'do X' },
      { role: 'assistant', content: [{ type: 'text', text: 'okay' }, { type: 'tool-call', toolName: 'read_file', toolCallId: 'c', input: {} }] as never },
      { role: 'tool', content: [{ type: 'tool-result', toolName: 'read_file', toolCallId: 'c', output: { type: 'text', value: 'file body' } }] as never },
    ]);
    expect(t).toContain('user: do X');
    expect(t).toContain('assistant: okay');
    expect(t).toContain('[call read_file]');
    expect(t).toContain('tool: file body');
  });
});

describe('summarizeCompact', () => {
  const longConvo = (): ModelMessage[] => {
    const m: ModelMessage[] = [{ role: 'system', content: 'SYSTEM PREAMBLE' }];
    m.push({ role: 'user', content: 'INTENT: build the feature' });
    for (let i = 0; i < 10; i++) {
      m.push({ role: 'assistant', content: `middle assistant ${i} ${'x'.repeat(80)}` });
      m.push({ role: 'user', content: `middle followup ${i} ${'y'.repeat(80)}` });
    }
    m.push({ role: 'user', content: 'recent one' });
    m.push({ role: 'assistant', content: 'recent two' });
    m.push({ role: 'user', content: 'recent three' });
    return m;
  };

  it('replaces the middle with a model summary, keeps system + intent + recent tail', async () => {
    const fake = async (transcript: string): Promise<string> => `SUMMARY of ${transcript.length} chars`;
    const out = await summarizeCompact(longConvo(), 100, fake, 3);
    expect(out[0]).toMatchObject({ role: 'system' }); // lead preserved
    expect(JSON.stringify(out)).toContain('INTENT: build the feature'); // first user intent kept
    expect(JSON.stringify(out)).toContain('SUMMARY of'); // middle summarized
    expect(JSON.stringify(out)).toContain('recent three'); // recent tail kept
    expect(out.length).toBeLessThan(longConvo().length); // genuinely compacted
    expect(estimateTokens(out)).toBeLessThan(estimateTokens(longConvo()));
  });

  it('falls back to truncation when the summarizer throws (never blocks the turn)', async () => {
    const boom = async (): Promise<string> => {
      throw new Error('no key');
    };
    const out = await summarizeCompact(longConvo(), 100, boom, 3);
    expect(JSON.stringify(out)).not.toContain('SUMMARY');
    expect(JSON.stringify(out)).toContain('ถูกตัดออก'); // autoCompact marker
  });

  it('under the limit → returns the messages unchanged', async () => {
    const small: ModelMessage[] = [{ role: 'user', content: 'hi' }];
    const out = await summarizeCompact(small, 100_000, async () => 'unused', 3);
    expect(out).toBe(small);
  });
});
