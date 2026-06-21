import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

type SyncPackagingModule = {
  runSyncPackaging: (options: {
    args?: string[];
    fetchImpl: (url: string) => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>;
    root: string;
  }) => Promise<{ sha256: string; version: string }>;
  syncPackagingFiles: (options: { root: string; sha256: string; version: string }) => void;
  syncHomebrewFormula: (content: string, version: string, sha256: string, label: string) => string;
  syncWinGetManifest: (content: string, version: string, label: string, options?: { installer?: boolean }) => string;
};

const tempRoots: string[] = [];

function readProjectFile(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

async function loadSyncPackagingModule(): Promise<SyncPackagingModule> {
  return (await import(new URL('../scripts/sync-packaging.mjs', import.meta.url).href)) as SyncPackagingModule;
}

function matchOne(content: string, pattern: RegExp, label: string): string {
  const match = content.match(pattern);
  if (!match?.[1]) throw new Error(`Missing ${label}`);
  return match[1];
}

function homebrewRelease(path: string): { sha256: string; url: string } {
  const content = readProjectFile(path);
  return {
    url: matchOne(content, /^\s*url "([^"]+)"$/m, `${path} url`),
    sha256: matchOne(content, /^\s*sha256 "([^"]+)"$/m, `${path} sha256`),
  };
}

function wingetManifest(path: string): { identifier: string; version: string } {
  const content = readProjectFile(path);
  return {
    identifier: matchOne(content, /^PackageIdentifier: (.+)$/m, `${path} PackageIdentifier`),
    version: matchOne(content, /^PackageVersion: (.+)$/m, `${path} PackageVersion`),
  };
}

async function writePackagingFixture(root: string): Promise<void> {
  await mkdir(join(root, 'packaging/homebrew'), { recursive: true });
  await mkdir(join(root, 'packaging/homebrew-tap/Formula'), { recursive: true });
  await mkdir(join(root, 'packaging/winget'), { recursive: true });

  const formula = [
    'class SanookCli < Formula',
    '  url "https://registry.npmjs.org/sanook-cli/-/sanook-cli-0.1.0.tgz"',
    '  sha256 "old"',
    'end',
    '',
  ].join('\n');
  writeFileSync(join(root, 'packaging/homebrew/sanook-cli.rb'), formula);
  writeFileSync(join(root, 'packaging/homebrew-tap/Formula/sanook-cli.rb'), formula);
  writeFileSync(
    join(root, 'packaging/winget/Sanook.SanookCLI.yaml'),
    ['PackageIdentifier: Sanook.SanookCLI', 'PackageVersion: 0.1.0', 'ManifestType: version', ''].join('\n'),
  );
  writeFileSync(
    join(root, 'packaging/winget/Sanook.SanookCLI.installer.yaml'),
    [
      'PackageIdentifier: Sanook.SanookCLI',
      'PackageVersion: 0.1.0',
      'Installers:',
      '  - Architecture: x64',
      '    InstallerUrl: https://github.com/Sir-chawakorn/sanook-cli/releases/download/v0.1.0/sanook-cli-win-x64.zip',
      '    InstallerSha256: keep-me',
      'ManifestType: installer',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'packaging/winget/Sanook.SanookCLI.locale.en-US.yaml'),
    [
      'PackageIdentifier: Sanook.SanookCLI',
      'PackageVersion: 0.1.0',
      'PackageLocale: en-US',
      'ManifestType: defaultLocale',
      '',
    ].join('\n'),
  );
}

