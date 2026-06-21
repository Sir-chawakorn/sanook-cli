import { z } from 'zod';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { appHomePath, appProjectPath, BRAND, defaultBrainPath, pathIsDir } from './brand.js';
import { projectRoot, projectTrustStatus } from './trust.js';
import { registerPricing, type Pricing } from './cost.js';
import { migrateDeprecatedCodexModel } from './providers/codex.js';

export function configHomeDir(): string {
  return appHomePath();
}

function authPath(): string {
  return join(configHomeDir(), 'auth.json');
}
const AUTH_ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_AUTH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const PricingKeySchema = z.string().regex(/^[^:\s]+:\S+$/, 'key ต้องเป็น provider:model');

export const PricingOverrideSchema = z.record(
  PricingKeySchema,
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
  // เก็บบทสนทนาเต็ม (prompt + คำตอบ AI ทุก turn) ลง vault Sessions/*-chat.md — opt-in (vault โตไว)
  brainTranscript: z.boolean().optional().catch(undefined),
  // auto-maintenance: consolidate memory+vault อัตโนมัติ (รายสัปดาห์ตอน startup) + distill session → memory.
  // default on (undefined = on); ตั้ง false เพื่อปิด หรือ env SANOOK_DISABLE_AUTO_MAINTAIN=1
  autoMaintain: z.boolean().optional().catch(undefined),
  // pricing override/extension per "provider:model" → ทำให้ budget cap ใช้ได้กับ model ที่ยังไม่มีในตาราง
  pricing: PricingOverrideSchema.optional(),
  // ── token/cost tuning (ดู agentTuning) — .catch กันค่า config.json ผิดทำ boot พัง (agentTuning อ่าน raw + coerce เองด้วย) ──
  // prompt-cache TTL: '5m' (default, ephemeral) · '1h' (จ่าย write 2x แต่ cache อยู่ยาว — คุ้มเมื่อ session หยุดๆทำๆ)
  cacheTtl: z.enum(['5m', '1h']).catch('5m').default('5m'),
  // วิธีบีบ context ตอนยาว: 'truncate' (default, zero-LLM) · 'summarize' (ใช้ model ถูกย่อ — จำ context ได้ดีกว่า)
  compaction: z.enum(['truncate', 'summarize']).catch('truncate').default('truncate'),
  // token reducer: off, local zero-LLM selective compressor, or optional Headroom proxy adapter.
  contextCompression: z.enum(['off', 'selective', 'headroom']).catch('selective').default('selective'),
  // extended thinking (Anthropic): false/ไม่ตั้ง = ปิด · true = budget default · number = budget tokens
  thinking: z.union([z.boolean(), z.number().int().positive()]).optional().catch(undefined),
  // model สำหรับย่อ (compaction=summarize) — ไม่ตั้ง = ใช้ fast-sibling ของ model หลัก (ค่ายเดียวกัน ถูกกว่า)
  summaryModel: z.string().optional().catch(undefined),
  // model สำหรับ semantic search embeddings (เช่น openai:text-embedding-3-small)
  embeddingModel: z.string().optional().catch(undefined),
  // Hermes-style /personality overlay (stored as a small named prompt)
  personality: z.string().optional().catch(undefined),
  /** UI + setup wizard language */
  locale: z.enum(['en', 'th']).catch('th').default('th'),
});

export type Config = z.infer<typeof ConfigSchema>;

const DEFAULT_THINKING_BUDGET = 4096;

function normalizeThinkingBudget(value: number): number | undefined {
  const budget = Math.floor(value);
  return Number.isSafeInteger(budget) && budget > 0 ? budget : undefined;
}

/** parse thinking config (config field หรือ env) → budget tokens (undefined = ปิด) */
function parseThinking(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return normalizeThinkingBudget(v);
  if (v === true) return DEFAULT_THINKING_BUDGET;
  if (typeof v === 'string') {
    const clean = v.trim();
    if (/^\d+$/.test(clean)) return normalizeThinkingBudget(Number(clean));
    if (['on', 'true', '1', 'yes'].includes(clean.toLowerCase())) return DEFAULT_THINKING_BUDGET;
  }
  return undefined;
}

