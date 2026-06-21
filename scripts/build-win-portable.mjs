#!/usr/bin/env node
/**
 * Build Windows portable zip for WinGet / GitHub Releases.
 * Output: dist/release/sanook-cli-win-x64.zip (contains sanook.exe)
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'release');
const exePath = join(outDir, 'sanook.exe');
const zipPath = join(outDir, 'sanook-cli-win-x64.zip');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log(`Building sanook.exe (node22-win-x64) for v${version}…`);
execFileSync(
  'npx',
  ['--yes', '@yao-pkg/pkg', 'dist/bin.js', '--targets', 'node22-win-x64', '--output', exePath, '--fallback-to-source'],
  { cwd: root, stdio: 'inherit' },
);

console.log('Creating zip…');
try {
  execFileSync('zip', ['-j', zipPath, exePath], { stdio: 'inherit' });
} catch {
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Force -Path '${exePath}' -DestinationPath '${zipPath}'`],
    { stdio: 'inherit' },
  );
}

const hash = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
const installerPath = join(root, 'packaging', 'winget', 'Sanook.SanookCLI.installer.yaml');
let installer = readFileSync(installerPath, 'utf8');
installer = installer.replace(/^PackageVersion: .+$/m, `PackageVersion: ${version}`);
installer = installer.replace(
  /InstallerUrl: .+/,
  `InstallerUrl: https://github.com/Sir-chawakorn/sanook-cli/releases/download/v${version}/sanook-cli-win-x64.zip`,
);
installer = installer.replace(/InstallerSha256: .+/, `InstallerSha256: ${hash}`);
writeFileSync(installerPath, installer);

for (const name of ['Sanook.SanookCLI.yaml', 'Sanook.SanookCLI.locale.en-US.yaml']) {
  const p = join(root, 'packaging', 'winget', name);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/^PackageVersion: .+$/m, `PackageVersion: ${version}`));
}

console.log(`\n✓ ${zipPath}`);
console.log(`  SHA256: ${hash}`);
console.log(`  Updated packaging/winget/* for v${version}`);
