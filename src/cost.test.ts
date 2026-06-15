import { describe, it, expect } from 'vitest';
import { CostMeter, PRICING, registerPricing } from './cost.js';
import { PROVIDERS } from './providers/registry.js';

describe('CostMeter budget cap', () => {
  it('haiku (default fast alias) มี pricing → budget cap ทำงานจริง', () => {
    const m = new CostMeter('anthropic:claude-haiku-4-5', 0.001);
    expect(m.hasPricing).toBe(true);
    expect(m.overBudget).toBe(false);
    m.add({ inputTokens: 1_000_000, outputTokens: 0 }); // $1 input > $0.001 budget
    expect(m.overBudget).toBe(true);
  });

  it('ทุก anthropic curated model id มี PRICING key (กัน drift)', () => {
    for (const id of new Set(Object.values(PROVIDERS.anthropic.models))) {
      expect(PRICING, `ขาด pricing: anthropic:${id}`).toHaveProperty(`anthropic:${id}`);
    }
  });

  it('cacheRead ไม่ถูก double-count (cache hit ต้องถูกกว่า no-cache)', () => {
    const m = new CostMeter('anthropic:claude-sonnet-4-6');
    m.add({ inputTokens: 1000, cachedInputTokens: 1000, outputTokens: 0 });
    expect(m.totalUsd).toBeCloseTo((1000 / 1e6) * 0.3, 8); // cacheRead rate เท่านั้น
  });

  it('registerPricing ข้ามค่าที่ไม่ finite/ติดลบ เพื่อกัน cost NaN', () => {
    registerPricing({ 'test:bad': { input: Number.NaN, output: 1 } });
    const m = new CostMeter('test:bad');
    m.add({ inputTokens: 1000, outputTokens: 1000 });
    expect(m.hasPricing).toBe(false);
    expect(m.summary()).not.toContain('NaN');

    registerPricing({ 'test:ok': { input: 1, output: 2 } });
    expect(new CostMeter('test:ok').hasPricing).toBe(true);
  });

  it('override ที่ใส่แค่ input/output → cacheRead อนุมานจาก input ไม่ใช่ 0 (กัน undercount)', () => {
    registerPricing({ 'test:cacheonly': { input: 10, output: 30 } });
    const m = new CostMeter('test:cacheonly');
    m.add({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 }); // ทั้งหมดเป็น cacheRead
    expect(m.totalUsd).toBeGreaterThan(0); // ก่อนแก้ = 0 (cacheRead ราคา 0)
    expect(m.totalUsd).toBeCloseTo((1_000_000 / 1e6) * (10 * 0.1), 6); // ~0.1x input
  });

  it('merge รวม token + cost ของ primary เข้า fallback meter (กัน cost หายตอน fallback)', () => {
    const primary = new CostMeter('anthropic:claude-opus-4-8', 1);
    primary.add({ inputTokens: 1000, outputTokens: 1000 });
    const beforeSpent = primary.totalUsd;
    expect(beforeSpent).toBeGreaterThan(0);

    const fallback = new CostMeter('anthropic:claude-haiku-4-5', 1);
    fallback.merge(primary);
    expect(fallback.totalUsd).toBeCloseTo(beforeSpent, 8); // primary cost ไม่หาย
    expect(fallback.summary()).toContain('in 1000'); // token นับรวม
  });
});