function trimmedString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const clean = v.trim();
  return clean ? clean : undefined;
}

function parseCacheTtl(v: unknown): '5m' | '1h' | undefined {
  const clean = trimmedString(v);
  return clean === '5m' || clean === '1h' ? clean : undefined;
}

function parseCompaction(v: unknown): 'truncate' | 'summarize' | undefined {
  const clean = trimmedString(v);
  return clean === 'truncate' || clean === 'summarize' ? clean : undefined;
}

function parseContextCompression(v: unknown): 'off' | 'selective' | 'headroom' | undefined {
  const clean = trimmedString(v);
  return clean === 'off' || clean === 'selective' || clean === 'headroom' ? clean : undefined;
}

export interface AgentTuning {
  cacheTtl: '5m' | '1h';
  thinkingBudget?: number;
  compaction: 'truncate' | 'summarize';
  contextCompression: 'off' | 'selective' | 'headroom';
  summaryModel?: string;
}

/**
 * อ่าน tuning knobs (cache TTL / thinking / compaction / summary model) จาก global config.json
 * + env override (SANOOK_CACHE_TTL / SANOOK_THINKING / SANOOK_COMPACTION / SANOOK_CONTEXT_COMPRESSION / SANOOK_SUMMARY_MODEL).
 * อ่านตรงจาก config.json (เลี่ยง thread ผ่าน call stack ลึก) — เบา, เรียกครั้งเดียวต่อ turn.
 */
export async function agentTuning(): Promise<AgentTuning> {
  const raw = await readGlobalConfigRaw();
  const cacheTtl = parseCacheTtl(process.env.SANOOK_CACHE_TTL) ?? parseCacheTtl(raw.cacheTtl) ?? '5m';
  const thinkingBudget = parseThinking(trimmedString(process.env.SANOOK_THINKING) ?? raw.thinking);
  const compaction = parseCompaction(process.env.SANOOK_COMPACTION) ?? parseCompaction(raw.compaction) ?? 'truncate';
  const contextCompression = parseContextCompression(process.env.SANOOK_CONTEXT_COMPRESSION) ?? parseContextCompression(raw.contextCompression) ?? 'selective';
  const summaryModel = trimmedString(process.env.SANOOK_SUMMARY_MODEL) ?? trimmedString(raw.summaryModel);
  return { cacheTtl, thinkingBudget, compaction, contextCompression, summaryModel };
}

const warnedBadConfigKeys = new Set<string>();

function globalConfigPath(): string {
  return join(configHomeDir(), 'config.json');
}

/**
 * Validate the merged config, but degrade gracefully: a malformed strict field (bad model/maxSteps/
 * permissionMode/budgetUsd/pricing in a hand-edited config.json) is dropped to its default with a
 * one-time stderr warning instead of throwing and crashing boot. Security-sensitive fields drop to
 * the SAFE default (budgetUsd→no cap is still surfaced by the warning; pricing→none).
 */
function parseConfigGraceful(merged: Record<string, unknown>): Config {
  const first = ConfigSchema.safeParse(merged);
  if (first.success) return first.data;
  const badKeys = [...new Set(first.error.issues.map((i) => String(i.path[0])).filter(Boolean))];
  const cleaned = { ...merged };
  for (const k of badKeys) delete cleaned[k];
  const fresh = badKeys.filter((k) => !warnedBadConfigKeys.has(k));
  if (fresh.length) {
    fresh.forEach((k) => warnedBadConfigKeys.add(k));
    process.stderr.write(`${BRAND.cliName}: ⚠ ละเลย config ที่ค่าผิด (ใช้ค่า default แทน): ${fresh.join(', ')}\n`);
  }
  const second = ConfigSchema.safeParse(cleaned);
  return second.success ? second.data : ConfigSchema.parse({});
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {}; // ไม่มีไฟล์ / parse ไม่ได้ = ใช้ default
  }
}

