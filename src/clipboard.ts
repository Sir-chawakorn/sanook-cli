import { spawn, type ChildProcess } from 'node:child_process';

export interface ClipboardCopyResult {
  detail: string;
  method: 'osc52' | 'system';
}

type SpawnFn = typeof spawn;
type WriteCommand = { args: string[]; command: string; stdin: boolean };

const OSC52_MAX_CHARS = 100_000;

function powershellSetClipboardScript(text: string): string {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  return `Set-Clipboard -Value ([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}')))`;
}

function clipboardWriteCommands(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): WriteCommand[] {
  if (platform === 'darwin') return [{ args: [], command: 'pbcopy', stdin: true }];
  if (platform === 'win32') return [{ args: ['-NoProfile', '-NonInteractive'], command: 'powershell', stdin: false }];

  const commands: WriteCommand[] = [];
  if (env.WSL_INTEROP || env.WSL_DISTRO_NAME) {
    commands.push({ args: ['-NoProfile', '-NonInteractive'], command: 'powershell.exe', stdin: false });
  }
  if (env.WAYLAND_DISPLAY) commands.push({ args: ['--type', 'text/plain'], command: 'wl-copy', stdin: true });
  commands.push({ args: ['-selection', 'clipboard', '-in'], command: 'xclip', stdin: true });
  commands.push({ args: ['--clipboard', '--input'], command: 'xsel', stdin: true });
  return commands;
}

function runClipboardCommand(command: WriteCommand, text: string, start: SpawnFn): Promise<boolean> {
  return new Promise((resolve) => {
    const args = command.stdin ? command.args : [...command.args, '-Command', powershellSetClipboardScript(text)];
    let child: ChildProcess;
    try {
      child = start(command.command, args, { stdio: command.stdin ? ['pipe', 'ignore', 'ignore'] : ['ignore', 'ignore', 'ignore'], windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
    if (command.stdin) child.stdin?.end(text);
  });
}

export async function writeSystemClipboard(
  text: string,
  options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; spawn?: SpawnFn } = {},
): Promise<string | null> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const start = options.spawn ?? spawn;
  for (const command of clipboardWriteCommands(platform, env)) {
    if (await runClipboardCommand(command, text, start)) return command.command;
  }
  return null;
}

export function osc52Sequence(text: string): string {
  const safe = text.length > OSC52_MAX_CHARS ? text.slice(0, OSC52_MAX_CHARS) : text;
  return `\u001b]52;c;${Buffer.from(safe, 'utf8').toString('base64')}\u0007`;
}

export async function copyTextToClipboard(
  text: string,
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    spawn?: SpawnFn;
    writeOsc52?: (sequence: string) => boolean | void;
  } = {},
): Promise<ClipboardCopyResult> {
  const payload = text.trimEnd();
  if (!payload.trim()) throw new Error('ไม่มีข้อความให้ copy');

  const backend = await writeSystemClipboard(payload, options);
  if (backend) return { detail: backend, method: 'system' };

  if (options.writeOsc52) {
    options.writeOsc52(osc52Sequence(payload));
    return { detail: 'OSC52', method: 'osc52' };
  }

  throw new Error('ไม่พบ clipboard backend และไม่มี OSC52 output');
}
