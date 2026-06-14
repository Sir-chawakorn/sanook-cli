import { readFile, writeFile, mkdir, readdir, rm, stat, lstat, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, resolve, sep, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { parseFrontmatter, isValidSkillName } from './skills.js';
import { appHomePath, BRAND } from './brand.js';

const execFileAsync = promisify(execFile);
const USER_SKILLS = appHomePath('skills');
const MAX_FILES = 300;
const MAX_BYTES = 20 * 1024 * 1024; // 20MB ต่อ skill
const MAX_MD = 2 * 1024 * 1024; // 2MB ต่อ SKILL.md จาก URL

export interface InstallResult {
  name: string;
  path: string;
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

// ── safe copy: regular files เท่านั้น (skip symlink — กัน exfil escape), skip dotfiles/.git, cap ไฟล์+ขนาด ──
interface Budget {
  files: number;
  bytes: number;
}

async function copyTreeSafe(srcDir: string, destDir: string, budget: Budget, depth = 2): Promise<void> {
  if (depth < 0) return;
  let entries;
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // skip .git/dotfiles
    const s = join(srcDir, e.name);
    const st = await lstat(s);
    if (st.isSymbolicLink()) continue; // ห้าม copy symlink (กัน planted symlink หลุด ~/.sanook)
    if (st.isDirectory()) {
      await copyTreeSafe(s, join(destDir, e.name), budget, depth - 1);
    } else if (st.isFile()) {
      if (--budget.files < 0) throw new Error('skill มีไฟล์เยอะเกินไป');
      budget.bytes -= st.size;
      if (budget.bytes < 0) throw new Error('skill ใหญ่เกินไป (เกิน 20MB)');
      await mkdir(dirname(join(destDir, e.name)), { recursive: true });
      await copyFile(s, join(destDir, e.name));
    }
  }
}

/** copy skill dir (SKILL.md + references/scripts ที่เป็น regular file) → ~/.sanook/skills/<name> */
async function installFromDir(srcDir: string): Promise<InstallResult> {
  const md = join(srcDir, 'SKILL.md');
  const stMd = await lstat(md);
  if (stMd.isSymbolicLink() || !stMd.isFile()) throw new Error('SKILL.md ไม่ใช่ไฟล์ปกติ');
  const { meta } = parseFrontmatter(await readFile(md, 'utf8'));
  const name = meta.name || basename(srcDir);
  if (!isValidSkillName(name)) throw new Error(`ชื่อ skill ไม่ถูกต้อง: "${name}"`);
  const dest = join(USER_SKILLS, name);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await copyTreeSafe(srcDir, dest, { files: MAX_FILES, bytes: MAX_BYTES });
  return { name, path: dest };
}

/** เขียน SKILL.md เดียว (จาก URL) → ~/.sanook/skills/<name> */
async function installFromContent(content: string, fallbackName: string): Promise<InstallResult> {
  const { meta } = parseFrontmatter(content);
  const name = meta.name || fallbackName;
  if (!isValidSkillName(name)) throw new Error(`ชื่อ skill ไม่ถูกต้อง: "${name}"`);
  const dest = join(USER_SKILLS, name);
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, 'SKILL.md'), content);
  return { name, path: dest };
}

/** หา SKILL.md ใน dir (ตรงๆ, ทุก subdir, หรือ skills/ subdir) → ติดตั้งทั้งหมด */
async function installFromLocal(path: string, onLog?: (m: string) => void): Promise<InstallResult[]> {
  if (await exists(join(path, 'SKILL.md'))) return [await installFromDir(path)];
  const out: InstallResult[] = [];
  for (const root of [path, join(path, 'skills')]) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && (await exists(join(root, e.name, 'SKILL.md')))) {
        try {
          out.push(await installFromDir(join(root, e.name)));
        } catch (err) {
          onLog?.(`ข้าม ${e.name}: ${(err as Error).message}`); // skip ตัวที่ fail ติดตั้งที่เหลือต่อ
        }
      }
    }
  }
  if (!out.length) throw new Error(`ไม่เจอ SKILL.md ใน ${path} (รองรับ root, */SKILL.md, skills/*/SKILL.md)`);
  return out;
}

