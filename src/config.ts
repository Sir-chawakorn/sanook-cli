import { z } from 'zod';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { appHomePath, appProjectPath, BRAND } from './brand.js';
import { projectRoot, projectTrustStatus } from './trust.js';
import { registerPricing, type Pricing } from './cost.js';

export const CONFIG_DIR = appHomePath();
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const AUTH_PATH = join(CONFIG_DIR, 'auth.json'); // API keys (chmod 0600)

export const PricingOverrideSchema = z.record(
  z.string(),
  z
    .object({
      input: z.number().finite().nonnegative().optional(),
      output: z.number().finite().nonnegative().optional(),
      cacheWrite: z.number().finite().nonnegative().optional(),
      cacheRead: z.number().finite().nonnegative().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'ต้องใส่ราคาอย่างน้อยหนึ่ง field'),
);

export type PricingOverride = Record<string, Partial<Pricing>>;

export const ConfigSchema = z.object({
  model: z.string().default('sonnet'),
  /** model สำรองเมื่อ model หลักล้ม (rate-limit/billing) — ตั้งด้วย sanook config set fallbackModel <spec> */
  fallbackModel: z.string().optional(),
  budgetUsd: z.number().positive().optional(),
  maxSteps: z.number().int().positive().default(20),
  // auto = รัน tool เลย (act-first) · ask = ขออนุมัติก่อน write/bash/commit
  permissionMode: z.enum(['auto', 'ask']).default('ask'),
  // path ของ second-brain workspace ที่ scaffold ไว้ (sanook brain) — optional
  brainPath: z.string().optional(),
  // pricing override/extension per "provider:model" → ทำให้ budget cap ใช้ได้กับ model ที่ยังไม่มีในตาราง
  pricing: PricingOverrideSchema.optional(),
  // ── token/cost tuning (ดู agentTuning) — .catch กันค่า config.json ผิดทำ boot พัง (agentTuning อ่าน raw + coerce เองด้วย) ──
  // prompt-cache TTL: '5m' (default, ephemeral) · '1h' (จ่าย write 2x แต่ cache อยู่ยาว — คุ้มเมื่อ session หยุดๆทำๆ)
  cacheTtl: z.enum(['5m', '1h']).catch('5m').default('5m'),
  // วิธีบีบ context ตอนยาว: 'truncate' (default, zero-LLM) · 'summarize' (ใช้ model ถูกย่อ — จำ context ได้ดีกว่า)
  compaction: z.enum(['truncate', 'summarize']).catch('truncate').default('truncate'),
  // extended thinking (Anthropic): false/ไม่ตั้ง = ปิด · true = budget default · number = budget tokens
  thinking: z.union([z.boolean(), z.number().int().positive()]).optional().catch(undefined),
  // model สำหรับย่อ (compaction=summarize) — ไม่ตั้ง = ใช้ fast-sibling ของ model หลัก (ค่ายเดียวกัน ถูกกว่า)
  summaryModel: z.string().optional().catch(undefined),
  // model สำหรับ semantic search embeddings (เช่น openai:text-embedding-3-small)
  embeddingModel: z.string().optional().catch(undefined),
});

export type Config = z.infer<typeof ConfigSchema>;

const DEFAULT_THINKING_BUDGET = 4096;

/** parse thinking config (config field หรือ env) → budget tokens (undefined = ปิด) */
function parseThinking(v: unknown): number | undefined {
  if (typeof v === 'number' && v > 0) return Math.floor(v);
  if (v === true) return DEFAULT_THINKING_BUDGET;
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return Number.parseInt(v, 10);
    if (['on', 'true', '1', 'yes'].includes(v.toLowerCase())) return DEFAULT_THINKING_BUDGET;
  }
  return undefined;
}

export interface AgentTuning {
  cacheTtl: '5m' | '1h';
  thinkingBudget?: number;
  compaction: 'truncate' | 'summarize';
  summaryModel?: string;
}

/**
 * อ่าน tuning knobs (cache TTL / thinking / compaction / summary model) จาก global config.json
 * + env override (SANOOK_CACHE_TTL / SANOOK_THINKING / SANOOK_COMPACTION / SANOOK_SUMMARY_MODEL).
 * อ่านตรงจาก config.json (เลี่ยง thread ผ่าน call stack ลึก) — เบา, เรียกครั้งเดียวต่อ turn.
 */
export async function agentTuning(): Promise<AgentTuning> {
  const raw = await readGlobalConfigRaw();
  const envTtl = process.env.SANOOK_CACHE_TTL;
  const cacheTtl: '5m' | '1h' = envTtl === '1h' || (envTtl !== '5m' && raw.cacheTtl === '1h') ? '1h' : '5m';
  const thinkingBudget = parseThinking(process.env.SANOOK_THINKING ?? raw.thinking);
  const compaction: 'truncate' | 'summarize' =
    (process.env.SANOOK_COMPACTION ?? raw.compaction) === 'summarize' ? 'summarize' : 'truncate';
  const summaryModel = process.env.SANOOK_SUMMARY_MODEL ?? (typeof raw.summaryModel === 'string' ? raw.summaryModel : undefined);
  return { cacheTtl, thinkingBudget, compaction, summaryModel };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {}; // ไม่มีไฟล์ / parse ไม่ได้ = ใช้ default
  }
}

function sanitizeUntrustedProjectConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const out = { ...cfg };
  delete out.permissionMode;
  return out;
}

/**
 * โหลด config แบบ layered: global (~/.sanook) < project (.sanook) < env < CLI overrides
 * merge raw ทุกชั้นก่อน แล้ว validate zod ทีเดียวที่ merged สุดท้าย
 * (config flat — shallow merge พอ; strip undefined ใน overrides กัน override ทับ default)
 */
export async function loadConfig(
  overrides: Record<string, unknown> = {},
  cwd: string = process.cwd(),
): Promise<Config> {
  const global = await readJson(CONFIG_PATH);
  const root = await projectRoot(cwd);
  const projectRaw = await readJson(appProjectPath(root, 'config.json'));
  const trust = await projectTrustStatus(root);
  const project = trust.trusted ? projectRaw : sanitizeUntrustedProjectConfig(projectRaw);
  const envConfig: Record<string, unknown> = {};
  if (process.env[BRAND.modelEnvVar]) envConfig.model = process.env[BRAND.modelEnvVar];

  const cleanOverrides: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) cleanOverrides[k] = v;
  }

  const merged = { ...global, ...project, ...envConfig, ...cleanOverrides };
  const config = ConfigSchema.parse(merged);
  // pricing override: config.pricing + env SANOOK_PRICING (JSON) → ลงทะเบียนเข้า cost table
  registerPricing(config.pricing);
  registerPricing(parseEnvPricing());
  return config;
}

/** env SANOOK_PRICING = JSON ของ { "provider:model": { input, output, ... } } */
function parseEnvPricing(): PricingOverride | undefined {
  const raw = process.env.SANOOK_PRICING;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const res = PricingOverrideSchema.safeParse(parsed);
    return res.success ? res.data : undefined;
  } catch {
    return undefined; // JSON ไม่ถูก = ข้าม (ไม่ทำให้ boot ล้ม)
  }
}

export function parsePricingOverride(raw: string): PricingOverride {
  return PricingOverrideSchema.parse(JSON.parse(raw));
}

/** ครั้งแรกที่รัน (ยังไม่มี global config) → ต้องทำ setup wizard */
export async function isFirstRun(): Promise<boolean> {
  try {
    await readFile(CONFIG_PATH, 'utf8');
    return false;
  } catch {
    return true;
  }
}

/** บันทึก global config (model/provider ที่เลือกตอน setup) */
export async function saveGlobalConfig(cfg: { model: string; provider?: string }): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const existing = await readJson(CONFIG_PATH);
  await writeFile(CONFIG_PATH, `${JSON.stringify({ ...existing, ...cfg }, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600).catch(() => {});
}

/** บันทึก path ของ second-brain workspace ลง global config (merge — ไม่ทับ field อื่น) */
export async function saveBrainPath(path: string): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const existing = await readJson(CONFIG_PATH);
  await writeFile(CONFIG_PATH, `${JSON.stringify({ ...existing, brainPath: path }, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600).catch(() => {});
}

/** อ่าน config.json ดิบ (ไม่ apply default/schema) — สำหรับ `sanook config` */
export async function readGlobalConfigRaw(): Promise<Record<string, unknown>> {
  return readJson(CONFIG_PATH);
}

/** merge patch ลง config.json (สำหรับ `sanook config set`) */
export async function patchGlobalConfig(patch: Record<string, unknown>): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const existing = await readJson(CONFIG_PATH);
  await writeFile(CONFIG_PATH, `${JSON.stringify({ ...existing, ...patch }, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600).catch(() => {});
}

/** บันทึก API key ลง ~/.sanook/auth.json (chmod 0600) + set env ทันทีสำหรับ session นี้ */
export async function saveKey(envVar: string, key: string): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  let auth: Record<string, string> = {};
  try {
    auth = JSON.parse(await readFile(AUTH_PATH, 'utf8')) as Record<string, string>;
  } catch {
    /* ยังไม่มีไฟล์ */
  }
  auth[envVar] = key;
  await writeFile(AUTH_PATH, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  await chmod(AUTH_PATH, 0o600); // เจ้าของอ่าน/เขียนเท่านั้น
  process.env[envVar] = key;
}

/** โหลด key จาก auth.json เข้า env ตอน boot (ไม่ override env ที่ตั้งไว้แล้ว) */
export async function loadKeysIntoEnv(): Promise<void> {
  try {
    const auth = JSON.parse(await readFile(AUTH_PATH, 'utf8')) as Record<string, unknown>;
    for (const [k, v] of Object.entries(auth)) {
      if (!process.env[k] && typeof v === 'string') process.env[k] = v;
    }
  } catch {
    /* ไม่มี auth.json = ข้าม */
  }
}
