import { z } from 'zod';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { appHomePath, appProjectPath, BRAND } from './brand.js';
import { projectTrustStatus } from './trust.js';

export const CONFIG_DIR = appHomePath();
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const AUTH_PATH = join(CONFIG_DIR, 'auth.json'); // API keys (chmod 0600)

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
});

export type Config = z.infer<typeof ConfigSchema>;

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
  const projectRaw = await readJson(appProjectPath(cwd, 'config.json'));
  const trust = await projectTrustStatus(cwd);
  const project = trust.trusted ? projectRaw : sanitizeUntrustedProjectConfig(projectRaw);
  const envConfig: Record<string, unknown> = {};
  if (process.env[BRAND.modelEnvVar]) envConfig.model = process.env[BRAND.modelEnvVar];

  const cleanOverrides: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) cleanOverrides[k] = v;
  }

  const merged = { ...global, ...project, ...envConfig, ...cleanOverrides };
  return ConfigSchema.parse(merged);
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
