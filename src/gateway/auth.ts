import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const GATEWAY_DIR = join(homedir(), '.sanook', 'gateway');
const TOKEN_FILE = join(GATEWAY_DIR, 'token');

/** โหลด bearer token ของ gateway; ไม่มี → สร้าง 256-bit ใหม่ เก็บ chmod 600 */
export async function loadOrCreateToken(): Promise<string> {
  try {
    const t = (await readFile(TOKEN_FILE, 'utf8')).trim();
    if (t) return t;
  } catch {
    /* ยังไม่มี → สร้างใหม่ */
  }
  const token = randomBytes(32).toString('hex');
  await mkdir(GATEWAY_DIR, { recursive: true });
  await writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
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
