import { open, unlink, readFile, rename, stat } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';

// advisory file lock ผ่าน O_EXCL lockfile — กัน lost-write จากหลาย writer (server/scheduler/CLI) ยิงไฟล์เดียว
// robustness (จาก adversarial re-review): TTL กัน pid-reuse deadlock · rename-evict ลด TOCTOU · fh-safe acquire
// หมายเหตุ: นี่คือ best-effort lock สำหรับ single-user local — ไม่ใช่ distributed lock; residual TOCTOU window
// แคบมาก (ต้องมี 2 mutator พร้อมกัน + holder ตายเป๊ะจังหวะ) ซึ่งแทบเป็นไปไม่ได้ใน workload นี้
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const LOCK_TTL_MS = 5 * 60_000; // mutate สั้นระดับ ms — lock เก่ากว่านี้ = ค้างแน่ → ยึดได้ (กัน pid-reuse deadlock)
const LOCK_WRITE_GRACE_MS = 1_000; // open('wx') สร้างไฟล์ก่อนเขียน pid; อย่า evict lock สดที่ยังเขียนไม่จบ

/** holder ตายไหม — เช็คจาก pid อย่างเดียว (ใช้กับ singleton ที่ถือยาว, ไม่มี TTL) */
async function holderDead(lockPath: string): Promise<boolean> {
  try {
    const st = await stat(lockPath);
    const pid = parseInt((await readFile(lockPath, 'utf8')).trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return Date.now() - st.mtimeMs > LOCK_WRITE_GRACE_MS; // pid ยังไม่ถูกเขียน/พัง → รอ grace สั้นๆ ก่อนยึด
    try {
      process.kill(pid, 0); // เช็คว่ามี process นี้ (ไม่ส่ง signal จริง)
      return false;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ESRCH'; // ไม่มี process → ตาย
    }
  } catch {
    return false; // อ่าน lock ไม่ได้ (อาจเพิ่งถูกย้าย) → ยังไม่ถือว่า stale
  }
}

/** สำหรับ mutate lock (สั้น): pid ตาย OR lock เก่าเกิน TTL (กัน pid-reuse ทำ deadlock ถาวร) */
async function expiredOrDead(lockPath: string): Promise<boolean> {
  try {
    const st = await stat(lockPath);
    if (Date.now() - st.mtimeMs > LOCK_TTL_MS) return true; // อายุเกิน TTL → stale แน่
  } catch {
    return false; // ไม่มีไฟล์แล้ว
  }
  return holderDead(lockPath);
}

/** ยึด stale lock แบบ atomic: rename ออกก่อน (winner เดียวที่ rename สำเร็จ) แล้วลบ tomb — ไม่ unlink path ตรงๆ */
async function evict(lockPath: string): Promise<void> {
  const tomb = `${lockPath}.tomb.${process.pid}`;
  try {
    await rename(lockPath, tomb); // atomic — ถ้าคนอื่น evict ไปก่อน rename จะ ENOENT
    await unlink(tomb).catch(() => {});
  } catch {
    /* คนอื่นชิง evict ไปแล้ว — ไม่ทำอะไร */
  }
}

/** สร้าง lockfile แบบ fh-safe (writeFile/close throw → close fd + ลบ lock ที่ตัวเองสร้าง ไม่ทิ้ง orphan) */
async function tryCreate(lockPath: string): Promise<boolean> {
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(lockPath, 'wx'); // O_EXCL — fail ถ้ามีอยู่
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
  try {
    await fh.writeFile(String(process.pid));
  } catch (e) {
    await fh.close().catch(() => {});
    await unlink(lockPath).catch(() => {}); // ลบ orphan ที่ตัวเองสร้าง
    throw e;
  }
  await fh.close().catch(() => {});
  return true;
}

const backoff = (i: number): number => Math.min(250, 10 * 2 ** Math.min(i, 5)) + Math.floor(Math.random() * 20);

/** ทำ fn ภายใต้ exclusive lock — serialize read-modify-write. capped-exponential backoff + jitter */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, retries = 300): Promise<T> {
  for (let i = 0; i < retries; i++) {
    if (await tryCreate(lockPath)) {
      try {
        return await fn();
      } finally {
        await unlink(lockPath).catch(() => {});
      }
    }
    if (await expiredOrDead(lockPath)) {
      await evict(lockPath);
      continue; // ลองยึดทันที
    }
    await sleep(backoff(i)); // มี writer อื่น alive ถืออยู่
  }
  throw new Error(`lock timeout: ${lockPath}`);
}

/**
 * ยึด lock ระยะยาว (singleton เช่น gateway) — fail-safe: pid-reuse → ถือว่า busy (ปฏิเสธ start ดีกว่ารัน 2 ตัว)
 * คืน release() แบบ sync (unlinkSync) เพื่อให้ปล่อย lock ทันก่อน process.exit, หรือ null ถ้ามี instance อื่น alive
 */
export async function acquireSingleton(lockPath: string): Promise<(() => void) | null> {
  for (;;) {
    if (await tryCreate(lockPath)) {
      return () => {
        try {
          unlinkSync(lockPath); // sync — เสร็จก่อน process.exit ตัด event loop
        } catch {
          /* ลบไปแล้ว */
        }
      };
    }
    if (await holderDead(lockPath)) {
      await evict(lockPath);
      continue; // stale → ยึดต่อ
    }
    return null; // instance อื่น alive
  }
}
