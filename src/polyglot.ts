import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BRAND } from './brand.js';
import { findBinary } from './lsp/servers.js';
import { safeProcessEnv } from './process-runner.js';

const execFileAsync = promisify(execFile);
const MAX_VERSION_TEXT = 160;

export type RuntimeStatus = 'ready' | 'missing' | 'core';

export interface RuntimeProbe {
  id: string;
  label: string;
  status: RuntimeStatus;
  command?: string;
  version?: string;
  role: string;
  install?: string;
}

export interface PolyglotReport {
  cwd: string;
  runtimes: RuntimeProbe[];
  strategy: string[];
  notes: string[];
}

export interface RuntimeDetectorOptions {
  cwd?: string;
  findBinaryImpl?: (command: string, cwd?: string) => Promise<string | null>;
  versionImpl?: (command: string, args: string[], cwd: string) => Promise<string>;
}

const RUNTIME_SPECS = [
  {
    id: 'python',
    label: 'Python',
    candidates: ['python3', 'python'],
    versionArgs: ['--version'],
    role: 'data/doc/ML glue, JSON/CSV transforms, OCR/transcription helpers, one-off research scripts via run_python',
    install: 'Install Python 3.11+ (python.org, Homebrew, pyenv, or uv).',
  },
  {
    id: 'uv',
    label: 'uv',
    candidates: ['uv'],
    versionArgs: ['--version'],
    role: 'fast Python project/env management when Sanook grows optional Python packs',
    install: 'Install uv: https://docs.astral.sh/uv/',
  },
  {
    id: 'rustc',
    label: 'Rust compiler',
    candidates: ['rustc'],
    versionArgs: ['--version'],
    role: 'compile small high-speed/safe helpers and future native accelerators via run_rust',
    install: 'Install Rust via rustup: https://rustup.rs/',
  },
  {
    id: 'cargo',
    label: 'Cargo',
    candidates: ['cargo'],
    versionArgs: ['--version'],
    role: 'build/test packaged Rust helpers when a native crate becomes worth shipping',
    install: 'Install Rust via rustup: https://rustup.rs/',
  },
  {
    id: 'pyright',
    label: 'Pyright LSP',
    candidates: ['pyright-langserver'],
    versionArgs: ['--version'],
    role: 'Python diagnostics through Sanook diagnostics tool',
    install: 'npm i -g pyright',
  },
  {
    id: 'rust-analyzer',
    label: 'rust-analyzer LSP',
    candidates: ['rust-analyzer'],
    versionArgs: ['--version'],
    role: 'Rust diagnostics through Sanook diagnostics tool',
    install: 'rustup component add rust-analyzer',
  },
] as const;

async function defaultVersion(command: string, args: string[], cwd: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, args, { cwd, env: safeProcessEnv(), timeout: 5_000, maxBuffer: 256 * 1024 });
  return stdout.trim() ? stdout : stderr;
}

function normalizeVersionText(version: string): string {
  const firstLine = version.trim().split(/\r?\n/)[0]?.trim() || '(version unavailable)';
  if (firstLine.length <= MAX_VERSION_TEXT) return firstLine;
  return `${firstLine.slice(0, MAX_VERSION_TEXT - '... [truncated]'.length)}... [truncated]`;
}

async function detectSpec(
  spec: (typeof RUNTIME_SPECS)[number],
  cwd: string,
  findBinaryImpl: NonNullable<RuntimeDetectorOptions['findBinaryImpl']>,
  versionImpl: NonNullable<RuntimeDetectorOptions['versionImpl']>,
): Promise<RuntimeProbe> {
  for (const candidate of spec.candidates) {
    const command = await findBinaryImpl(candidate, cwd);
    if (!command) continue;
    let version: string | undefined;
    try {
      version = normalizeVersionText(await versionImpl(command, [...spec.versionArgs], cwd));
    } catch {
      version = '(installed; version probe failed)';
    }
    return {
      id: spec.id,
      label: spec.label,
      status: 'ready',
      command,
      version,
      role: spec.role,
      install: spec.install,
    };
  }
  return {
    id: spec.id,
    label: spec.label,
    status: 'missing',
    role: spec.role,
    install: spec.install,
  };
}

export async function inspectPolyglotRuntimes(options: RuntimeDetectorOptions = {}): Promise<PolyglotReport> {
  const cwd = options.cwd ?? process.cwd();
  const findBinaryImpl = options.findBinaryImpl ?? findBinary;
  const versionImpl = options.versionImpl ?? defaultVersion;
  const optional = await Promise.all(RUNTIME_SPECS.map((spec) => detectSpec(spec, cwd, findBinaryImpl, versionImpl)));
  return {
    cwd,
    runtimes: [
      {
        id: 'typescript',
        label: 'TypeScript / Node.js',
        status: 'core',
        command: process.execPath,
        version: `node ${process.versions.node}`,
        role: 'core Sanook runtime: agent loop, TUI, gateway, MCP, second-brain, packaging',
      },
      ...optional,
    ],
    strategy: [
      'TypeScript stays the control plane and npm-distributed default.',
      'Python is the optional analysis/data plane: scripts, data wrangling, document/ML/OCR workflows, and research helpers.',
      'Rust is the optional performance/safety plane: single-binary helpers, high-throughput parsing/search, and future native accelerators.',
      'Optional runtimes must degrade gracefully; missing Python/Rust should never break basic Sanook install or chat.',
    ],
    notes: [
      '`run_python` and `run_rust` are approval-gated tools because arbitrary code can mutate files.',
      'The diagnostics tool already understands Python and Rust when Pyright/rust-analyzer are installed.',
      'Use `sanook mcp list --tools` for external runtime capabilities exposed through MCP servers.',
    ],
  };
}

function fmtStatus(status: RuntimeStatus): string {
  if (status === 'core') return 'CORE ';
  if (status === 'ready') return 'READY';
  return 'MISS ';
}

export function renderPolyglotReport(report: PolyglotReport): string {
  const missingRuntimes = report.runtimes.filter((runtime) => runtime.status === 'missing');
  const lines = [
    `${BRAND.productName} runtimes`,
    `cwd: ${report.cwd}`,
    '',
    'Runtime surface:',
    ...report.runtimes.map((runtime) => {
      const version = runtime.version ? ` — ${runtime.version}` : '';
      const command = runtime.command ? ` (${runtime.command})` : '';
      return `  [${fmtStatus(runtime.status)}] ${runtime.label}${version}${command}`;
    }),
    '',
    'Role map:',
    ...report.runtimes.map((runtime) => `  - ${runtime.label}: ${runtime.role}`),
    '',
    'Strategy:',
    ...report.strategy.map((item) => `  - ${item}`),
    '',
    'Missing install hints:',
    ...(missingRuntimes.length > 0 ? missingRuntimes.map((runtime) => `  - ${runtime.label}: ${runtime.install}`) : ['  - None']),
    '',
    'Notes:',
    ...report.notes.map((note) => `  - ${note}`),
  ];
  return `${lines.join('\n')}\n`;
}
