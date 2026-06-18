import type { McpServerConfig } from './mcp.js';

export const MCP_REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io/v0';

export interface McpRegistryInput {
  name?: string;
  description?: string;
  value?: string;
  placeholder?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  format?: string;
  type?: string;
}

export interface McpRegistryRemote {
  type?: string;
  url?: string;
  headers?: McpRegistryInput[] | Record<string, string>;
}

export interface McpRegistryArgument {
  type?: string;
  name?: string;
  value?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  valueHint?: string;
  placeholder?: string;
}

export interface McpRegistryPackage {
  registryType?: string;
  identifier?: string;
  version?: string;
  runtimeHint?: string;
  runtimeArguments?: McpRegistryArgument[] | null;
  packageArguments?: McpRegistryArgument[] | null;
  environmentVariables?: McpRegistryInput[] | null;
  transport?: { type?: string };
}

export interface McpRegistryServer {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  repositoryUrl?: string;
  websiteUrl?: string;
  isLatest: boolean;
  remotes: McpRegistryRemote[];
  packages: McpRegistryPackage[];
}

export interface McpRegistrySearchResult {
  servers: McpRegistryServer[];
  nextCursor?: string;
}

export interface McpRegistryInstallOptions {
  alias?: string;
  transport?: 'auto' | 'remote' | 'stdio';
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export type McpRegistryInstallPlan =
  | {
      ok: true;
      alias: string;
      config: McpServerConfig;
      source: 'remote' | 'package';
      warnings: string[];
      requirements: string[];
    }
  | {
      ok: false;
      alias: string;
      missing: string[];
      warnings: string[];
      requirements: string[];
    };

export interface McpPreset {
  name: string;
  description: string;
  servers: string[];
}

export const MCP_PRESETS: McpPreset[] = [
  {
    name: 'dev',
    description: 'Repo/issues/releases, error debugging, and versioned docs.',
    servers: ['com.gitlab/mcp', 'com.mcparmory/github', 'com.mcparmory/sentry', 'ai.smithery/renCosta2025-context7fork'],
  },
  {
    name: 'research',
    description: 'Web/doc fetching, search, and knowledge intake.',
    servers: ['ai.smithery/smithery-ai-fetch', 'ai.groundroute/web-search', 'ai.smithery/arjunkmrm-brave-search-mcp-server', 'ai.smithery/sunub-obsidian-mcp-server'],
  },
  {
    name: 'pm',
    description: 'Issue tracking, planning, and team/workspace context.',
    servers: ['app.linear/linear', 'ai.waystation/jira', 'ai.waystation/slack', 'com.mcparmory/notion'],
  },
  {
    name: 'ops',
    description: 'Read-only data inspection, production errors, and infra helpers.',
    servers: ['capital.hove/read-only-local-postgres-mcp-server', 'com.mcparmory/sentry', 'io.github.CSOAI-ORG/docker-helper-ai-mcp'],
  },
];

type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'statusText' | 'json'>>;

interface RawRegistryEntry {
  server?: {
    name?: string;
    title?: string;
    description?: string;
    version?: string;
    repository?: { url?: string };
    websiteUrl?: string;
    remotes?: McpRegistryRemote[];
    packages?: McpRegistryPackage[];
  };
  _meta?: {
    'io.modelcontextprotocol.registry/official'?: {
      isLatest?: boolean;
      status?: string;
    };
  };
}

export function parseKeyValueList(values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const value of values) {
    const idx = value.indexOf('=');
    if (idx <= 0) throw new Error(`ต้องใช้รูปแบบ KEY=value: ${value}`);
    const key = value.slice(0, idx).trim();
    if (!key) throw new Error(`ต้องใช้รูปแบบ KEY=value: ${value}`);
    out[key] = value.slice(idx + 1);
  }
  return out;
}

export function aliasFromRegistryName(name: string): string {
  const [scope = '', rawLeaf = name] = name.split('/');
  const leaf = rawLeaf
    .replace(/^mcp[-_]?/i, '')
    .replace(/[-_]?mcp[-_]?server$/i, '')
    .replace(/[-_]?server$/i, '')
    .replace(/^smithery[-_]?ai[-_]?/i, '');
  const scopeParts = scope.split('.').filter(Boolean);
  const fallback = scopeParts.length > 1 ? scopeParts[1] : scopeParts[0] || name;
  const candidate = leaf && leaf.toLowerCase() !== 'mcp' ? leaf : fallback;
  const alias = candidate.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return alias || 'mcp-server';
}

