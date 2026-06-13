import { open, unlink, readFile } from 'node:fs/promises';

// advisory file lock ผ่าน O_EXCL lockfile + stale detection (pid ตาย → ยึด lock ต่อ)
// กัน lost-write จากหลาย writer (server enqueue / scheduler update / cron CLI) ที่ยิงไฟล์เดียวกัน
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** lock ค้างจาก process ที่ตายไปแล้วไหม (อ่าน pid → process.kill(pid,0)) */
async function isStale(lockPath: string): Promise<boolean> {
  try {
    const pid = parseInt((await readFile(lockPath, 'utf8')).trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return true; // pid พัง = stale
    try {
      process.kill(pid, 0); // ไม่ส่ง signal จริง แค่เช็คว่ามี process นี้
      return false; // ยัง alive
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ESRCH'; // ESRCH = ไม่มี process นี้ → stale
    }
  } catch {
    return false; // อ่าน lock ไม่ได้ (อาจเพิ่งถูกลบ) → ไม่ถือว่า stale
  }
}

/** ทำ fn ภายใต้ exclusive lock — serialize read-modify-write กันชนกัน */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, retries = 200): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      const fh = await open(lockPath, 'wx'); // O_EXCL — fail ถ้า lock มีอยู่
      await fh.writeFile(String(process.pid));
      await fh.close();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (await isStale(lockPath)) {
        await unlink(lockPath).catch(() => {});
        continue; // ยึด stale lock แล้วลองใหม่ทันที
      }
      await sleep(10 + i); // มี writer อื่นถืออยู่ — รอ backoff
      continue;
    }
    try {
      return await fn();
    } finally {
      await unlink(lockPath).catch(() => {});
    }
  }
  throw new Error(`lock timeout: ${lockPath}`);
}

/**
 * ยึด lock ระยะยาว (singleton process เช่น gateway) — ไม่ release จนกว่าจะเรียก release fn
 * คืน release() ถ้าได้ lock, null ถ้ามี instance อื่น alive ถืออยู่
 */
export async function acquireSingleton(lockPath: string): Promise<(() => Promise<void>) | null> {
  for (;;) {
    try {
      const fh = await open(lockPath, 'wx');
      await fh.writeFile(String(process.pid));
      await fh.close();
      return async () => {
        await unlink(lockPath).catch(() => {});
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (await isStale(lockPath)) {
        await unlink(lockPath).catch(() => {});
        continue; // stale → ยึดต่อ
      }
      return null; // instance อื่น alive
    }
  }
}
