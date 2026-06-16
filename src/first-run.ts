import { detectCodex, type CodexStatus } from './providers/codex.js';
import { hasUsableEnvKey, parseSpec, PROVIDERS } from './providers/registry.js';

export type DetectCodexFn = () => Promise<CodexStatus>;

/**
 * First-run can skip the setup wizard only when the selected provider is genuinely
 * ready to run: cloud providers need a policy-valid API key, local providers need
 * no key, and delegate providers like Codex must have their official CLI auth ready.
 */
export async function providerCanSkipSetup(provider: string, detect: DetectCodexFn = detectCodex): Promise<boolean> {
  const cfg = PROVIDERS[provider];
  if (!cfg) return false;
  if (cfg.kind === 'delegate') {
    const s = await detect();
    return s.installed && s.loggedIn;
  }
  return hasUsableEnvKey(provider);
}

export async function modelNeedsSetup(modelSpec: string, detect: DetectCodexFn = detectCodex): Promise<boolean> {
  const { provider } = parseSpec(modelSpec);
  return !(await providerCanSkipSetup(provider, detect));
}
