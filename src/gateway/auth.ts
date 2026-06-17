import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appHomePath } from '../brand.js';

const GATEWAY_DIR = appHomePath('gateway');
const TOKEN_FILE = join(GATEWAY_DIR, 'token');
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export async function ensureGatewayDir(): Promise<void> {
  await mkdir(GATEWAY_DIR, { recursive: true, mode: 0o700 });
  await chmod(GATEWAY_DIR, 0o700).catch(() => {});
}

/** โหลด bearer token ของ gateway; ไม่มี → สร้าง 256-bit ใหม่ เก็บ chmod 600 */
export async function loadOrCreateToken(): Promise<string> {
  for (;;) {
    const existingToken = await readTokenIfPresent();
    if (existingToken !== undefined) return existingToken;

    const token = randomBytes(32).toString('hex');
    await ensureGatewayDir();
    try {
      await writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600, flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw new Error(`ไม่สามารถเขียน gateway token ที่ ${TOKEN_FILE}: ${(e as Error).message}`);
    }
    await chmod(TOKEN_FILE, 0o600).catch(() => {});
    return token;
  }
}

async function readTokenIfPresent(): Promise<string | undefined> {
  let rawToken: string;
  try {
    rawToken = await readFile(TOKEN_FILE, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`ไม่สามารถอ่าน gateway token ที่ ${TOKEN_FILE}: ${(e as Error).message}`);
    }
    return undefined;
  }

  const token = rawToken.trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error(`gateway token ที่ ${TOKEN_FILE} ไม่ถูกต้อง: ต้องเป็น hex 64 ตัวอักษร`);
  }
  await chmod(GATEWAY_DIR, 0o700).catch(() => {});
  await chmod(TOKEN_FILE, 0o600).catch(() => {});
  return token;
}

/** constant-time compare กัน timing attack (length เทียบก่อนเพราะ timingSafeEqual ต้อง len เท่ากัน) */
export function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