export async function searchMcpRegistry(
  query: string,
  options: { limit?: number; cursor?: string; fetchImpl?: FetchLike; baseUrl?: string } = {},
): Promise<McpRegistrySearchResult> {
  const params = new URLSearchParams();
  if (query.trim()) params.set('search', query.trim());
  params.set('limit', String(options.limit ?? 10));
  if (options.cursor) params.set('cursor', options.cursor);
  const json = await fetchRegistryJson(`${options.baseUrl ?? MCP_REGISTRY_BASE_URL}/servers?${params}`, options.fetchImpl);
  const entries = Array.isArray(json.servers) ? json.servers : [];
  return {
    servers: latestOnly(entries.map(normalizeRegistryEntry).filter((item): item is McpRegistryServer => !!item)),
    nextCursor: typeof json.metadata?.nextCursor === 'string' ? json.metadata.nextCursor : undefined,
  };
}

export async function getMcpRegistryServer(
  name: string,
  options: { version?: string; fetchImpl?: FetchLike; baseUrl?: string } = {},
): Promise<McpRegistryServer | undefined> {
  const encoded = encodeURIComponent(name);
  const base = options.baseUrl ?? MCP_REGISTRY_BASE_URL;
  if (options.version) {
    const raw = await fetchRegistryJson(`${base}/servers/${encoded}/versions/${encodeURIComponent(options.version)}`, options.fetchImpl);
    return normalizeRegistryEntry(raw);
  }
  const json = await fetchRegistryJson(`${base}/servers/${encoded}/versions`, options.fetchImpl);
  const entries = Array.isArray(json.servers) ? json.servers : [];
  const servers = entries.map(normalizeRegistryEntry).filter((item): item is McpRegistryServer => !!item);
  return servers.find((server) => server.isLatest) ?? servers.at(-1);
}

export function buildMcpInstallPlan(server: McpRegistryServer, options: McpRegistryInstallOptions = {}): McpRegistryInstallPlan {
  const alias = options.alias ?? aliasFromRegistryName(server.name);
  const warnings: string[] = [];
  const requirements: string[] = [];
  const preferred = options.transport ?? 'auto';
  if (preferred !== 'stdio') {
    const remote = server.remotes.find((item) => item.type === 'streamable-http' && item.url) ?? server.remotes.find((item) => item.url);
    if (remote?.url) {
      const headers = resolveHeaders(remote.headers, options.headers ?? {});
      requirements.push(...headers.requirements);
      if (headers.missing.length) return { ok: false, alias, missing: headers.missing, warnings, requirements };
      if (remote.type && remote.type !== 'streamable-http') warnings.push(`remote transport เป็น ${remote.type}; Sanook รองรับ Streamable HTTP เป็นหลัก`);
      return { ok: true, alias, config: { url: remote.url, ...(Object.keys(headers.values).length ? { headers: headers.values } : {}) }, source: 'remote', warnings, requirements };
    }
    if (preferred === 'remote') {
      warnings.push('server นี้ไม่มี remote URL ที่ install ได้');
      return { ok: false, alias, missing: [], warnings, requirements };
    }
  }

  const pkg = choosePackage(server.packages);
  if (!pkg) return { ok: false, alias, missing: [], warnings: [...warnings, 'ไม่พบ package/remote ที่ Sanook install อัตโนมัติได้'], requirements };
  const env = resolveEnv(pkg.environmentVariables ?? [], options.env ?? {});
  requirements.push(...env.requirements);
  if (env.missing.length) return { ok: false, alias, missing: env.missing, warnings, requirements };
  const commandArgs = packageCommand(pkg);
  if (!commandArgs) return { ok: false, alias, missing: [], warnings: [...warnings, `ยังไม่รองรับ package runtime: ${pkg.runtimeHint ?? pkg.registryType ?? '(unknown)'}`], requirements };
  return {
    ok: true,
    alias,
    config: { command: commandArgs.command, args: commandArgs.args, ...(Object.keys(env.values).length ? { env: env.values } : {}) },
    source: 'package',
    warnings,
    requirements,
  };
}

