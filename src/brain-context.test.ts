import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  formatBrainContextReport,
  inspectBrainContext,
  parseBrainContextArgs,
  type BrainContextSearch,
} from './brain-context.js';

describe('parseBrainContextArgs', () => {
  it('parses optional task search flags', () => {
    expect(parseBrainContextArgs(['--task', 'ship release', '--mode', 'fts', '--limit', '3', '--source', 'vault,session'])).toEqual({
      ok: true,
      value: { task: 'ship release', mode: 'fts', limit: 3, sources: ['vault', 'session'], showContent: true },
    });
  });

  it('uses positional args as the task and can hide the raw context block', () => {
    expect(parseBrainContextArgs(['fix', 'brain', 'routing', '--no-content'])).toEqual({
      ok: true,
      value: { task: 'fix brain routing', mode: 'auto', limit: 5, sources: undefined, showContent: false },
    });
  });

  it('accepts inline option values and deduplicates source filters', () => {
    expect(parseBrainContextArgs(['ship', 'release', '--mode=hybrid', '--limit=3', '--sources=vault,vault,skill'])).toEqual({
      ok: true,
      value: { task: 'ship release', mode: 'hybrid', limit: 3, sources: ['vault', 'skill'], showContent: true },
    });
  });

  it('treats arguments after -- as literal task text', () => {
    expect(parseBrainContextArgs(['--mode', 'fts', '--limit', '3', '--', '--source', 'vault'])).toEqual({
      ok: true,
      value: { task: '--source vault', mode: 'fts', limit: 3, sources: undefined, showContent: true },
    });
  });

  it('rejects invalid task retrieval flags', () => {
    expect(parseBrainContextArgs(['--task=']).ok).toBe(false);
    expect(parseBrainContextArgs(['--task', '   ']).ok).toBe(false);
    expect(parseBrainContextArgs(['--mode', 'nope']).ok).toBe(false);
    expect(parseBrainContextArgs(['--limit', '0']).ok).toBe(false);
    expect(parseBrainContextArgs(['--limit', '1e2']).ok).toBe(false);
    expect(parseBrainContextArgs(['--limit', '9007199254740992']).ok).toBe(false);
    expect(parseBrainContextArgs(['--source', 'vault,nope']).ok).toBe(false);
  });
});

describe('inspectBrainContext', () => {
  let dir: string;
  let vault: string;
  let indexPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-brain-context-'));
    vault = join(dir, 'vault');
    indexPath = join(dir, 'search', 'index.json');
    await mkdir(join(vault, 'Shared', 'Operating-State'), { recursive: true });
    await mkdir(join(vault, 'Shared', 'Memory-Inbox'), { recursive: true });
    await writeFile(join(vault, 'Shared', 'AI-Context-Index.md'), '# Index\nRead [[Vault Structure Map]].\n', 'utf8');
    await writeFile(join(vault, 'Shared', 'Operating-State', 'current-state.md'), '# State\nWorking on Sanook CLI.\n', 'utf8');
    await writeFile(
      join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md'),
      '# Inbox\n\n## New Candidates\n- owner likes concise Thai answers\n',
      'utf8',
    );
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, '{}\n', 'utf8');
    await utimes(indexPath, new Date('2026-06-18T00:02:00.000Z'), new Date('2026-06-18T00:02:00.000Z'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports the exact brain context parts and rendered context block', async () => {
    const report = await inspectBrainContext({ brainPath: vault, indexPath });

    expect(report.ok).toBe(true);
    expect(report.context).toContain('<brain_vault');
    expect(report.context).toContain('Read [[Vault Structure Map]].');
    expect(report.context).toContain('## current-state');
    expect(report.context).toContain('owner likes concise Thai answers');
    expect(report.sources.map((source) => [source.relPath, source.status])).toEqual([
      ['Shared/AI-Context-Index.md', 'present'],
      ['Shared/Operating-State/current-state.md', 'present'],
      ['Shared/Memory-Inbox/memory-inbox.md', 'present'],
    ]);
  });

  it('warns about missing hot context sources without failing the command', async () => {
    await rm(join(vault, 'Shared', 'AI-Context-Index.md'), { force: true });

    const report = await inspectBrainContext({ brainPath: vault, indexPath });

    expect(report.ok).toBe(true);
    expect(report.sources[0]).toMatchObject({ relPath: 'Shared/AI-Context-Index.md', status: 'missing' });
    expect(report.warnings).toContain('Missing context source: Shared/AI-Context-Index.md');
  });

  it('reports stale search indexes using the configured freshness tolerance', async () => {
    const oldDate = new Date('2026-06-18T00:00:00.000Z');
    const newDate = new Date('2026-06-18T00:01:00.000Z');
    await utimes(indexPath, oldDate, oldDate);
    await utimes(join(vault, 'Shared', 'AI-Context-Index.md'), newDate, newDate);

    const report = await inspectBrainContext({
      brainPath: vault,
      indexPath,
      indexFreshnessToleranceMs: 0,
    });

    expect(report.ok).toBe(true);
    expect(report.warnings).toContain('Search index is older than the second-brain markdown files.');
  });

  it('runs task retrieval with focused default sources', async () => {
    const calls: Array<Parameters<BrainContextSearch>> = [];
    const searchImpl: BrainContextSearch = async (query, opts) => {
      calls.push([query, opts]);
      return {
        mode: 'fts',
        total: 1,
        hits: [
          {
            id: 'vault:Projects/sanook-cli/_Index.md#0',
            source: 'vault',
            title: 'sanook-cli',
            path: 'Projects/sanook-cli/_Index.md',
            noteType: 'moc',
            tags: ['project'],
            score: 0,
            snippet: 'second-brain roadmap',
          },
        ],
      };
    };

    const report = await inspectBrainContext({
      brainPath: vault,
      indexPath,
      task: 'second-brain roadmap',
      mode: 'fts',
      limit: 1,
      searchImpl,
    });

    expect(calls).toEqual([
      ['second-brain roadmap', { mode: 'fts', limit: 1, sources: ['vault', 'session', 'skill'] }],
    ]);
    expect(formatBrainContextReport(report, false)).toContain('[vault] sanook-cli — second-brain roadmap');
  });
});
