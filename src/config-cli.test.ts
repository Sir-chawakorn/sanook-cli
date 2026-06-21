import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('./bin.ts', import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx');

async function runCli(args: string[], cwd: string, home: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ['--import', tsx, bin, ...args], {
    cwd,
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

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe('config CLI', () => {
  it('trims scalar config values before validation and storage', async () => {
    const home = await tempDir('sanook-config-cli-home-');
    const project = await tempDir('sanook-config-cli-project-');

    await expect(runCli(['config', 'set', 'maxSteps', ' 12 '], project, home)).resolves.toMatchObject({ code: 0 });
    await expect(runCli(['config', 'set', 'cacheTtl', ' 1h '], project, home)).resolves.toMatchObject({ code: 0 });
    await expect(runCli(['config', 'set', 'compaction', ' summarize '], project, home)).resolves.toMatchObject({ code: 0 });
    await expect(runCli(['config', 'set', 'summaryModel', ' haiku '], project, home)).resolves.toMatchObject({ code: 0 });

    const raw = await readFile(join(home, '.sanook', 'config.json'), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({
      maxSteps: 12,
      cacheTtl: '1h',
      compaction: 'summarize',
      summaryModel: 'haiku',
    });
  });

  it('rejects non-decimal maxSteps values', async () => {
    const home = await tempDir('sanook-config-cli-home-');
    const project = await tempDir('sanook-config-cli-project-');

    await expect(runCli(['config', 'set', 'maxSteps', '0x10'], project, home)).resolves.toMatchObject({ code: 1 });
    await expect(runCli(['config', 'set', 'maxSteps', '1e3'], project, home)).resolves.toMatchObject({ code: 1 });
  });
});
