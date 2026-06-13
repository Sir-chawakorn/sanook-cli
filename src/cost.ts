// cost meter — ติดตาม token + ประเมินค่าใช้จ่าย real-time + budget cap
// pricing ต่อ 1M tokens (USD), ราคา ณ มิ.ย. 2026 — อัปเดตได้ที่นี่
export interface Pricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PRICING: Record<string, Pricing> = {
  'anthropic:claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'anthropic:claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'anthropic:claude-haiku-4-5-20251001': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

// usage ที่ AI SDK 6 คืน — inputTokens = TOTAL (รวม cacheRead + cacheWrite แล้ว),
// cachedInputTokens = cacheRead เท่านั้น (cacheWrite อยู่ใน providerMetadata แยก)
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export class CostMeter {
  private inTok = 0;
  private outTok = 0;
  private cacheReadTok = 0;
  private cacheWriteTok = 0;
  private spent = 0;

  constructor(
    private readonly specKey: string,
    private readonly budgetUsd?: number,
  ) {}

  /**
   * บวก usage ของ 1 step. cacheWriteTokens ดึงจาก providerMetadata แยก (default 0)
   * AI SDK 6: usage.inputTokens = total → ต้องหัก cacheRead/cacheWrite ออกก่อนคิดราคา input
   * ไม่งั้น double-count cacheRead (cache hit จะกลายเป็นแพงกว่า no-cache)
   */
  add(usage: Usage, cacheWriteTokens = 0): void {
    const totalInput = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    const cacheRead = usage.cachedInputTokens ?? 0;
    const noCacheInput = Math.max(0, totalInput - cacheRead - cacheWriteTokens);

    this.inTok += noCacheInput;
    this.outTok += output;
    this.cacheReadTok += cacheRead;
    this.cacheWriteTok += cacheWriteTokens;

    const p = PRICING[this.specKey];
    if (p) {
      this.spent +=
        (noCacheInput / 1e6) * p.input +
        (output / 1e6) * p.output +
        (cacheRead / 1e6) * p.cacheRead +
        (cacheWriteTokens / 1e6) * p.cacheWrite;
    }
  }

  get totalUsd(): number {
    return this.spent;
  }

  get hasPricing(): boolean {
    return this.specKey in PRICING;
  }

  /** true เมื่อใช้เกิน budget (เช็คก่อนยิง request ถัดไป) */
  get overBudget(): boolean {
    return this.budgetUsd != null && this.spent >= this.budgetUsd;
  }

  summary(): string {
    const total = this.inTok + this.outTok + this.cacheReadTok + this.cacheWriteTok;
    const cost = this.hasPricing ? `$${this.spent.toFixed(4)}` : '(ไม่มี pricing สำหรับ model นี้)';
    const budget = this.budgetUsd != null ? ` / budget $${this.budgetUsd}` : '';
    return `tokens: ${total} (in ${this.inTok} · out ${this.outTok} · cache-read ${this.cacheReadTok} · cache-write ${this.cacheWriteTok}) · cost ${cost}${budget}`;
  }
}
