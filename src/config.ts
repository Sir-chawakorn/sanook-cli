import { z } from 'zod';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR = join(homedir(), '.sanook');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const AUTH_PATH = join(CONFIG_DIR, 'auth.json'); // API keys (chmod 0600)

export const ConfigSchema = z.object({
  model: z.string().default('sonnet'),
  budgetUsd: z.number().positive().optional(),
  maxSteps: z.number().int().positive().default(20),
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

/**
 * โหลด config แบบ layered: global (~/.sanook) < project (.sanook) < CLI overrides
 * merge raw ทุกชั้นก่อน แล้ว validate zod ทีเดียวที่ merged สุดท้าย
 * (config flat — shallow merge พอ; strip undefined ใน overrides กัน override ทับ default)
 */
export async function loadConfig(
  overrides: Record<string, unknown> = {},
  cwd: string = process.cwd(),
): Promise<Config> {
  const global = await readJson(join(homedir(), '.sanook', 'config.json'));
  const project = await readJson(join(cwd, '.sanook', 'config.json'));

  const cleanOverrides: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) cleanOverrides[k] = v;
  }

  const merged = { ...global, ...project, ...cleanOverrides };
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
  await writeFile(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`);
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
  await writeFile(AUTH_PATH, `${JSON.stringify(auth, null, 2)}\n`);
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
