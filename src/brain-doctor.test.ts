import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  BRAIN_HOT_FILES,
  checkBrain,
  checkBrainFolders,
  checkBrainHotFiles,
  checkSearchIndexFreshness,
  checkVaultStructureMap,
} from './brain-doctor.js';

describe('brain doctor checks', () => {
  let dir: string;
  let vault: string;
  let indexPath: string;
  let mcpConfigPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-brain-doctor-'));
    vault = join(dir, 'vault');
    indexPath = join(dir, 'search', 'index.json');
    mcpConfigPath = join(dir, 'mcp.json');
    await mkdir(vault, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeVaultFile(rel: string, content = `> purpose\n\n# ${rel}\n`): Promise<void> {
    const path = join(vault, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }

  async function writeHealthyVault(expectedFolders: readonly string[] = ['Projects', 'Sessions']): Promise<void> {
    for (const rel of BRAIN_HOT_FILES) await writeVaultFile(rel);
    for (const dir of expectedFolders) await mkdir(join(vault, dir), { recursive: true });
    await writeVaultFile('Vault Structure Map.md', expectedFolders.map((f) => `| \`${f}\` | role | put | avoid |`).join('\n'));
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, '{}\n', 'utf8');
    await writeFile(
      mcpConfigPath,
      `${JSON.stringify({ mcpServers: { 'second-brain': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', vault] } } })}\n`,
      'utf8',
    );
  }

  it('reports an unconfigured brain path as a failing check', async () => {
    const report = await checkBrain();

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual([
      {
        id: 'brain.configured',
        status: 'fail',
        message: 'No second-brain path is configured.',
      },
    ]);
  });

  it('fails when required hot files are missing', async () => {
    await writeVaultFile('SANOOK.md');

    const check = await checkBrainHotFiles(vault);

    expect(check.status).toBe('fail');
    expect(check.details).toEqual([
      'Shared/AI-Context-Index.md',
      'Vault Structure Map.md',
      'Shared/Operating-State/current-state.md',
    ]);
  });

  it('fails when expected scaffold folders are missing from disk', async () => {
    await mkdir(join(vault, 'Projects'), { recursive: true });

    const check = await checkBrainFolders(vault, ['Projects', 'Sessions', 'Shared/Rules']);

    expect(check.status).toBe('fail');
    expect(check.details).toEqual(['Sessions', 'Shared/Rules']);
  });

  it('normalizes duplicate expected folder references before checking disk', async () => {
    const check = await checkBrainFolders(vault, ['Projects', 'Projects/', 'Sessions/', './Sessions', '']);

    expect(check.status).toBe('fail');
    expect(check.details).toEqual(['Projects', 'Sessions']);
  });

  it('canonicalizes slash variants before checking disk folders', async () => {
    await mkdir(join(vault, 'Shared', 'Rules'), { recursive: true });

    const check = await checkBrainFolders(vault, ['Shared//Rules/', '.\\Shared\\Rules']);

    expect(check.status).toBe('pass');
  });

  it('rejects parent-directory expected folders before checking disk', async () => {
    await mkdir(join(dir, 'outside'), { recursive: true });

    const check = await checkBrainFolders(vault, ['../outside']);

    expect(check.status).toBe('fail');
    expect(check.details).toEqual(['../outside']);
  });

  it('rejects absolute and nested parent expected folders before checking disk', async () => {
    await mkdir(join(vault, 'Sessions'), { recursive: true });

    const check = await checkBrainFolders(vault, ['/outside', 'C:\\outside', 'C:outside', 'Projects/../Sessions']);

    expect(check.status).toBe('fail');
    expect(check.details).toEqual(['/outside', 'C:/outside', 'C:outside', 'Projects/../Sessions']);
  });

  it('detects Vault Structure Map drift from the expected folder manifest', async () => {
    await writeVaultFile('Vault Structure Map.md', '| `Projects` | role | put | avoid |\n');

    const check = await checkVaultStructureMap(vault, ['Projects', 'Sessions']);

    expect(check.status).toBe('fail');
    expect(check.details).toEqual(['Sessions']);
  });

  it('does not treat partial folder mentions as structure-map coverage', async () => {
    await writeVaultFile('Vault Structure Map.md', '| `Projects-Archive/` | role | put | avoid |\n| `Sessions/` | role | put | avoid |\n');

    const check = await checkVaultStructureMap(vault, ['Projects', 'Sessions']);

    expect(check.status).toBe('fail');
    expect(check.details).toEqual(['Projects']);
  });

  it('does not treat unsafe structure-map folder references as coverage', async () => {
    await writeVaultFile(
      'Vault Structure Map.md',
      [
        '| `Projects/../Sessions` | role | put | avoid |',
        '| `/Projects` | role | put | avoid |',
        '| `C:\\Shared\\Rules` | role | put | avoid |',
        '| `C:Shared\\Rules` | role | put | avoid |',
      ].join('\n'),
    );

    const check = await checkVaultStructureMap(vault, ['Sessions', 'Projects', 'Shared/Rules']);

    expect(check.status).toBe('fail');
    expect(check.details).toEqual(['Sessions', 'Projects', 'Shared/Rules']);
  });

  it('normalizes duplicate expected folder references before checking the structure map', async () => {
    await writeVaultFile('Vault Structure Map.md', '| `Projects/` | role | put | avoid |\n');

    const check = await checkVaultStructureMap(vault, ['Projects', 'Projects/', 'Sessions/', './Sessions', '']);

    expect(check.status).toBe('fail');
    expect(check.details).toEqual(['Sessions']);
  });

  it('canonicalizes slash variants before comparing structure-map folders', async () => {
    await writeVaultFile('Vault Structure Map.md', '| `Shared//Rules/` | role | put | avoid |\n');

    const check = await checkVaultStructureMap(vault, ['.\\Shared\\Rules']);

    expect(check.status).toBe('pass');
  });

  it('rejects parent-directory expected folders before comparing the structure map', async () => {
    await writeVaultFile('Vault Structure Map.md', '| `../outside` | role | put | avoid |\n');

    const check = await checkVaultStructureMap(vault, ['../outside']);

    expect(check.status).toBe('fail');
    expect(check.details).toEqual(['../outside']);
  });

  it('rejects absolute and nested parent expected folders before comparing the structure map', async () => {
    await writeVaultFile('Vault Structure Map.md', '| `Sessions` | role | put | avoid |\n');

    const check = await checkVaultStructureMap(vault, ['/outside', 'C:\\outside', 'C:outside', 'Projects/../Sessions']);

    expect(check.status).toBe('fail');
    expect(check.details).toEqual(['/outside', 'C:/outside', 'C:outside', 'Projects/../Sessions']);
  });

  it('warns when the search index is older than the vault markdown', async () => {
    await writeVaultFile('SANOOK.md');
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, '{}\n', 'utf8');

    const oldDate = new Date('2026-06-18T00:00:00.000Z');
    const newDate = new Date('2026-06-18T00:01:00.000Z');
    await utimes(indexPath, oldDate, oldDate);
    await utimes(join(vault, 'SANOOK.md'), newDate, newDate);

    const stale = await checkSearchIndexFreshness(vault, indexPath, 0);
    expect(stale.status).toBe('warn');

    await utimes(indexPath, new Date('2026-06-18T00:02:00.000Z'), new Date('2026-06-18T00:02:00.000Z'));
    const fresh = await checkSearchIndexFreshness(vault, indexPath, 0);
    expect(fresh.status).toBe('pass');
  });

  it('passes the current P0 checks for a healthy configured vault', async () => {
    const expectedFolders = ['Projects', 'Sessions'];
    await writeHealthyVault(expectedFolders);

    const report = await checkBrain({ brainPath: vault, indexPath, mcpConfigPath, expectedFolders });

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ['brain.path', 'pass'],
      ['brain.folders', 'pass'],
      ['brain.hot-files', 'pass'],
      ['brain.structure-map', 'pass'],
      ['brain.search-index', 'pass'],
      ['brain.mcp', 'pass'],
    ]);
  });

  it('fails the full report when an expected scaffold folder is missing from disk', async () => {
    const expectedFolders = ['Projects', 'Sessions'];
    await writeHealthyVault(expectedFolders);
    await rm(join(vault, 'Sessions'), { recursive: true, force: true });

    const report = await checkBrain({ brainPath: vault, indexPath, mcpConfigPath, expectedFolders });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'brain.folders')).toMatchObject({
      status: 'fail',
      details: ['Sessions'],
    });
  });
});
