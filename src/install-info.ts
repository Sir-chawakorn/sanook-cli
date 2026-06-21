// Multi-platform install metadata — single source for Dashboard, README sync, and docs.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INSTALL_PKG = 'sanook-cli';
export const INSTALL_REPO = 'Sir-chawakorn/sanook-cli';
export const INSTALL_REPO_URL = `https://github.com/${INSTALL_REPO}`;
export const INSTALL_BRANCH = 'main';
/** Custom domain when hosted — optional; GitHub raw works without it */
export const INSTALL_DOMAIN = 'sanook.ai';

const __dir = dirname(fileURLToPath(import.meta.url));
/** package.json version at build time (repo root when running from src/) */
export function installPkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dir, '..', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'latest';
  } catch {
    return 'latest';
  }
}

export function installScriptUrl(name: 'install.sh' | 'install.ps1', preferDomain = false): string {
  if (preferDomain) return `https://${INSTALL_DOMAIN}/${name}`;
  return `https://raw.githubusercontent.com/${INSTALL_REPO}/${INSTALL_BRANCH}/scripts/${name}`;
}

export interface InstallMethod {
  id: string;
  label: string;
  recommended?: boolean;
  commands: { os: string; cmd: string }[];
  ready: boolean;
  note?: string;
}

/** Install channels shown on Dashboard + docs. `ready` = users can run today without extra infra. */
export function installMethods(): InstallMethod[] {
  const sh = installScriptUrl('install.sh');
  const ps1 = installScriptUrl('install.ps1');
  const shDomain = installScriptUrl('install.sh', true);
  const ps1Domain = installScriptUrl('install.ps1', true);

  return [
    {
      id: 'npm',
      label: 'npm / npx',
      recommended: true,
      ready: true,
      commands: [
        { os: 'macOS / Linux / Windows', cmd: `npm install -g ${INSTALL_PKG}` },
        { os: 'Run without installing', cmd: `npx ${INSTALL_PKG}` },
      ],
      note: 'ต้องมี Node.js ≥ 22',
    },
    {
      id: 'curl',
      label: 'Install script',
      ready: true,
      commands: [
        { os: 'macOS / Linux / WSL (GitHub raw)', cmd: `curl -fsSL ${sh} | bash` },
        { os: 'Windows PowerShell (GitHub raw)', cmd: `irm ${ps1} | iex` },
        { os: 'Short URL (optional domain)', cmd: `curl -fsSL ${shDomain} | bash` },
      ],
      note: `สคริปต์ใน repo — โฮสต์ที่ ${INSTALL_DOMAIN} ได้ถ้ามีโดเมน (ดู docs/INSTALL_INFRA.md)`,
    },
    {
      id: 'homebrew',
      label: 'Homebrew',
      ready: true,
      commands: [
        { os: 'macOS / Linux', cmd: `brew tap ${INSTALL_REPO.split('/')[0]}/tap` },
        { os: 'macOS / Linux', cmd: `brew install ${INSTALL_PKG}` },
      ],
      note: `Formula ใน packaging/homebrew/ — copy ไป homebrew-tap repo แล้ว brew tap (ดู docs/INSTALL_INFRA.md)`,
    },
    {
      id: 'winget',
      label: 'WinGet',
      ready: false,
      commands: [{ os: 'Windows', cmd: 'winget install Sanook.SanookCLI' }],
      note: 'ต้อง build Windows zip + ส่ง manifest เข้า winget-pkgs ก่อน (scripts/build-win-portable.ps1)',
    },
  ];
}

export function dashboardInstallPayload(): { pkg: string; version: string; methods: InstallMethod[] } {
  return { pkg: INSTALL_PKG, version: installPkgVersion(), methods: installMethods() };
}
