import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { appHomePath, BRAND } from '../brand.js';

export interface GatewayServiceState {
  pid: number;
  startedAt: string;
  command: string;
  args: string[];
  cwd: string;
  logPath: string;
}

export interface GatewayServiceStatus {
  running: boolean;
  state: GatewayServiceState | null;
  statePath: string;
  logPath: string;
}

export interface StartGatewayServiceOptions {
  entrypoint: string;
  gatewayArgs?: string[];
  command?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: typeof spawn;
}

export interface InstallGatewayServiceResult {
  path: string;
  kind: 'launchd' | 'systemd' | 'cmd';
  instructions: string[];
}

const SERVICE_STATE_PATH = appHomePath('gateway', 'service.json');
const SERVICE_LOG_PATH = appHomePath('gateway', 'gateway.log');

export function gatewayServiceStatePath(): string {
  return SERVICE_STATE_PATH;
}

export function gatewayServiceLogPath(): string {
  return SERVICE_LOG_PATH;
}

export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function readGatewayServiceState(): Promise<GatewayServiceState | null> {
  try {
    const parsed = JSON.parse(await readFile(SERVICE_STATE_PATH, 'utf8')) as Partial<GatewayServiceState>;
    const pid = parsed.pid;
    if (typeof pid !== 'number' || !Number.isInteger(pid) || !parsed.command || !Array.isArray(parsed.args)) return null;
    return {
      pid,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      command: parsed.command,
      args: parsed.args.filter((a): a is string => typeof a === 'string'),
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : process.cwd(),
      logPath: typeof parsed.logPath === 'string' ? parsed.logPath : SERVICE_LOG_PATH,
    };
  } catch {
    return null;
  }
}

export async function gatewayServiceStatus(): Promise<GatewayServiceStatus> {
  const state = await readGatewayServiceState();
  return {
    running: state ? processAlive(state.pid) : false,
    state,
    statePath: SERVICE_STATE_PATH,
    logPath: SERVICE_LOG_PATH,
  };
}

async function writeState(state: GatewayServiceState): Promise<void> {
  await mkdir(dirname(SERVICE_STATE_PATH), { recursive: true });
  await writeFile(SERVICE_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(SERVICE_STATE_PATH, 0o600).catch(() => {});
}

export async function clearGatewayServiceState(): Promise<void> {
  await rm(SERVICE_STATE_PATH, { force: true }).catch(() => {});
}

export async function startGatewayService(opts: StartGatewayServiceOptions): Promise<{ started: boolean; state: GatewayServiceState }> {
  const existing = await readGatewayServiceState();
  if (existing && processAlive(existing.pid)) return { started: false, state: existing };

  const command = opts.command ?? process.execPath;
  const entrypoint = resolve(opts.entrypoint);
  const args = [entrypoint, 'gateway', 'run', ...(opts.gatewayArgs ?? [])];
  const cwd = opts.cwd ?? process.cwd();
  await mkdir(dirname(SERVICE_LOG_PATH), { recursive: true });
  const fd = openSync(SERVICE_LOG_PATH, 'a');
  let child: ChildProcess;
  try {
    child = (opts.spawnFn ?? spawn)(command, args, {
      cwd,
      detached: true,
      env: opts.env ?? process.env,
      stdio: ['ignore', fd, fd],
    });
  } finally {
    closeSync(fd);
  }
  child.unref();
  if (!child.pid) throw new Error('เริ่ม gateway service ไม่สำเร็จ: ไม่มี pid จาก child process');

  const state: GatewayServiceState = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    command,
    args,
    cwd,
    logPath: SERVICE_LOG_PATH,
  };
  await writeState(state);
  return { started: true, state };
}

async function waitUntilStopped(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!processAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !processAlive(pid);
}

export async function stopGatewayService(timeoutMs = 3000): Promise<{ stopped: boolean; state: GatewayServiceState | null }> {
  const state = await readGatewayServiceState();
  if (!state) return { stopped: false, state: null };
  if (!processAlive(state.pid)) {
    await clearGatewayServiceState();
    return { stopped: false, state };
  }
  process.kill(state.pid, 'SIGTERM');
  const stopped = await waitUntilStopped(state.pid, timeoutMs);
  if (!stopped && processAlive(state.pid)) {
    try {
      process.kill(state.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  await clearGatewayServiceState();
  return { stopped: true, state };
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function quoteSystemdArg(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function quoteCmdArg(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function installGatewayService(entrypoint: string): Promise<InstallGatewayServiceResult> {
  const command = process.execPath;
  const script = resolve(entrypoint);
  if (process.platform === 'darwin') {
    const path = join(homedir(), 'Library', 'LaunchAgents', `com.${BRAND.cliName}.gateway.plist`);
    const log = SERVICE_LOG_PATH;
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.${BRAND.cliName}.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(command)}</string>
    <string>${escapeXml(script)}</string>
    <string>gateway</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(log)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(log)}</string>
</dict>
</plist>
`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, plist, { mode: 0o644 });
    return {
      path,
      kind: 'launchd',
      instructions: [`launchctl load ${path}`, `launchctl start com.${BRAND.cliName}.gateway`],
    };
  }

  if (process.platform === 'linux') {
    const path = join(homedir(), '.config', 'systemd', 'user', `${BRAND.cliName}-gateway.service`);
    const unit = `[Unit]
Description=${BRAND.productName} Gateway

[Service]
ExecStart=${quoteSystemdArg(command)} ${quoteSystemdArg(script)} gateway run
Restart=always
WorkingDirectory=${quoteSystemdArg(process.cwd())}
StandardOutput=${quoteSystemdArg(`append:${SERVICE_LOG_PATH}`)}
StandardError=${quoteSystemdArg(`append:${SERVICE_LOG_PATH}`)}

[Install]
WantedBy=default.target
`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, unit, { mode: 0o644 });
    return {
      path,
      kind: 'systemd',
      instructions: ['systemctl --user daemon-reload', `systemctl --user enable --now ${BRAND.cliName}-gateway.service`],
    };
  }

  const path = appHomePath('gateway', `${BRAND.cliName}-gateway.cmd`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${quoteCmdArg(command)} ${quoteCmdArg(script)} gateway run\r\n`, { mode: 0o700 });
  return {
    path,
    kind: 'cmd',
    instructions: [`Run ${path} from your preferred Windows service manager or Task Scheduler.`],
  };
}

export async function uninstallGatewayService(): Promise<string[]> {
  const paths = [
    join(homedir(), 'Library', 'LaunchAgents', `com.${BRAND.cliName}.gateway.plist`),
    join(homedir(), '.config', 'systemd', 'user', `${BRAND.cliName}-gateway.service`),
    appHomePath('gateway', `${BRAND.cliName}-gateway.cmd`),
  ];
  const removed: string[] = [];
  for (const path of paths) {
    try {
      await rm(path, { force: true });
      removed.push(path);
    } catch {
      /* best effort */
    }
  }
  return removed;
}