// key ที่ untrusted project ตั้งไม่ได้ (ต้อง `sanook trust` ก่อน):
//  - permissionMode: auto = auto-approve mutation (รัน bash/แก้ไฟล์ไม่ถาม) — อันตรายสุด
//  - budgetUsd: repo อันตรายตั้งสูงๆ = ปิด spend cap ของ user (เปลืองเงินจริง)
//  - pricing: ตั้งราคาปลอม = ทำให้ budget cap ไม่ trigger (ซ่อน cost / bypass cap)
// (model/maxSteps/embeddingModel ฯลฯ ปล่อยได้ — เป็น preference ที่ user เห็น/override ได้ และตอนนี้ถูกคุมด้วย budget จริงของ user)
const UNTRUSTED_PROJECT_DENY = new Set(['permissionMode', 'budgetUsd', 'pricing']);
function sanitizeUntrustedProjectConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (!UNTRUSTED_PROJECT_DENY.has(k)) out[k] = v;
  }
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
  const global = await readJson(globalConfigPath());
  const root = await projectRoot(cwd);
  const projectRaw = await readJson(appProjectPath(root, 'config.json'));
  const trust = await projectTrustStatus(root);
  const project = trust.trusted ? projectRaw : sanitizeUntrustedProjectConfig(projectRaw);
  const envConfig: Record<string, unknown> = {};
  const envModel = trimmedString(process.env[BRAND.modelEnvVar]);
  if (envModel) envConfig.model = envModel;

  const cleanOverrides: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) cleanOverrides[k] = v;
  }

  const merged = { ...global, ...project, ...envConfig, ...cleanOverrides };
  const config = parseConfigGraceful(merged);
  // ไม่ได้ตั้ง brainPath ที่ชั้นไหนเลย → auto-link Second Brain default ถ้าโฟลเดอร์มีอยู่จริง
  // (virtual เท่านั้น — ไม่ persist ลง disk; saveBrainPath/saveGlobalConfig อ่าน raw file ไม่ใช่ค่านี้)
  if (!config.brainPath?.trim()) {
    const fallback = defaultBrainPath();
    if (await pathIsDir(fallback)) config.brainPath = fallback;
  }
  const migratedModel = migrateDeprecatedCodexModel(config.model);
  if (migratedModel !== config.model) {
    config.model = migratedModel;
    void saveGlobalConfig({ model: migratedModel }).catch(() => {});
  }
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
    return parsePricingOverride(raw);
  } catch {
    return undefined; // JSON ไม่ถูก = ข้าม (ไม่ทำให้ boot ล้ม)
  }
}

