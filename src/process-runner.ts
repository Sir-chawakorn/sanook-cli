import { spawn } from 'node:child_process';
import { clamp } from './tools/util.js';

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'TERM', 'NODE_PATH', 'NVM_DIR', 'APPDATA'];
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

export interface ProcessRunOptions {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  maxBuffer?: number;
}

export interface ProcessRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  truncated: boolean;
  error?: string;
}

export function safeProcessEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = env[key];
    if (value != null) out[key] = value;
  }
  return out;
}

function appendChunk(chunks: Buffer[], chunk: Buffer, state: { bytes: number; truncated: boolean }, maxBuffer: number): void {
  if (state.bytes >= maxBuffer) {
    state.truncated = true;
    return;
  }
  const remaining = maxBuffer - state.bytes;
  const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
  chunks.push(kept);
  state.bytes += kept.length;
  if (kept.length < chunk.length) state.truncated = true;
}

export function runProcess(file: string, args: string[], options: ProcessRunOptions = {}): Promise<ProcessRunResult> {
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 120_000, 300_000));
  const maxBuffer = Math.max(1, options.maxBuffer ?? DEFAULT_MAX_BUFFER);
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdoutState = { bytes: 0, truncated: false };
  const stderrState = { bytes: 0, truncated: false };

  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: safeProcessEnv(),
      shell: false,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 1_000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => appendChunk(stdoutChunks, chunk, stdoutState, maxBuffer));
    child.stderr.on('data', (chunk: Buffer) => appendChunk(stderrChunks, chunk, stderrState, maxBuffer));
    child.on('error', (err) => {
      clearTimeout(timer);
      settled = true;
      resolve({
        ok: false,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        code: null,
        signal: null,
        timedOut,
        truncated: stdoutState.truncated || stderrState.truncated,
        error: err.message,
      });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      settled = true;
      resolve({
        ok: code === 0 && !timedOut,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        code,
        signal,
        timedOut,
        truncated: stdoutState.truncated || stderrState.truncated,
      });
    });
    if (options.input != null) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

export function formatProcessResult(result: ProcessRunResult): string {
  const body = (result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')).trim();
  const truncated = result.truncated ? '\n... [process output truncated]' : '';
  if (result.ok) return clamp(`${body}${truncated}`.trim()) || '(no output)';
  const status = result.timedOut
    ? 'timeout'
    : result.error
      ? result.error
      : `exit ${result.code ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}`;
  return clamp(`ERROR: process failed — ${status}${body ? `\n${body}` : ''}${truncated}`);
}
