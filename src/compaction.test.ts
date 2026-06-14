import { describe, it, expect } from 'vitest';
import { estimateTokens, autoCompact, truncateText } from './compaction.js';
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
});
