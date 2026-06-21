#!/usr/bin/env node
/**
 * Sync Homebrew tarball URL/sha256 plus WinGet manifest version/release URL.
 * Usage: node scripts/sync-packaging.mjs [version]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function replaceRequired(content, pattern, replacement, label) {
  pattern.lastIndex = 0;
  if (!pattern.test(content)) {
    throw new Error(`Missing ${label}; packaging format may have changed.`);
  }
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

export function syncHomebrewFormula(content, version, sha256, label) {
  let brew = replaceRequired(
    content,
    /url "https:\/\/registry\.npmjs\.org\/sanook-cli\/-\/sanook-cli-[^"]+"/,
    `url "https://registry.npmjs.org/sanook-cli/-/sanook-cli-${version}.tgz"`,
    `${label} npm tarball URL`,
  );
  brew = replaceRequired(brew, /sha256 "[^"]+"/, `sha256 "${sha256}"`, `${label} sha256`);
  return brew;
}

export function syncWinGetManifest(content, version, label, options = {}) {
  let yaml = replaceRequired(content, /^PackageVersion: .+$/m, `PackageVersion: ${version}`, `${label} PackageVersion`);
  if (options.installer) {
    yaml = replaceRequired(
      yaml,
      /InstallerUrl: .+$/m,
      `InstallerUrl: https://github.com/Sir-chawakorn/sanook-cli/releases/download/v${version}/sanook-cli-win-x64.zip`,
      `${label} InstallerUrl`,
    );
  }
  return yaml;
}

export async function fetchTarballSha256(url, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} (${res.status}). Publish npm first or pass a published version.`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return createHash('sha256').update(buf).digest('hex');
}

export function syncPackagingFiles({ root = defaultRoot, sha256, version }) {
  const brewPaths = [
    { path: join(root, 'packaging/homebrew/sanook-cli.rb'), optional: false },
    { path: join(root, 'packaging/homebrew-tap/Formula/sanook-cli.rb'), optional: true },
  ];
  for (const brewPath of brewPaths) {
    if (brewPath.optional && !existsSync(brewPath.path)) continue;
    const brew = readFileSync(brewPath.path, 'utf8');
    writeFileSync(brewPath.path, syncHomebrewFormula(brew, version, sha256, brewPath.path));
  }

  for (const name of ['Sanook.SanookCLI.yaml', 'Sanook.SanookCLI.installer.yaml', 'Sanook.SanookCLI.locale.en-US.yaml']) {
    const p = join(root, 'packaging/winget', name);
    const yaml = readFileSync(p, 'utf8');
    writeFileSync(p, syncWinGetManifest(yaml, version, p, { installer: name.includes('installer') }));
  }
}

export async function runSyncPackaging({ args = process.argv.slice(2), root = defaultRoot, fetchImpl = fetch } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = args[0]?.trim() || pkg.version;
  const url = `https://registry.npmjs.org/sanook-cli/-/sanook-cli-${version}.tgz`;
  const sha256 = await fetchTarballSha256(url, fetchImpl);
  syncPackagingFiles({ root, sha256, version });
  return { sha256, version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { sha256, version } = await runSyncPackaging();
    console.log(`Synced packaging to sanook-cli@${version}`);
    console.log(`  homebrew sha256: ${sha256}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
