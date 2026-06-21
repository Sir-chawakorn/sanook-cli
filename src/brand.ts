import { stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const BRAND = {
  productName: 'Sanook',
  agentName: 'Sanook',
  cliName: 'sanook',
  configDirName: '.sanook',
  // ชื่อโฟลเดอร์ default ของ second-brain vault — single source of truth สำหรับ defaultBrainPath()
  defaultVaultName: 'Second Brain',
  memoryFileName: 'SANOOK.md',
  modelEnvVar: 'SANOOK_MODEL',
  gatewayServiceName: 'sanook-gateway',
  mcpClientName: 'sanook',
  autoMemoryTitle: 'Sanook Auto-Memory',
  undoStashMessage: 'sanook /undo',
  bannerWide: 'Sanook AI',
  bannerNarrow: 'Sanook',
  bannerTitle: 'Sanook AI CLI',
  skillTempPrefix: 'sanook-skill-',
  evalTempPrefix: 'sanook-eval-',
};

export const BRAND_ENV = {
  allowOutsideWorkspace: 'SANOOK_ALLOW_OUTSIDE_WORKSPACE',
  gatewayAllowWrite: 'SANOOK_GATEWAY_ALLOW_WRITE',
  hooksInheritEnv: 'SANOOK_HOOKS_INHERIT_ENV',
  disablePersistence: 'SANOOK_DISABLE_PERSISTENCE',
  disableUpdateCheck: 'SANOOK_DISABLE_UPDATE_CHECK',
  disableWorklog: 'SANOOK_DISABLE_WORKLOG',
  disableUsageLedger: 'SANOOK_DISABLE_USAGE',
  brainTranscript: 'SANOOK_BRAIN_TRANSCRIPT',
  disableSelfImprove: 'SANOOK_DISABLE_SELF_IMPROVE',
  selfImproveThreshold: 'SANOOK_SELF_IMPROVE_THRESHOLD',
  trustProject: 'SANOOK_TRUST_PROJECT',
};

export function appHomePath(...parts: string[]): string {
  return join(homedir(), BRAND.configDirName, ...parts);
}

export function appProjectPath(cwd: string, ...parts: string[]): string {
  return join(cwd, BRAND.configDirName, ...parts);
}

export function appTempPath(name: string): string {
  return join(tmpdir(), name);
}

/**
 * ตำแหน่ง default ของ second-brain vault — cross-platform ผ่าน homedir():
 *   macOS/Linux: ~/Documents/Second Brain · Windows: %USERPROFILE%\Documents\Second Brain
 * ใช้เป็นทั้ง default ตอน setup และ fallback ตอน config ยังไม่ตั้ง brainPath (ดู getBrainPath / loadConfig)
 */
export function defaultBrainPath(): string {
  return join(homedir(), 'Documents', BRAND.defaultVaultName);
}

/** true only when `p` exists and is a directory; missing/inaccessible paths are treated as false. */
export async function pathIsDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export function envFlag(name: string): boolean {
  const v = process.env[name]?.trim();
  return v === '1' || v?.toLowerCase() === 'true' || v?.toLowerCase() === 'yes';
}

export function persistenceEnabled(): boolean {
  return !envFlag(BRAND_ENV.disablePersistence);
}

export function worklogEnabled(): boolean {
  return !envFlag(BRAND_ENV.disableWorklog);
}

export function usageLedgerEnabled(): boolean {
  return persistenceEnabled() && !envFlag(BRAND_ENV.disableUsageLedger);
}

/** env-level force for full-transcript-to-vault; config.brainTranscript is the persistent toggle */
export function brainTranscriptEnvForced(): boolean {
  return envFlag(BRAND_ENV.brainTranscript);
}

/** self-improvement (auto-skill จากงานที่ทำซ้ำ) — เปิด default, ปิดด้วย SANOOK_DISABLE_SELF_IMPROVE=1 */
export function selfImproveEnabled(): boolean {
  return persistenceEnabled() && !envFlag(BRAND_ENV.disableSelfImprove);
}

/** จำนวนครั้งที่งานคล้ายกันต้องเกิดก่อน auto-สร้าง skill (default 3) — override ด้วย env */
export function selfImproveThreshold(): number {
  const raw = process.env[BRAND_ENV.selfImproveThreshold]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 2 ? n : 3;
}
