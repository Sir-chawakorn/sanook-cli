import { describe, it, expect, afterEach } from 'vitest';
import { CostMeter, PRICING, SharedBudget, registerPricing } from './cost.js';
import { PROVIDERS } from './providers/registry.js';

describe('CostMeter budget cap', () => {
  afterEach(() => {
    for (const key of Object.keys(PRICING)) {
      if (key.startsWith('test:')) delete PRICING[key];
    }
  });

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

  it('ignores invalid usage counts so cost state stays finite', () => {
    registerPricing({ 'test:usage': { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 } });
    const m = new CostMeter('test:usage', 0.001);

    m.add({ inputTokens: Number.NaN, outputTokens: -10, cachedInputTokens: Number.POSITIVE_INFINITY }, Number.NEGATIVE_INFINITY);

    expect(m.totalUsd).toBe(0);
    expect(m.overBudget).toBe(false);
    expect(m.summary()).toBe('tokens: 0 (in 0 · out 0 · cache-read 0 · cache-write 0) · cost $0.0000 / budget $0.001');
  });

  it('shared budget ignores invalid direct additions', () => {
    const shared = new SharedBudget(0.001);

    shared.add(Number.NaN);
    shared.add(Number.POSITIVE_INFINITY);
    shared.add(-1);

    expect(shared.totalUsd).toBe(0);
    expect(shared.overBudget).toBe(false);
  });

  it('registerPricing ข้าม key ที่ไม่ใช่ provider:model', () => {
    registerPricing({
      'test-bad': { input: 1, output: 2 },
      'test:ok-key': { input: 1, output: 2 },
    });

    expect(new CostMeter('test-bad').hasPricing).toBe(false);
    expect(new CostMeter('test:ok-key').hasPricing).toBe(true);
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

  it('merge records transferred primary cost in a receiver shared budget once', () => {
    registerPricing({ 'test:merge': { input: 1, output: 0 } });
    const primary = new CostMeter('test:merge', 1);
    primary.add({ inputTokens: 1000, outputTokens: 0 });
    const shared = new SharedBudget(0.001);
    const fallback = new CostMeter('test:merge', 0.001, shared);

    fallback.merge(primary);

    expect(fallback.totalUsd).toBeCloseTo(0.001, 8);
    expect(shared.totalUsd).toBeCloseTo(0.001, 8);
    expect(fallback.overBudget).toBe(true);

    const alreadySharedPrimary = new CostMeter('test:merge', 0.001, shared);
    alreadySharedPrimary.add({ inputTokens: 1000, outputTokens: 0 });
    const beforeMerge = shared.totalUsd;
    fallback.merge(alreadySharedPrimary);
    expect(shared.totalUsd).toBeCloseTo(beforeMerge, 8);
  });

  it('shared budget caps a whole agent tree, not each subagent independently', () => {
    registerPricing({ 'test:shared': { input: 1, output: 0 } });
    const shared = new SharedBudget(0.0015);
    const a = new CostMeter('test:shared', 0.0015, shared);
    const b = new CostMeter('test:shared', 0.0015, shared);

    a.add({ inputTokens: 1000, outputTokens: 0 }); // $0.001, below cap alone
    expect(a.overBudget).toBe(false);
    expect(b.overBudget).toBe(false);

    b.add({ inputTokens: 1000, outputTokens: 0 }); // shared total $0.002
    expect(shared.overBudget).toBe(true);
    expect(a.overBudget).toBe(true);
    expect(b.overBudget).toBe(true);
  });

  it('shared budget stops unpriced siblings once priced work spent the cap', () => {
    const shared = new SharedBudget(0.001);
    const priced = new CostMeter('anthropic:claude-haiku-4-5', 0.001, shared);
    const unpriced = new CostMeter('missing:model', 0.001, shared);

    priced.add({ inputTokens: 1000, outputTokens: 0 }); // $0.001
    expect(shared.overBudget).toBe(true);
    expect(unpriced.hasPricing).toBe(false);
    expect(unpriced.overBudget).toBe(true);
  });
});
