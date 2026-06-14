import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const BRAND = {
  productName: 'Sanook',
  agentName: 'Sanook',
  cliName: 'sanook',
  configDirName: '.sanook',
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
  disableWorklog: 'SANOOK_DISABLE_WORKLOG',
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

export function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === '1' || v?.toLowerCase() === 'true' || v?.toLowerCase() === 'yes';
}

export function persistenceEnabled(): boolean {
  return !envFlag(BRAND_ENV.disablePersistence);
}

export function worklogEnabled(): boolean {
  return !envFlag(BRAND_ENV.disableWorklog);
}