/** clone GitHub repo (shallow) → ติดตั้ง skill — subPath ต้องอยู่ใต้ clone dir (กัน traversal escape) */
async function installFromGitHub(repoUrl: string, subPath: string, onLog?: (m: string) => void): Promise<InstallResult[]> {
  const tmp = join(tmpdir(), `${BRAND.skillTempPrefix}${randomUUID().slice(0, 8)}`);
  try {
    onLog?.(`clone ${repoUrl} …`);
    // execFile (no shell) + '--' กัน url ขึ้นต้น '-' ถูกตีเป็น git option + timeout
    await execFileAsync('git', ['clone', '--depth', '1', '--quiet', '--', repoUrl, tmp], { timeout: 90_000 });
    // subPath traversal guard — target ต้องอยู่ใต้ tmp
    const target = subPath ? resolve(tmp, subPath) : tmp;
    if (subPath && target !== tmp && !target.startsWith(tmp + sep)) {
      throw new Error(`sub-path ไม่ปลอดภัย: ${subPath}`);
    }
    return await installFromLocal(target, onLog);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('ต้องติดตั้ง git ก่อนใช้ skill add จาก GitHub');
    }
    throw e;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fe80:|f[cd])/i;

/** fetch SKILL.md จาก URL — block internal/private (SSRF) + timeout + cap ขนาด */
async function fetchSkillMd(url: string): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('รองรับเฉพาะ https สำหรับ URL ของ SKILL.md');
  // resolve hostname → block private/loopback IP (กัน SSRF ยิง internal/cloud-metadata)
  let ip = u.hostname;
  if (!isIP(u.hostname)) {
    const res = await lookup(u.hostname).catch(() => null);
    ip = res?.address ?? '';
  }
  if (!ip || PRIVATE_IP.test(ip)) throw new Error(`URL ชี้ไป internal/private address — ปฏิเสธ (${u.hostname})`);
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`fetch ไม่สำเร็จ: HTTP ${r.status}`);
  if (Number(r.headers.get('content-length') ?? 0) > MAX_MD) throw new Error('SKILL.md ใหญ่เกิน 2MB');
  const text = await r.text();
  if (text.length > MAX_MD) throw new Error('SKILL.md ใหญ่เกิน 2MB');
  return text;
}

/**
 * ติดตั้ง skill จาก source — local path · URL ของ SKILL.md (https) · GitHub ("user/repo" หรือ "user/repo/sub/path")
 * ⚠️ skill = instruction ที่ agent จะ trust (ไม่ใช่ data) — ติดตั้งจาก source ที่เชื่อถือเท่านั้น
 */
export async function installSkill(source: string, onLog?: (m: string) => void): Promise<InstallResult[]> {
  if (await exists(source)) return installFromLocal(source, onLog);

  if (/^https?:\/\//.test(source)) {
    if (source.endsWith('.md')) {
      const parts = source.split('/');
      return [await installFromContent(await fetchSkillMd(source), parts[parts.length - 2] ?? 'skill')];
    }
    const m = source.match(/^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+))?$/);
    if (m) return installFromGitHub(`${m[1]}.git`, m[2] ?? '', onLog);
    throw new Error(`URL ไม่รองรับ: ${source} (ใช้ลิงก์ SKILL.md ตรง หรือ GitHub repo)`);
  }

  const seg = source.split('/');
  if (seg.length >= 2 && /^[\w.-]+$/.test(seg[0]) && /^[\w.-]+$/.test(seg[1])) {
    return installFromGitHub(`https://github.com/${seg[0]}/${seg[1]}.git`, seg.slice(2).join('/'), onLog);
  }

  throw new Error(`ไม่รู้จัก source: "${source}" — ใช้ GitHub "user/repo", URL ของ SKILL.md, หรือ local path`);
}

/** ลบ skill ที่ติดตั้งไว้ (เฉพาะ ~/.sanook/skills — ไม่แตะ bundled) */
export async function removeInstalledSkill(name: string): Promise<boolean> {
  if (!isValidSkillName(name)) return false;
  const dir = join(USER_SKILLS, name);
  if (!(await exists(dir))) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}