export function formatRegistrySearch(result: McpRegistrySearchResult): string {
  const lines = ['MCP registry search'];
  if (!result.servers.length) return `${lines[0]}\n(no matches)`;
  for (const server of result.servers) {
    lines.push(`${server.name}${server.version ? `@${server.version}` : ''} — ${server.description ?? '(no description)'}`);
    lines.push(`  transport: ${transportSummary(server)}${server.repositoryUrl ? ` · repo: ${server.repositoryUrl}` : ''}`);
  }
  if (result.nextCursor) lines.push(`next: --cursor ${result.nextCursor}`);
  return lines.join('\n');
}

export function formatRegistryInfo(server: McpRegistryServer): string {
  const lines = [`${server.name}${server.version ? `@${server.version}` : ''}`, server.description ?? '(no description)'];
  if (server.repositoryUrl) lines.push(`repo: ${server.repositoryUrl}`);
  if (server.websiteUrl) lines.push(`website: ${server.websiteUrl}`);
  lines.push(`transport: ${transportSummary(server)}`);
  if (server.remotes.length) {
    lines.push('remotes:');
    for (const remote of server.remotes) {
      lines.push(`  - ${remote.type ?? 'remote'} ${remote.url ?? '(missing url)'}`);
      for (const req of inputSummaries(inputArray(remote.headers))) lines.push(`    ${req}`);
    }
  }
  if (server.packages.length) {
    lines.push('packages:');
    for (const pkg of server.packages) {
      lines.push(`  - ${pkg.registryType ?? 'pkg'} ${pkg.identifier ?? '(missing identifier)'}${pkg.version ? `@${pkg.version}` : ''}${pkg.runtimeHint ? ` via ${pkg.runtimeHint}` : ''}`);
      for (const req of inputSummaries(pkg.environmentVariables ?? [])) lines.push(`    ${req}`);
    }
  }
  lines.push(`install: sanook mcp install ${server.name} --name ${aliasFromRegistryName(server.name)}`);
  return lines.join('\n');
}

export function formatPreset(name?: string): string {
  if (!name) {
    return ['MCP presets', ...MCP_PRESETS.map((preset) => `  ${preset.name.padEnd(8)} ${preset.description}`)].join('\n');
  }
  const preset = MCP_PRESETS.find((item) => item.name === name);
  if (!preset) return `ไม่เจอ preset: ${name}\nมีให้เลือก: ${MCP_PRESETS.map((item) => item.name).join(', ')}`;
  return [
    `MCP preset: ${preset.name}`,
    preset.description,
    '',
    ...preset.servers.map((server) => `- ${server}\n  sanook mcp info ${server}\n  sanook mcp install ${server} --name ${aliasFromRegistryName(server)}`),
  ].join('\n');
}

function normalizeRegistryEntry(raw: RawRegistryEntry): McpRegistryServer | undefined {
  const server = raw.server;
  if (!server?.name) return undefined;
  return {
    name: server.name,
    title: server.title,
    description: server.description,
    version: server.version,
    repositoryUrl: server.repository?.url,
    websiteUrl: server.websiteUrl,
    isLatest: raw._meta?.['io.modelcontextprotocol.registry/official']?.isLatest !== false,
    remotes: Array.isArray(server.remotes) ? server.remotes : [],
    packages: Array.isArray(server.packages) ? server.packages : [],
  };
}

function latestOnly(servers: McpRegistryServer[]): McpRegistryServer[] {
  const out = new Map<string, McpRegistryServer>();
  for (const server of servers) {
    const current = out.get(server.name);
    if (!current || server.isLatest) out.set(server.name, server);
  }
  return [...out.values()];
}

async function fetchRegistryJson(url: string, fetchImpl: FetchLike = fetch): Promise<Record<string, any>> {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`registry ${res.status} ${res.statusText}`);
  return (await res.json()) as Record<string, any>;
}

function transportSummary(server: McpRegistryServer): string {
  const transports = [
    ...server.remotes.map((remote) => `remote:${remote.type ?? 'unknown'}`),
    ...server.packages.map((pkg) => `${pkg.registryType ?? 'pkg'}:${pkg.runtimeHint ?? 'package'}`),
  ];
  return transports.length ? transports.join(', ') : 'none listed';
}

function inputArray(value: McpRegistryRemote['headers']): McpRegistryInput[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Object.entries(value).map(([name, input]) => ({ name, value: String(input) }));
}

