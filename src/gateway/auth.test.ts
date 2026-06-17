import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { tokenMatches } from './auth.js';

const tempHomes: string[] = [];

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'sanook-gateway-auth-'));
  tempHomes.push(home);
  return home;
}

async function importAuthWithHome(home: string): Promise<typeof import('./auth.js')> {
  vi.resetModules();
  vi.stubEnv('HOME', home);
  return import('./auth.js');
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(tempHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('tokenMatches (constant-time)', () => {
  const tok = 'a'.repeat(64);
  it('token ตรง → true', () => expect(tokenMatches(tok, tok)).toBe(true));
  it('token ผิด (len เท่า) → false', () => expect(tokenMatches(tok, 'b'.repeat(64))).toBe(false));
  it('length ต่าง → false', () => expect(tokenMatches(tok, 'a'.repeat(32))).toBe(false));
  it('undefined → false', () => expect(tokenMatches(tok, undefined)).toBe(false));
  it('empty string → false', () => expect(tokenMatches(tok, '')).toBe(false));
});

describe('loadOrCreateToken', () => {
  it('creates a 256-bit token and stores it with owner-only permissions', async () => {
    const home = await tempHome();
    const { loadOrCreateToken } = await importAuthWithHome(home);

    const token = await loadOrCreateToken();
    const gatewayPath = join(home, '.sanook', 'gateway');
    const tokenPath = join(gatewayPath, 'token');

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(tokenPath, 'utf8')).toBe(`${token}\n`);
    if (process.platform !== 'win32') {
      expect((await stat(gatewayPath)).mode & 0o777).toBe(0o700);
      expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
    }
    await expect(loadOrCreateToken()).resolves.toBe(token);
  });

  it('returns the stored token for concurrent first-time loads', async () => {
    const home = await tempHome();
    const { loadOrCreateToken } = await importAuthWithHome(home);

    const tokens = await Promise.all(Array.from({ length: 12 }, () => loadOrCreateToken()));
    const tokenPath = join(home, '.sanook', 'gateway', 'token');

    expect(new Set(tokens).size).toBe(1);
    expect(await readFile(tokenPath, 'utf8')).toBe(`${tokens[0]}\n`);
  });

  it('reuses an existing token while tightening loose permissions', async () => {
    const home = await tempHome();
    const gatewayPath = join(home, '.sanook', 'gateway');
    const tokenPath = join(gatewayPath, 'token');
    const token = 'b'.repeat(64);
    await mkdir(gatewayPath, { recursive: true });
    await chmod(gatewayPath, 0o755);
    await writeFile(tokenPath, `${token}\n`, { mode: 0o644 });
    await chmod(tokenPath, 0o644);

    const { loadOrCreateToken } = await importAuthWithHome(home);

    await expect(loadOrCreateToken()).resolves.toBe(token);
    if (process.platform !== 'win32') {
      expect((await stat(gatewayPath)).mode & 0o777).toBe(0o700);
      expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('accepts an existing token with CRLF line endings', async () => {
    const home = await tempHome();
    const gatewayPath = join(home, '.sanook', 'gateway');
    const tokenPath = join(gatewayPath, 'token');
    const token = 'f'.repeat(64);
    await mkdir(gatewayPath, { recursive: true });
    await writeFile(tokenPath, `${token}\r\n`, { mode: 0o600 });

    const { loadOrCreateToken } = await importAuthWithHome(home);

    await expect(loadOrCreateToken()).resolves.toBe(token);
    await expect(readFile(tokenPath, 'utf8')).resolves.toBe(`${token}\r\n`);
  });

  it('rejects malformed existing tokens instead of using or replacing them', async () => {
    const home = await tempHome();
    const gatewayPath = join(home, '.sanook', 'gateway');
    const tokenPath = join(gatewayPath, 'token');
    await mkdir(gatewayPath, { recursive: true });
    await writeFile(tokenPath, 'short-token\n', { mode: 0o600 });

    const { loadOrCreateToken } = await importAuthWithHome(home);

    await expect(loadOrCreateToken()).rejects.toThrow(/ต้องเป็น hex 64 ตัวอักษร/);
    await expect(readFile(tokenPath, 'utf8')).resolves.toBe('short-token\n');
  });

  it('rejects tokens with surrounding whitespace instead of silently trimming them', async () => {
    const home = await tempHome();
    const gatewayPath = join(home, '.sanook', 'gateway');
    const tokenPath = join(gatewayPath, 'token');
    const token = 'd'.repeat(64);
    await mkdir(gatewayPath, { recursive: true });
    await writeFile(tokenPath, ` ${token}\n`, { mode: 0o600 });

    const { loadOrCreateToken } = await importAuthWithHome(home);

    await expect(loadOrCreateToken()).rejects.toThrow(/ต้องเป็น hex 64 ตัวอักษร/);
    await expect(readFile(tokenPath, 'utf8')).resolves.toBe(` ${token}\n`);
  });

  it('rejects tokens with trailing spaces instead of silently trimming them', async () => {
    const home = await tempHome();
    const gatewayPath = join(home, '.sanook', 'gateway');
    const tokenPath = join(gatewayPath, 'token');
    const token = 'e'.repeat(64);
    await mkdir(gatewayPath, { recursive: true });
    await writeFile(tokenPath, `${token} \n`, { mode: 0o600 });

    const { loadOrCreateToken } = await importAuthWithHome(home);

    await expect(loadOrCreateToken()).rejects.toThrow(/ต้องเป็น hex 64 ตัวอักษร/);
    await expect(readFile(tokenPath, 'utf8')).resolves.toBe(`${token} \n`);
  });

  it('rejects an empty existing token file instead of replacing it', async () => {
    const home = await tempHome();
    const gatewayPath = join(home, '.sanook', 'gateway');
    const tokenPath = join(gatewayPath, 'token');
    await mkdir(gatewayPath, { recursive: true });
    await writeFile(tokenPath, '', { mode: 0o600 });

    const { loadOrCreateToken } = await importAuthWithHome(home);

    await expect(loadOrCreateToken()).rejects.toThrow(/ต้องเป็น hex 64 ตัวอักษร/);
    await expect(readFile(tokenPath, 'utf8')).resolves.toBe('');
  });

  it('surfaces token read errors instead of replacing the token', async () => {
    if (process.platform === 'win32') return;

    const home = await tempHome();
    const gatewayPath = join(home, '.sanook', 'gateway');
    const tokenPath = join(gatewayPath, 'token');
    const token = 'c'.repeat(64);
    await mkdir(gatewayPath, { recursive: true, mode: 0o700 });
    await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
    await chmod(tokenPath, 0o000);

    const { loadOrCreateToken } = await importAuthWithHome(home);

    await expect(loadOrCreateToken()).rejects.toThrow(/ไม่สามารถอ่าน gateway token/);
    await chmod(tokenPath, 0o600);
    await expect(readFile(tokenPath, 'utf8')).resolves.toBe(`${token}\n`);
  });
});
