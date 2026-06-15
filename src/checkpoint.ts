import { runGit, isGitRepo } from './git.js';

// checkpoint/rewind — snapshot working tree ก่อนแต่ละ turn แล้ว /rewind กลับได้ (ไฟล์ + บทสนทนา)
// ปลอดภัย: restore จะ stash ของปัจจุบันก่อนเสมอ (กู้คืนด้วย git stash pop) → ไม่มีอะไรหายถาวร
// ข้อจำกัด: ครอบเฉพาะ tracked files (เหมือน /undo) และต้องเป็น git repo

export interface Checkpoint {
  /** git ref ของ snapshot — sha จาก stash create (มีการแก้) หรือ HEAD sha ที่ pin (tree clean) */
  ref: string;
  /** จำนวน message ใน conversation ตอน snapshot (สำหรับตัดบทสนทนากลับ) */
  msgLen: number;
  /** จำนวน turn ที่ผู้ใช้เห็น (สำหรับตัด UI history) */
  turnLen: number;
}

/** snapshot working tree แบบไม่แตะอะไร (git stash create) — คืน ref หรือ null ถ้าไม่ใช่ git repo */
export async function snapshotWorkTree(cwd: string = process.cwd()): Promise<string | null> {
  if (!(await isGitRepo(cwd))) return null;
  try {
    const sha = (await runGit(['stash', 'create'], cwd)).trim();
    if (sha) return sha;
    // working tree clean → pin HEAD SHA จริง (ถ้าใช้ 'HEAD' lazy แล้ว HEAD ขยับ เช่นมี commit ระหว่างนั้น = restore ผิด)
    const head = (await runGit(['rev-parse', 'HEAD'], cwd)).trim();
    return head || null;
  } catch {
    return null;
  }
}

export interface RestoreResult {
  ok: boolean;
  recovery?: string; // คำสั่งกู้คืน (ถ้ามีการ stash ของปัจจุบันไว้)
  reason?: string;
}

/** restore tracked files กลับสู่ snapshot — stash ของปัจจุบันก่อน (recoverable) */
export async function restoreWorkTree(ref: string, cwd: string = process.cwd()): Promise<RestoreResult> {
  if (!(await isGitRepo(cwd))) return { ok: false, reason: 'ไม่ใช่ git repo' };
  try {
    // safety: เก็บสถานะปัจจุบันเข้า stash ก่อน (กู้คืนได้ด้วย git stash pop)
    const current = (await runGit(['stash', 'create'], cwd)).trim();
    let recovery: string | undefined;
    if (current) {
      await runGit(['stash', 'store', '-m', 'sanook /rewind backup', current], cwd);
      recovery = 'git stash pop';
    }
    // restore: ให้ index + worktree ตรงกับ snapshot (ลบ tracked files ที่ถูกเพิ่มหลัง snapshot ด้วย)
    await runGit(['restore', `--source=${ref}`, '--staged', '--worktree', '.'], cwd);
    return { ok: true, recovery };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
