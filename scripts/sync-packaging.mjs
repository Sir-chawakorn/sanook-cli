#!/usr/bin/env node
/**
 * Sync packaging/homebrew + packaging/winget version/sha256 from package.json + npm registry.
 * Usage: node scripts/sync-packaging.mjs [version]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = process.argv[2]?.trim() || pkg.version;

const url = `https://registry.npmjs.org/sanook-cli/-/sanook-cli-${version}.tgz`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`Failed to fetch ${url} (${res.status}). Publish npm first or pass a published version.`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
const sha256 = createHash('sha256').update(buf).digest('hex');

const brewPath = join(root, 'packaging/homebrew/sanook-cli.rb');
let brew = readFileSync(brewPath, 'utf8');
brew = brew.replace(/url "https:\/\/registry\.npmjs\.org\/sanook-cli\/-\/sanook-cli-[^"]+"/, `url "https://registry.npmjs.org/sanook-cli/-/sanook-cli-${version}.tgz"`);
brew = brew.replace(/sha256 "[^"]+"/, `sha256 "${sha256}"`);
writeFileSync(brewPath, brew);

for (const name of ['Sanook.SanookCLI.yaml', 'Sanook.SanookCLI.installer.yaml', 'Sanook.SanookCLI.locale.en-US.yaml']) {
  const p = join(root, 'packaging/winget', name);
  let y = readFileSync(p, 'utf8');
  y = y.replace(/^PackageVersion: .+$/m, `PackageVersion: ${version}`);
  if (name.includes('installer')) {
    y = y.replace(/InstallerUrl: .+$/m, `InstallerUrl: https://github.com/Sir-chawakorn/sanook-cli/releases/download/v${version}/sanook-cli-win-x64.zip`);
  }
  writeFileSync(p, y);
}

console.log(`Synced packaging to sanook-cli@${version}`);
console.log(`  homebrew sha256: ${sha256}`);
