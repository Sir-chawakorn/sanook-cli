import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join, resolve, delimiter } from 'node:path';
import { BRAND } from './brand.js';

const execFileP = promisify(execFile);

export interface DoctorReport {
  node: string;
  nodeOk: boolean;
  binDir: string; // npm global bin dir (where the `sanook` shim lands on -g install)
  globalInstalled: boolean; // shim present in binDir
  onPath: boolean; // binDir is on PATH → bare `sanook` resolves
  localInstall: boolean; // a local node_modules/.bin/sanook exists in cwd
  isWin: boolean;
}

function normDir(d: string): string {
  try {
    const r = resolve(d).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? r.toLowerCase() : r; // Windows PATH is case-insensitive
  } catch {
    return process.platform === 'win32' ? d.toLowerCase() : d;
  }
}

/** binDir อยู่ใน PATH ไหม — normalize (ตัด trailing slash, case-insensitive บน Windows) ก่อนเทียบ */
export function isOnPath(binDir: string, pathEnv: string | undefined): boolean {
  if (!binDir) return false;
  const target = normDir(binDir);
  return (pathEnv ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map(normDir)
    .includes(target);
}

/** เก็บข้อมูลการติดตั้งจริงจากเครื่อง (Node version, npm global bin, shim, PATH, local install) */
export async function diagnose(): Promise<DoctorReport> {
  const isWin = process.platform === 'win32';
  const major = Number(process.versions.node.split('.')[0]);
  let prefix = '';
  try {
    // Windows: npm = npm.cmd → ต้อง shell:true ไม่งั้น ENOENT
    prefix = (await execFileP('npm', ['config', 'get', 'prefix'], { shell: isWin })).stdout.trim();
  } catch {
    /* npm หาไม่เจอใน PATH */
  }
  // global bin: บน Windows = prefix เอง (มี npx.cmd อยู่ตรงนั้น), บน Unix = prefix/bin
  const binDir = prefix ? (isWin ? prefix : join(prefix, 'bin')) : '';
  const shimNames = isWin ? [`${BRAND.cliName}.cmd`, `${BRAND.cliName}.ps1`, BRAND.cliName] : [BRAND.cliName];
  const globalInstalled = !!binDir && shimNames.some((s) => existsSync(join(binDir, s)));
  const localInstall = shimNames.some((s) => existsSync(join(process.cwd(), 'node_modules', '.bin', s)));
  return {
    node: process.version,
    nodeOk: Number.isFinite(major) && major >= 22,
    binDir,
    globalInstalled,
    onPath: isOnPath(binDir, process.env.PATH),
    localInstall,
    isWin,
  };
}

/** รายงาน + วิธีแก้ที่ปลอดภัยต่อ OS (ไม่ใช้ setx %PATH% ซึ่งเป็น footgun ตัด PATH 1024 ตัว) */
export function formatReport(r: DoctorReport, pkgName: string): string {
  const ok = (b: boolean): string => (b ? '✓' : '✗');
  const lines: string[] = [
    `${BRAND.productName} doctor — ตรวจการติดตั้ง`,
    '',
    `  ${ok(r.nodeOk)} Node ${r.node}${r.nodeOk ? '' : '  ← ต้อง ≥ 22 (อัปเดตที่ https://nodejs.org)'}`,
    `  ${ok(!!r.binDir)} npm global bin: ${r.binDir || '(หาไม่เจอ — npm อยู่ใน PATH ไหม?)'}`,
    `  ${ok(r.globalInstalled)} ติดตั้ง global "${BRAND.cliName}": ${r.globalInstalled ? 'ใช่' : 'ยัง'}`,
    `  ${ok(r.onPath)} bin อยู่ใน PATH: ${r.onPath ? 'ใช่' : 'ไม่'}`,
  ];
  if (r.localInstall) lines.push(`  ℹ เจอ local install ที่โฟลเดอร์นี้ → ใช้ได้เลยด้วย: npx ${BRAND.cliName}`);

  lines.push('', 'สรุป:');
  if (r.globalInstalled && r.onPath) {
    lines.push(`  ✅ พร้อมใช้ — พิมพ์ "${BRAND.cliName}" ได้เลย (ยังไม่เจอ? ปิด-เปิด terminal ใหม่)`);
    return lines.join('\n');
  }
  if (!r.globalInstalled) {
    lines.push(`  • ลงแบบ global:  npm install -g ${pkgName}   →  แล้วพิมพ์ "${BRAND.cliName}" ได้`);
  }
  if (r.globalInstalled && !r.onPath && r.binDir) {
    if (r.isWin) {
      lines.push('  • bin ไม่อยู่ใน PATH — เพิ่มเข้า user PATH (วางใน PowerShell · ปลอดภัย แก้เฉพาะ user):');
      lines.push(
        `      [Environment]::SetEnvironmentVariable('Path',[Environment]::GetEnvironmentVariable('Path','User')+';${r.binDir}','User')`,
      );
      lines.push('    แล้วปิด-เปิด terminal ใหม่');
    } else {
      const rc = process.env.SHELL?.includes('zsh') ? '~/.zshrc' : '~/.bashrc';
      lines.push(`  • bin ไม่อยู่ใน PATH — เพิ่มใน ${rc}:  export PATH="$PATH:${r.binDir}"  (แล้วเปิด shell ใหม่)`);
    }
  }
  if (r.localInstall) lines.push(`  • หรือใช้ทันทีโดยไม่แก้ PATH:  npx ${BRAND.cliName}`);
  return lines.join('\n');
}

export async function runDoctor(pkgName: string): Promise<string> {
  return formatReport(await diagnose(), pkgName);
}
