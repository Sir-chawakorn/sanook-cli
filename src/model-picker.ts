import { canonicalSpec, hasUsableEnvKey, PROVIDERS, parseSpec } from './providers/registry.js';

export interface ModelPickerOption {
  aliases: string;
  current: boolean;
  label: string;
  meta: string;
  model: string;
  provider: string;
  spec: string;
  status: 'ready' | 'needs-key' | 'local' | 'delegate';
}

function statusFor(provider: string): ModelPickerOption['status'] {
  const cfg = PROVIDERS[provider];
  if (cfg.kind === 'delegate') return 'delegate';
  if (!cfg.requiresKey) return 'local';
  return hasUsableEnvKey(provider) ? 'ready' : 'needs-key';
}

function statusLabel(status: ModelPickerOption['status']): string {
  if (status === 'needs-key') return 'needs key';
  return status;
}

export function modelPickerOptions(current: string): ModelPickerOption[] {
  const currentSpec = canonicalSpec(current);
  return Object.entries(PROVIDERS).flatMap(([provider, cfg]) => {
    const grouped = new Map<string, string[]>();
    for (const [alias, model] of Object.entries(cfg.models)) {
      const aliases = grouped.get(model) ?? [];
      aliases.push(alias);
      grouped.set(model, aliases);
    }

    const status = statusFor(provider);
    return [...grouped.entries()].map(([model, aliases]) => {
      const nonDefaultAliases = aliases.filter((alias) => alias !== 'default');
      const displayAliases = nonDefaultAliases.length ? nonDefaultAliases.join('/') : 'default';
      const spec = `${provider}:${model}`;
      return {
        aliases: displayAliases,
        current: spec === currentSpec,
        label: `${provider}:${displayAliases}`,
        meta: `${cfg.label} · ${statusLabel(status)}`,
        model,
        provider,
        spec,
        status,
      };
    });
  });
}

export function initialModelPickerIndex(options: ModelPickerOption[]): number {
  const current = options.findIndex((option) => option.current);
  return current === -1 ? 0 : current;
}
