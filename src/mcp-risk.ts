import type { McpServerConfig, McpToolDef } from './mcp.js';
import type { McpRegistryServer } from './mcp-registry.js';

export type McpRiskLabel = 'read-only' | 'file-write' | 'network-write' | 'database-write' | 'infra/admin';

const RISK_PRIORITY: Record<McpRiskLabel, number> = {
  'read-only': 0,
  'network-write': 1,
  'file-write': 2,
  'database-write': 3,
  'infra/admin': 4,
};

const WRITE_TOOL = /\b(write|create|update|delete|insert|drop|push|post|send|execute|deploy|apply|modify|edit|remove|destroy|mutate|run_|upload|patch|merge|commit|publish|trigger|invoke|call|set_)\b/i;
const READ_ONLY_TEXT = /\b(read[-_ ]?only|readonly|list|get|search|fetch|query|inspect|view|describe|lookup|recall)\b/i;
const FILE_WRITE_TEXT = /\b(file|filesystem|fs[-_ ]?server|write_file|edit_file|directory)\b/i;
const DB_WRITE_TEXT = /\b(postgres|postgresql|mysql|sqlite|mongodb|redis|database|sql|db[-_ ]?write)\b/i;
const NETWORK_WRITE_TEXT = /\b(github|gitlab|slack|discord|linear|jira|notion|fetch|search|browser|playwright|http|web|api|issue|pull|release|message|chat|email|gmail|drive|obsidian|tavily|brave)\b/i;
const INFRA_TEXT = /\b(docker|kubernetes|k8s|helm|terraform|aws|gcp|azure|infra|container|cluster|pod|deployment|kubectl)\b/i;

function maxRisk(...labels: McpRiskLabel[]): McpRiskLabel {
  return labels.reduce((best, label) => (RISK_PRIORITY[label] > RISK_PRIORITY[best] ? label : best), 'read-only');
}

function riskFromText(text: string): McpRiskLabel | undefined {
  const haystack = text.toLowerCase();
  if (INFRA_TEXT.test(haystack)) return 'infra/admin';
  if (DB_WRITE_TEXT.test(haystack)) return READ_ONLY_TEXT.test(haystack) ? 'read-only' : 'database-write';
  if (FILE_WRITE_TEXT.test(haystack)) return 'file-write';
  if (NETWORK_WRITE_TEXT.test(haystack)) return READ_ONLY_TEXT.test(haystack) ? 'read-only' : 'network-write';
  if (READ_ONLY_TEXT.test(haystack)) return 'read-only';
  return undefined;
}

function riskFromTools(tools: readonly McpToolDef[]): McpRiskLabel | undefined {
  const labels: McpRiskLabel[] = [];
  for (const tool of tools) {
    const text = `${tool.name} ${tool.description ?? ''}`;
    const base = riskFromText(text);
    if (base) labels.push(base);
    if (WRITE_TOOL.test(text) && base !== 'read-only') {
      if (DB_WRITE_TEXT.test(text)) labels.push('database-write');
      else if (FILE_WRITE_TEXT.test(text)) labels.push('file-write');
      else if (INFRA_TEXT.test(text)) labels.push('infra/admin');
      else labels.push('network-write');
    }
  }
  return labels.length ? maxRisk(...labels) : undefined;
}

export function inferRegistryServerRisk(server: McpRegistryServer): McpRiskLabel {
  const parts = [
    server.name,
    server.title,
    server.description,
    ...server.packages.map((pkg) => `${pkg.registryType ?? ''} ${pkg.identifier ?? ''} ${pkg.runtimeHint ?? ''}`),
    ...server.remotes.map((remote) => `${remote.type ?? ''} ${remote.url ?? ''}`),
  ].filter((part): part is string => Boolean(part));
  const labels = parts.map((part) => riskFromText(part)).filter((label): label is McpRiskLabel => !!label);
  return labels.length ? maxRisk(...labels) : 'read-only';
}

export function inferConfiguredServerRisk(name: string, cfg: McpServerConfig, tools: readonly McpToolDef[] = []): McpRiskLabel {
  const commandLine = [cfg.command, ...(cfg.args ?? []), cfg.url].filter(Boolean).join(' ');
  const labels = [riskFromText(name), riskFromText(commandLine), riskFromTools(tools)].filter(
    (label): label is McpRiskLabel => !!label,
  );
  if (cfg.url) labels.push('network-write');
  return labels.length ? maxRisk(...labels) : 'read-only';
}

export function formatMcpRiskLabel(label: McpRiskLabel): string {
  return label;
}
