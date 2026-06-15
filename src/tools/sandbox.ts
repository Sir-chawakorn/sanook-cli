import { platform, tmpdir } from 'node:os';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { getBrainPath } from '../memory.js';
import { BRAND_ENV, envFlag } from '../brand.js';

// OS-level sandbox สำหรับ run_bash — confine "write" ให้อยู่ใน workspace (cwd + brain + tmp)
// ให้สอดคล้องกับ file-tool ที่ confine อยู่แล้ว (bash เคยเป็นช่องโหว่). อ่าน/network = ปกติ (ไม่ break build/test)
//   macOS  → sandbox-exec (Seatbelt)      Linux → bwrap (bubblewrap) ถ้ามี
// ปิด: SANOOK_NO_SANDBOX=1 · SANOOK_ALLOW_OUTSIDE_WORKSPACE=1 (อนุญาตนอก workspace อยู่แล้ว = ไม่ sandbox)

function canon(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

function seatbeltProfile(writable: string[]): string {
  const allow = writable.map((w) => `  (subpath ${JSON.stringify(w)})`).join('\n');
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    '(allow file-write*',
    allow,
    '  (subpath "/dev")',
    '  (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))',
  ].join('\n');
}

function bwrapArgs(writable: string[], cmd: string): string[] {
  const binds = writable.flatMap((w) => ['--bind', w, w]);
  return ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', ...binds, '/bin/sh', '-c', cmd];
}

export interface SandboxExec {
  file: string;
  args: string[];
}

/**
 * คืน {file,args} สำหรับรัน cmd แบบ sandbox (ผ่าน execFile) — หรือ null ถ้าไม่มี sandbox/ปิดไว้
 * (caller รัน cmd ตรงๆ ตามเดิม). path ที่มี '"' → ข้าม sandbox (กัน profile พัง)
 */
export async function maybeSandbox(cmd: string, cwd: string = process.cwd()): Promise<SandboxExec | null> {
  if (envFlag(BRAND_ENV.allowOutsideWorkspace) || envFlag('SANOOK_NO_SANDBOX')) return null;

  const writable = [canon(cwd), canon(tmpdir())];
  const brain = await getBrainPath().catch(() => null);
  if (brain && existsSync(brain)) writable.push(canon(brain));
  if (writable.some((w) => w.includes('"'))) return null;

  const os = platform();
  if (os === 'darwin') {
    const bin = ['/usr/bin/sandbox-exec', '/usr/sbin/sandbox-exec'].find((p) => existsSync(p));
    if (!bin) return null;
    return { file: bin, args: ['-p', seatbeltProfile(writable), '/bin/sh', '-c', cmd] };
  }
  if (os === 'linux') {
    const bin = ['/usr/bin/bwrap', '/bin/bwrap'].find((p) => existsSync(p));
    if (!bin) return null;
    return { file: bin, args: bwrapArgs(writable, cmd) };
  }
  return null;
}
