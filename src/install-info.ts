// Multi-platform install metadata — single source for Dashboard, README sync, and docs.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INSTALL_PKG = 'sanook-cli';
export const INSTALL_REPO = 'Sir-chawakorn/sanook-cli';
export const INSTALL_REPO_URL = `https://github.com/${INSTALL_REPO}`;
export const INSTALL_BRANCH = 'main';
/** Custom domain when DNS + Pages are configured */
export const INSTALL_DOMAIN = 'sanook.ai';
/** GitHub Pages project URL (works when gh-pages branch is deployed) */
export const INSTALL_PAGES_URL = `https://${INSTALL_REPO.split('/')[0]}.github.io/${INSTALL_REPO.split('/')[1]}`;
/** jsDelivr CDN — stable short URL without custom domain */
export const INSTALL_CDN_URL = `https://cdn.jsdelivr.net/gh/${INSTALL_REPO}@${INSTALL_BRANCH}/scripts`;

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

export function installScriptPagesUrl(name: 'install.sh' | 'install.ps1'): string {
  return `${INSTALL_PAGES_URL}/${name}`;
}

export function installScriptCdnUrl(name: 'install.sh' | 'install.ps1'): string {
  return `${INSTALL_CDN_URL}/${name}`;
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
  const shPages = installScriptPagesUrl('install.sh');
  const shDomain = installScriptUrl('install.sh', true);
  const shCdn = installScriptCdnUrl('install.sh');
  const version = installPkgVersion();
  const releaseTag = version === 'latest' ? 'latest' : `v${version}`;

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
        { os: 'CDN (jsDelivr)', cmd: `curl -fsSL ${shCdn} | bash` },
        { os: 'GitHub Pages', cmd: `curl -fsSL ${shPages} | bash` },
        { os: `Short URL (${INSTALL_DOMAIN})`, cmd: `curl -fsSL ${shDomain} | bash` },
      ],
      note: `${INSTALL_DOMAIN} ต้องตั้ง DNS ที่ GoDaddy ก่อน — ดู scripts/configure-sanook-ai-dns.sh`,
    },
    {
      id: 'homebrew',
      label: 'Homebrew',
      ready: true,
      commands: [
        { os: 'macOS / Linux (trust tap ครั้งแรก)', cmd: `brew trust ${INSTALL_REPO.split('/')[0]}/tap` },
        { os: 'macOS / Linux', cmd: `brew tap ${INSTALL_REPO.split('/')[0]}/tap` },
        { os: 'macOS / Linux', cmd: `brew install ${INSTALL_PKG}` },
      ],
      note: `Live ที่ homebrew-tap — brew tap ${INSTALL_REPO.split('/')[0]}/tap && brew install ${INSTALL_PKG}`,
    },
    {
      id: 'winget',
      label: 'WinGet',
      ready: false,
      commands: [{ os: 'Windows', cmd: 'winget install Sanook.SanookCLI' }],
      note: `CLA ลงนามแล้ว — PR #391114 รอ validation + merge (release zip ${releaseTag} พร้อม)`,
    },
  ];
}

export function dashboardInstallPayload(): { pkg: string; version: string; methods: InstallMethod[] } {
  return { pkg: INSTALL_PKG, version: installPkgVersion(), methods: installMethods() };
}