function inputSummaries(inputs: readonly McpRegistryInput[]): string[] {
  return inputs.map((input) => {
    const name = input.name ?? '(positional)';
    const flags = [input.isRequired ? 'required' : undefined, input.isSecret ? 'secret' : undefined].filter(Boolean).join(', ');
    return `${name}${flags ? ` (${flags})` : ''}${input.description ? ` — ${input.description}` : ''}`;
  });
}

function resolveHeaders(raw: McpRegistryRemote['headers'], provided: Record<string, string>): { values: Record<string, string>; missing: string[]; requirements: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  const requirements: string[] = [];
  for (const input of inputArray(raw)) {
    const name = input.name;
    if (!name) continue;
    requirements.push(`header ${name}${input.isSecret ? ' (secret)' : ''}`);
    const explicit = provided[name];
    if (explicit != null) values[name] = explicit;
    else if (input.value && !/\{[^}]+\}/.test(input.value)) values[name] = input.value;
    else if (input.default != null) values[name] = input.default;
    else if (input.isRequired || input.value) missing.push(`header:${name}`);
  }
  for (const [name, value] of Object.entries(provided)) values[name] = value;
  return { values, missing, requirements };
}

function resolveEnv(inputs: readonly McpRegistryInput[], provided: Record<string, string>): { values: Record<string, string>; missing: string[]; requirements: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  const requirements: string[] = [];
  for (const input of inputs) {
    const name = input.name;
    if (!name) continue;
    requirements.push(`env ${name}${input.isSecret ? ' (secret)' : ''}`);
    const explicit = provided[name];
    if (explicit != null) values[name] = explicit;
    else if (input.value && !/\{[^}]+\}/.test(input.value)) values[name] = input.value;
    else if (input.default != null) values[name] = input.default;
    else if (input.isRequired) missing.push(`env:${name}`);
  }
  for (const [name, value] of Object.entries(provided)) values[name] = value;
  return { values, missing, requirements };
}

function choosePackage(packages: readonly McpRegistryPackage[]): McpRegistryPackage | undefined {
  return (
    packages.find((pkg) => pkg.transport?.type === 'stdio' && (pkg.runtimeHint === 'npx' || pkg.registryType === 'npm')) ??
    packages.find((pkg) => pkg.transport?.type === 'stdio' && pkg.runtimeHint === 'uvx') ??
    packages.find((pkg) => pkg.transport?.type === 'stdio' && pkg.runtimeHint === 'docker') ??
    packages.find((pkg) => pkg.transport?.type === 'stdio')
  );
}

function packageCommand(pkg: McpRegistryPackage): { command: string; args: string[] } | undefined {
  const identifier = pkg.identifier;
  if (!identifier) return undefined;
  const runtime = pkg.runtimeHint ?? (pkg.registryType === 'npm' ? 'npx' : pkg.registryType === 'pypi' ? 'uvx' : undefined);
  const pkgId = packageIdentifierWithVersion(identifier, pkg.version);
  const runtimeArgs = materializeArgs(pkg.runtimeArguments ?? []);
  const packageArgs = materializeArgs(pkg.packageArguments ?? []);
  if (runtime === 'npx') {
    const args = runtimeArgs.length ? runtimeArgs : ['-y'];
    return { command: 'npx', args: [...args, pkgId, ...packageArgs] };
  }
  if (runtime === 'uvx') return { command: 'uvx', args: [...runtimeArgs, pkgId, ...packageArgs] };
  if (runtime === 'docker') return { command: 'docker', args: ['run', '-i', '--rm', ...runtimeArgs, pkgId, ...packageArgs] };
  return undefined;
}

function packageIdentifierWithVersion(identifier: string, version?: string): string {
  if (!version) return identifier;
  const scopedPackageNameEnd = identifier.startsWith('@') ? identifier.indexOf('/', 1) + 1 : 0;
  return identifier.indexOf('@', scopedPackageNameEnd) === -1 ? `${identifier}@${version}` : identifier;
}

function materializeArgs(args: readonly McpRegistryArgument[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    const value = arg.value ?? arg.default;
    if (!value || /\{[^}]+\}/.test(value)) continue;
    if (arg.name) out.push(arg.name);
    out.push(value);
  }
  return out;
}
