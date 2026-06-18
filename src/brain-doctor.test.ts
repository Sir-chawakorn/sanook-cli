import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  BRAIN_HOT_FILES,
  checkBrain,
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
      ['brain.hot-files', 'pass'],
      ['brain.structure-map', 'pass'],
      ['brain.search-index', 'pass'],
      ['brain.mcp', 'pass'],
    ]);
  });
});
