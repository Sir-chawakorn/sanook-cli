import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('./bin.ts', import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx');
const homes: string[] = [];
const projects: string[] = [];

async function runCli(args: string[], cwd: string, home: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ['--import', tsx, bin, ...args], {
    cwd,
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
  const home = mkdtempSync(join(tmpdir(), 'sanook-init-cli-home-'));
  homes.push(home);
  return home;
}

function tempProject(): string {
  const project = mkdtempSync(join(tmpdir(), 'sanook-init-cli-project-'));
  writeFileSync(join(project, 'package.json'), '{}');
  projects.push(project);
  return project;
}

afterEach(() => {
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
  while (projects.length) rmSync(projects.pop()!, { recursive: true, force: true });
});

describe('init + skill install CLI', () => {
  it('sanook init scaffolds commands and prints onboarding hints', async () => {
    const home = tempHome();
    const project = tempProject();
    const result = await runCli(['init'], project, home);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('initialized');
    expect(result.stdout).toContain('.sanook/commands/review.md');
    expect(result.stdout).toContain('mcp preset dev');
    expect(existsSync(join(project, '.sanook', 'commands', 'plan.md'))).toBe(true);
  });

  it('sanook skill install copies a bundled skill', async () => {
    const home = tempHome();
    const project = tempProject();
    const result = await runCli(['skill', 'install', 'write-tests'], project, home);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('write-tests');
    expect(existsSync(join(home, '.sanook', 'skills', 'write-tests', 'SKILL.md'))).toBe(true);
  });
});
