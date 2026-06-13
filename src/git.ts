import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// git helper — execFile('git', args[]) ไม่ผ่าน shell (บทเรียนจาก grep RCE: ไม่ interpolate เข้า shell string)
export async function runGit(args: string[], cwd = process.cwd()): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

export async function isGitRepo(cwd = process.cwd()): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
    return true;
  } catch {
    return false;
  }
}

/** git context สำหรับ system prompt — agent รู้ branch + uncommitted + commit ล่าสุด อัตโนมัติ */
export async function gitContext(cwd = process.cwd()): Promise<string> {
  try {
    const [branch, status, log] = await Promise.all([
      runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).catch(() => ''),
      runGit(['status', '--porcelain'], cwd).catch(() => ''),
      runGit(['log', '--oneline', '-5'], cwd).catch(() => ''),
    ]);
    if (!branch.trim() && !log.trim()) return ''; // ไม่ใช่ git repo (หรือ repo เปล่า)
    const dirty = status.trim() ? status.trim().split('\n').filter(Boolean) : [];
    const lines = [
      `branch: ${branch.trim() || '(detached)'}`,
      dirty.length ? `uncommitted: ${dirty.length} file(s)` : 'working tree clean',
    ];
    if (log.trim()) {
      lines.push(`recent commits:\n${log.trim().split('\n').map((l) => `  ${l}`).join('\n')}`);
    }
    return `<git_context note="สถานะ repo ปัจจุบัน">\n${lines.join('\n')}\n</git_context>`;
  } catch {
    return '';
  }
}
