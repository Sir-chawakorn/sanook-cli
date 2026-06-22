import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('./bin.ts', import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx');
const tempDirs: string[] = [];

async function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const home = await mkdtemp(join(tmpdir(), 'sanook-help-cli-home-'));
  const project = await mkdtemp(join(tmpdir(), 'sanook-help-cli-project-'));
  tempDirs.push(home, project);

  const child = spawn(process.execPath, ['--import', tsx, bin, ...args], {
    cwd: project,
    env: {
      ...process.env,
      CI: '1',
      HOME: home,
      NO_COLOR: '1',
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

afterEach(async () => {
  while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe('top-level CLI help', () => {
  it('documents usage ledger range filters', async () => {
    const result = await runCli(['--help']);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'sanook usage [daily|weekly|monthly|session] [--days N] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json]',
    );
  });
});
