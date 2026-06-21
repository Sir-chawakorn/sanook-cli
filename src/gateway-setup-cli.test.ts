import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('./bin.ts', import.meta.url));
const homes: string[] = [];

async function runCli(args: string[], home: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', bin, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CI: '1',
      HOME: home,
      SANOOK_DISABLE_UPDATE_CHECK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out: ${args.join(' ')}`));
    }, 12_000);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode);
    });
  });

  return { code, stdout, stderr };
}

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'sanook-gateway-setup-cli-'));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

describe('gateway setup CLI', () => {
  it('rejects missing required split option values without consuming the next flag', async () => {
    const home = tempHome();
    const result = await runCli(['gateway', 'setup', 'ntfy', '--topic', '--allow-all-users'], home);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('gateway setup ntfy --topic <topic>');
    expect(existsSync(join(home, '.sanook', 'gateway', 'config.json'))).toBe(false);
  });

  it('preserves single-dash values for gateway setup secrets', async () => {
    const home = tempHome();
    const result = await runCli(
      ['gateway', 'setup', 'ntfy', '--topic', 'sanook-topic', '--token', '-tk_secret', '--allow-all-users'],
      home,
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('บันทึก ntfy gateway config แล้ว');

    const raw = await readFile(join(home, '.sanook', 'gateway', 'config.json'), 'utf8');
    const config = JSON.parse(raw) as { ntfy?: { token?: string; topic?: string; allowAllUsers?: boolean } };
    expect(config.ntfy).toMatchObject({
      token: '-tk_secret',
      topic: 'sanook-topic',
      allowAllUsers: true,
    });
  });

  it('rejects non-decimal port values for email setup', async () => {
    const home = tempHome();
    const result = await runCli(
      [
        'gateway',
        'setup',
        'email',
        '--address',
        'bot@example.com',
        '--password',
        'app-password',
        '--imap-host',
        'imap.example.com',
        '--smtp-host',
        'smtp.example.com',
        '--home-address',
        'owner@example.com',
        '--imap-port',
        '1e3',
      ],
      home,
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('imap port ต้องเป็น port 1-65535');
    expect(existsSync(join(home, '.sanook', 'gateway', 'config.json'))).toBe(false);
  });

  it('reports non-port email numeric settings as integers', async () => {
    const home = tempHome();
    const result = await runCli(
      [
        'gateway',
        'setup',
        'email',
        '--address',
        'bot@example.com',
        '--password',
        'app-password',
        '--imap-host',
        'imap.example.com',
        '--smtp-host',
        'smtp.example.com',
        '--home-address',
        'owner@example.com',
        '--poll-interval',
        '1e3',
      ],
      home,
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('poll interval ต้องเป็น integer 1-65535');
    expect(existsSync(join(home, '.sanook', 'gateway', 'config.json'))).toBe(false);
  });
});
