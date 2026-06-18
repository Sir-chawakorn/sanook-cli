// cost meter — ติดตาม token + ประเมินค่าใช้จ่าย real-time + budget cap
// pricing ต่อ 1M tokens (USD) — อัปเดตได้ที่นี่ หรือ override ด้วย config `pricing` (sanook config)
export interface Pricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// key = specKey() = "<provider>:<model id>" — ต้องตรงกับ id ใน registry (มี test กัน drift)
// Anthropic = ราคา verified (มิ.ย. 2026). ที่เหลือ = published list price โดยประมาณ — override ได้
export const PRICING: Record<string, Pricing> = {
  // ── Anthropic (verified) ────────────────────────────────────────────────
  'anthropic:claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'anthropic:claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'anthropic:claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'anthropic:claude-fable-5': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },

  // ── ราคาประมาณ (published list price ต่อ 1M tokens) — อาจคลาดเคลื่อน, override ได้ด้วย
  //    `sanook config set pricing '{"openai:gpt-5.5":{"input":1.25,...}}'` หรือ env SANOOK_PRICING
  // OpenAI
  'openai:gpt-5.5': { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 },
  'openai:gpt-5.4-mini': { input: 0.25, output: 2, cacheWrite: 0.25, cacheRead: 0.025 },
  'openai:gpt-5.3-codex': { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 },
  // Google Gemini (≤200k context tier)
  'google:gemini-2.5-pro': { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.31 },
  'google:gemini-2.5-flash': { input: 0.3, output: 2.5, cacheWrite: 0.3, cacheRead: 0.075 },

  // xAI Grok
  'xai:grok-4.3': { input: 3, output: 15, cacheWrite: 3, cacheRead: 0.75 },
  // Mistral
  'mistral:mistral-large-latest': { input: 2, output: 6, cacheWrite: 2, cacheRead: 0.2 },
  'mistral:mistral-small-latest': { input: 0.2, output: 0.6, cacheWrite: 0.2, cacheRead: 0.02 },
  // Groq
  'groq:llama-3.3-70b-versatile': { input: 0.59, output: 0.79, cacheWrite: 0.59, cacheRead: 0.059 },
};

/** true ถ้ามี pricing สำหรับ specKey นี้ (ใช้เตือนตอน budget cap ตั้งไว้แต่คิดเงินไม่ได้) */
export function hasPricingForKey(specKey: string): boolean {
  return specKey in PRICING;
}

function isPricingKey(key: string): boolean {
  return /^[^:\s]+:\S+$/.test(key);
}

/**
 * merge pricing เพิ่ม/override (จาก config `pricing` หรือ env SANOOK_PRICING)
 * — ให้ budget cap ใช้ได้กับ provider ที่ยังไม่มีในตาราง โดยไม่ต้องแก้โค้ด
 */
export function registerPricing(extra: Record<string, Partial<Pricing>> | undefined): void {
  if (!extra) return;
  for (const [key, p] of Object.entries(extra)) {
    if (!isPricingKey(key)) continue;
    if (p == null || typeof p !== 'object') continue;
    const base = PRICING[key] ?? { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    const inputRate = Number(p.input ?? base.input);
    const next = {
      input: inputRate,
      output: Number(p.output ?? base.output),
      // override ที่ใส่แค่ input/output (ตามที่ hint แนะนำ) → cache rate อนุมานจาก input แทน 0 (กัน undercount)
      cacheWrite: Number(p.cacheWrite ?? p.input ?? base.cacheWrite),
      cacheRead: Number(p.cacheRead ?? (base.cacheRead || inputRate * 0.1)),
    };
    if (Object.values(next).some((n) => !Number.isFinite(n) || n < 0)) continue;
    PRICING[key] = next;
  }
}

// usage ที่ AI SDK 6 คืน — inputTokens = TOTAL (รวม cacheRead + cacheWrite แล้ว),
// cachedInputTokens = cacheRead เท่านั้น (cacheWrite อยู่ใน providerMetadata แยก)
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

function safeTokenCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return value;
}

export class SharedBudget {
  private spent = 0;

  constructor(private readonly budgetUsd?: number) {}

  add(usd: number): void {
    if (Number.isFinite(usd) && usd > 0) this.spent += usd;
  }

  get totalUsd(): number {
    return this.spent;
  }

  get overBudget(): boolean {
    return this.budgetUsd != null && this.spent >= this.budgetUsd;
  }
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
    private readonly sharedBudget?: SharedBudget,
  ) {}

  /**
   * บวก usage ของ 1 step. cacheWriteTokens ดึงจาก providerMetadata แยก (default 0)
   * AI SDK 6: usage.inputTokens = total → ต้องหัก cacheRead/cacheWrite ออกก่อนคิดราคา input
   * ไม่งั้น double-count cacheRead (cache hit จะกลายเป็นแพงกว่า no-cache)
   */
  add(usage: Usage, cacheWriteTokens = 0): void {
    const totalInput = safeTokenCount(usage.inputTokens);
    const output = safeTokenCount(usage.outputTokens);
    const cacheRead = safeTokenCount(usage.cachedInputTokens);
    const cacheWrite = safeTokenCount(cacheWriteTokens);
    const noCacheInput = Math.max(0, totalInput - cacheRead - cacheWrite);

    this.inTok += noCacheInput;
    this.outTok += output;
    this.cacheReadTok += cacheRead;
    this.cacheWriteTok += cacheWrite;

    const p = PRICING[this.specKey];
    if (p) {
      const delta =
        (noCacheInput / 1e6) * p.input +
        (output / 1e6) * p.output +
        (cacheRead / 1e6) * p.cacheRead +
        (cacheWrite / 1e6) * p.cacheWrite;
      this.spent += delta;
      this.sharedBudget?.add(delta);
    }
  }

  /** รวม token + cost จาก meter อีกตัว (เช่น primary model ก่อน fallback) — กัน usage หาย/budget reset */
  merge(other: CostMeter): void {
    this.inTok += other.inTok;
    this.outTok += other.outTok;
    this.cacheReadTok += other.cacheReadTok;
    this.cacheWriteTok += other.cacheWriteTok;
    this.spent += other.spent;
    if (this.sharedBudget && this.sharedBudget !== other.sharedBudget) this.sharedBudget.add(other.spent);
  }

  get totalUsd(): number {
    return this.spent;
  }

  get hasPricing(): boolean {
    return this.specKey in PRICING;
  }

  /** true เมื่อใช้เกิน budget (เช็คก่อนยิง request ถัดไป) — no-op ถ้าไม่มี pricing (เตือนที่ entry point) */
  get overBudget(): boolean {
    if (this.sharedBudget?.overBudget) return true;
    if (!this.hasPricing) return false;
    return this.budgetUsd != null && this.spent >= this.budgetUsd;
  }

  summary(): string {
    const total = this.inTok + this.outTok + this.cacheReadTok + this.cacheWriteTok;
    const cost = this.hasPricing ? `$${this.spent.toFixed(4)}` : '(ไม่มี pricing สำหรับ model นี้)';
    const budget = this.budgetUsd != null ? ` / budget $${this.budgetUsd}` : '';
    return `tokens: ${total} (in ${this.inTok} · out ${this.outTok} · cache-read ${this.cacheReadTok} · cache-write ${this.cacheWriteTok}) · cost ${cost}${budget}`;
  }
}
