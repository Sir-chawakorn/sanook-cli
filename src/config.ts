import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