export function parsePricingOverride(raw: string): PricingOverride {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('pricing JSON parse ไม่สำเร็จ');
  }

  const res = PricingOverrideSchema.safeParse(parsed);
  if (!res.success) {
    const details = res.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.length ? issue.path.join('.') : 'pricing'}: ${issue.message}`)
      .join('; ');
    throw new Error(`pricing schema ไม่ถูกต้อง${details ? ` — ${details}` : ''}`);
  }
  return res.data;
}

/** ครั้งแรกที่รัน (ยังไม่มี global config) → ต้องทำ setup wizard */
export async function isFirstRun(): Promise<boolean> {
  try {
    await readFile(globalConfigPath(), 'utf8');
    return false;
  } catch {
    return true;
  }
}

/** บันทึก global config (model/provider/locale ที่เลือกตอน setup) */
export async function saveGlobalConfig(
  cfg: { model?: string; provider?: string; locale?: string } & Record<string, unknown>,
): Promise<void> {
  await mkdir(configHomeDir(), { recursive: true });
  const existing = await readJson(globalConfigPath());
  await writeFile(globalConfigPath(), `${JSON.stringify({ ...existing, ...cfg }, null, 2)}\n`, { mode: 0o600 });
  await chmod(globalConfigPath(), 0o600).catch(() => {});
}

/** บันทึก path ของ second-brain workspace ลง global config (merge — ไม่ทับ field อื่น) */
export async function saveBrainPath(path: string): Promise<void> {
  await mkdir(configHomeDir(), { recursive: true });
  const existing = await readJson(globalConfigPath());
  await writeFile(globalConfigPath(), `${JSON.stringify({ ...existing, brainPath: path }, null, 2)}\n`, { mode: 0o600 });
  await chmod(globalConfigPath(), 0o600).catch(() => {});
}

/** อ่าน config.json ดิบ (ไม่ apply default/schema) — สำหรับ `sanook config` */
export async function readGlobalConfigRaw(): Promise<Record<string, unknown>> {
  return readJson(globalConfigPath());
}

/** path ของ auth.json (ใช้โชว์ใน CLI เท่านั้น; ห้าม print raw secret) */
export function authConfigPath(): string {
  return authPath();
}

function isSafeAuthEnvVarName(name: string): boolean {
  return AUTH_ENV_VAR_RE.test(name) && !RESERVED_AUTH_KEYS.has(name);
}

/** อ่าน auth.json ดิบแบบกรองเฉพาะ string values — caller ต้อง redact ก่อนโชว์ */
export async function readStoredAuthRaw(): Promise<Record<string, string>> {
  const raw = await readJson(authPath());
  const auth: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (isSafeAuthEnvVarName(k) && typeof v === 'string') auth[k] = v;
  }
  return auth;
}

/** merge patch ลง config.json (สำหรับ `sanook config set`) */
export async function patchGlobalConfig(patch: Record<string, unknown>): Promise<void> {
  await mkdir(configHomeDir(), { recursive: true });
  const existing = await readJson(globalConfigPath());
  await writeFile(globalConfigPath(), `${JSON.stringify({ ...existing, ...patch }, null, 2)}\n`, { mode: 0o600 });
  await chmod(globalConfigPath(), 0o600).catch(() => {});
}

/** บันทึก API key ลง ~/.sanook/auth.json (chmod 0600) + set env ทันทีสำหรับ session นี้ */
export async function saveKey(envVar: string, key: string): Promise<void> {
  if (!isSafeAuthEnvVarName(envVar)) throw new Error(`env var ไม่ถูกต้อง: ${envVar}`);
  await mkdir(configHomeDir(), { recursive: true });
  const auth = await readStoredAuthRaw();
  auth[envVar] = key;
  await writeFile(authPath(), `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  await chmod(authPath(), 0o600); // เจ้าของอ่าน/เขียนเท่านั้น
  process.env[envVar] = key;
}

/** ลบ key ที่ Sanook เก็บไว้ใน auth.json (ไม่แตะ env จริงของ shell ภายนอก) */
export async function removeStoredKey(envVar: string): Promise<boolean> {
  if (!isSafeAuthEnvVarName(envVar)) return false;
  await mkdir(configHomeDir(), { recursive: true });
  const auth = await readStoredAuthRaw();
  if (!Object.prototype.hasOwnProperty.call(auth, envVar)) return false;
  delete auth[envVar];
  await writeFile(authPath(), `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  await chmod(authPath(), 0o600).catch(() => {});
  delete process.env[envVar];
  return true;
}

/** ล้าง auth.json ที่ Sanook เก็บไว้ทั้งหมด */
export async function clearStoredAuth(): Promise<void> {
  await mkdir(configHomeDir(), { recursive: true });
  const auth = await readStoredAuthRaw();
  for (const envVar of Object.keys(auth)) delete process.env[envVar];
  await writeFile(authPath(), '{}\n', { mode: 0o600 });
  await chmod(authPath(), 0o600).catch(() => {});
}

/** โหลด key จาก auth.json เข้า env ตอน boot (ไม่ override env ที่ตั้งไว้แล้ว) */
export async function loadKeysIntoEnv(): Promise<void> {
  try {
    const auth = await readStoredAuthRaw();
    for (const [k, v] of Object.entries(auth)) {
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* ไม่มี auth.json = ข้าม */
  }
}
