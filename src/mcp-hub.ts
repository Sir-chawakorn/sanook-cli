import { isMcpServerEnabled, loadMcpConfig, type McpServerConfig } from './mcp.js';
import { inferConfiguredServerRisk, formatMcpRiskLabel, type McpRiskLabel } from './mcp-risk.js';

export interface McpHubEntry {
  config: McpServerConfig;
  enabled: boolean;
  name: string;
  risk: McpRiskLabel;
  transport: 'http' | 'stdio';
  target: string;
  secretSummary: string;
}

export interface McpHubState {
  entries: McpHubEntry[];
  notes: string[];
}

export function mcpHubEntriesFromConfig(config: Record<string, McpServerConfig>, notes: string[] = []): McpHubState {
  return {
    entries: Object.entries(config)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, server]) => ({
        config: server,
        enabled: isMcpServerEnabled(server),
        name,
        risk: inferConfiguredServerRisk(name, server),
        transport: server.url ? 'http' : 'stdio',
        target: server.url ? server.url : [server.command, ...(server.args ?? [])].filter(Boolean).join(' '),
        secretSummary: secretSummary(server),
      })),
    notes,
  };
}

export async function loadMcpHubEntries(cwd = process.cwd()): Promise<McpHubState> {
  const notes: string[] = [];
  const config = await loadMcpConfig((message) => notes.push(message), cwd);
  return mcpHubEntriesFromConfig(config, notes);
}

function secretSummary(server: McpServerConfig): string {
  const envCount = Object.keys(server.env ?? {}).length;
  const headerCount = Object.keys(server.headers ?? {}).length;
  const parts = [];
  if (envCount) parts.push(`${envCount} env`);
  if (headerCount) parts.push(`${headerCount} header`);
  return parts.length ? parts.join(' · ') : 'no secrets';
}