describe('packaging manifests', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps the bundled and tap Homebrew formulas on the same release artifact', () => {
    expect(homebrewRelease('packaging/homebrew-tap/Formula/sanook-cli.rb')).toEqual(
      homebrewRelease('packaging/homebrew/sanook-cli.rb'),
    );
  });

  it('keeps WinGet manifest identity and version fields aligned', () => {
    const paths = [
      'packaging/winget/Sanook.SanookCLI.yaml',
      'packaging/winget/Sanook.SanookCLI.installer.yaml',
      'packaging/winget/Sanook.SanookCLI.locale.en-US.yaml',
    ];
    const manifests = paths.map(wingetManifest);

    expect(new Set(manifests.map((manifest) => manifest.identifier))).toEqual(new Set(['Sanook.SanookCLI']));
    expect(new Set(manifests.map((manifest) => manifest.version)).size).toBe(1);

    const version = manifests[0]!.version;
    const installer = readProjectFile('packaging/winget/Sanook.SanookCLI.installer.yaml');
    expect(matchOne(installer, /^    InstallerUrl: (.+)$/m, 'WinGet InstallerUrl')).toBe(
      `https://github.com/Sir-chawakorn/sanook-cli/releases/download/v${version}/sanook-cli-win-x64.zip`,
    );
  });

  it('rewrites Homebrew formulas through the packaging sync helper', async () => {
    const { syncHomebrewFormula } = await loadSyncPackagingModule();

    const updated = syncHomebrewFormula(
      [
        'class SanookCli < Formula',
        '  url "https://registry.npmjs.org/sanook-cli/-/sanook-cli-0.1.0.tgz"',
        '  sha256 "old"',
        'end',
      ].join('\n'),
      '1.2.3',
      'abc123',
      'fixture formula',
    );

    expect(updated).toContain('url "https://registry.npmjs.org/sanook-cli/-/sanook-cli-1.2.3.tgz"');
    expect(updated).toContain('sha256 "abc123"');
    expect(() => syncHomebrewFormula('sha256 "old"', '1.2.3', 'abc123', 'fixture formula')).toThrow(
      /Missing fixture formula npm tarball URL/,
    );
  });

  it('rewrites WinGet version and installer URL without touching the installer checksum', async () => {
    const { syncWinGetManifest } = await loadSyncPackagingModule();

    const updated = syncWinGetManifest(
      [
        'PackageIdentifier: Sanook.SanookCLI',
        'PackageVersion: 0.1.0',
        'Installers:',
        '  - Architecture: x64',
        '    InstallerUrl: https://github.com/Sir-chawakorn/sanook-cli/releases/download/v0.1.0/sanook-cli-win-x64.zip',
        '    InstallerSha256: keep-me',
      ].join('\n'),
      '1.2.3',
      'fixture manifest',
      { installer: true },
    );

    expect(updated).toContain('PackageVersion: 1.2.3');
    expect(updated).toContain(
      'InstallerUrl: https://github.com/Sir-chawakorn/sanook-cli/releases/download/v1.2.3/sanook-cli-win-x64.zip',
    );
    expect(updated).toContain('InstallerSha256: keep-me');
  });

  it('syncs all local packaging files from one version and tarball checksum', async () => {
    const { syncPackagingFiles } = await loadSyncPackagingModule();
    const root = mkdtempSync(join(tmpdir(), 'sanook-packaging-'));
    tempRoots.push(root);

    await writePackagingFixture(root);

    syncPackagingFiles({ root, sha256: 'abc123', version: '1.2.3' });

    expect(readFileSync(join(root, 'packaging/homebrew/sanook-cli.rb'), 'utf8')).toContain(
      'url "https://registry.npmjs.org/sanook-cli/-/sanook-cli-1.2.3.tgz"\n  sha256 "abc123"',
    );
    expect(readFileSync(join(root, 'packaging/homebrew-tap/Formula/sanook-cli.rb'), 'utf8')).toContain(
      'url "https://registry.npmjs.org/sanook-cli/-/sanook-cli-1.2.3.tgz"\n  sha256 "abc123"',
    );
    expect(readFileSync(join(root, 'packaging/winget/Sanook.SanookCLI.yaml'), 'utf8')).toContain(
      'PackageVersion: 1.2.3',
    );
    const installer = readFileSync(join(root, 'packaging/winget/Sanook.SanookCLI.installer.yaml'), 'utf8');
    expect(installer).toContain(
      'InstallerUrl: https://github.com/Sir-chawakorn/sanook-cli/releases/download/v1.2.3/sanook-cli-win-x64.zip',
    );
    expect(installer).toContain('InstallerSha256: keep-me');
    expect(readFileSync(join(root, 'packaging/winget/Sanook.SanookCLI.locale.en-US.yaml'), 'utf8')).toContain(
      'PackageVersion: 1.2.3',
    );
  });

  it('runs the sync helper with package.json version and fetched tarball checksum', async () => {
    const { runSyncPackaging } = await loadSyncPackagingModule();
    const root = mkdtempSync(join(tmpdir(), 'sanook-packaging-run-'));
    tempRoots.push(root);

    await writePackagingFixture(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.3.4' }));

    const tarball = Buffer.from('mock sanook tarball');
    const expectedSha256 = createHash('sha256').update(tarball).digest('hex');
    const fetchUrls: string[] = [];
    const result = await runSyncPackaging({
      root,
      fetchImpl: async (url: string) => {
        fetchUrls.push(url);
        const arrayBuffer = new ArrayBuffer(tarball.length);
        new Uint8Array(arrayBuffer).set(tarball);
        return {
          ok: true,
          arrayBuffer: async () => arrayBuffer,
        };
      },
    });

    expect(fetchUrls).toEqual(['https://registry.npmjs.org/sanook-cli/-/sanook-cli-2.3.4.tgz']);
    expect(result).toEqual({ sha256: expectedSha256, version: '2.3.4' });
    expect(readFileSync(join(root, 'packaging/homebrew/sanook-cli.rb'), 'utf8')).toContain(
      `url "https://registry.npmjs.org/sanook-cli/-/sanook-cli-2.3.4.tgz"\n  sha256 "${expectedSha256}"`,
    );
    expect(readFileSync(join(root, 'packaging/homebrew-tap/Formula/sanook-cli.rb'), 'utf8')).toContain(
      `url "https://registry.npmjs.org/sanook-cli/-/sanook-cli-2.3.4.tgz"\n  sha256 "${expectedSha256}"`,
    );
    expect(readFileSync(join(root, 'packaging/winget/Sanook.SanookCLI.installer.yaml'), 'utf8')).toContain(
      'InstallerUrl: https://github.com/Sir-chawakorn/sanook-cli/releases/download/v2.3.4/sanook-cli-win-x64.zip',
    );
  });
});
