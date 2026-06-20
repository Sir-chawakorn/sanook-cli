import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAIN_DEFAULTS, scaffoldBrain } from './brain.js';
import { formatBrainConsolidateReport, parseBrainConsolidateArgs, runBrainConsolidate } from './brain-consolidate.js';
import type { SearchResult } from './search/engine.js';

describe('parseBrainConsolidateArgs', () => {
  it('defaults to dry-run', () => {
    expect(parseBrainConsolidateArgs([])).toEqual({ ok: true, value: { apply: false, archive: false, memory: false, runRetrieval: true } });
  });

  it('requires --apply with --archive', () => {
    expect(parseBrainConsolidateArgs(['--archive']).ok).toBe(false);
    expect(parseBrainConsolidateArgs(['--apply', '--archive']).ok).toBe(true);
  });
});

describe('runBrainConsolidate', () => {
  let dir: string;
  let vault: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-brain-consolidate-'));
    vault = join(dir, 'vault');
    await scaffoldBrain(vault, { ...BRAIN_DEFAULTS, today: '2026-06-18' });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const fakeSearch = async (query: string): Promise<SearchResult> => ({
    mode: 'fts',
    total: 1,
    hits: [
      {
        id: 'v1',
        source: 'vault',
        title: 'hit',
        path:
          query.includes('memory write')
            ? 'Shared/Rules/memory-write-protocol.md'
            : query.includes('context assembly')
              ? 'Shared/Rules/context-assembly-policy.md'
              : 'Evals/quality-ledger.md',
        snippet: 'snippet',
        score: 10,
        tags: [],
      },
    ],
  });

  it('reports inbox duplicates in dry-run', async () => {
    await writeFile(
      join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md'),
      '# Inbox\n\n## New Candidates\n- owner likes concise answers\n- owner likes concise answers\n',
    );
    const report = await runBrainConsolidate({ brainPath: vault, searchImpl: fakeSearch });
    const inbox = report.steps.find((s) => s.id === 'consolidate.inbox-route');
    expect(inbox?.status).toBe('warn');
    expect(formatBrainConsolidateReport(report)).toContain('dry-run');
  });

  it('removes exact duplicate inbox lines with --apply', async () => {
    const inboxPath = join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md');
    await writeFile(inboxPath, '# Inbox\n\n## New Candidates\n- owner likes concise answers\n- owner likes concise answers\n');
    const report = await runBrainConsolidate({ brainPath: vault, apply: true, runRetrieval: false, searchImpl: fakeSearch });
    const content = await readFile(inboxPath, 'utf8');
    expect(content.match(/owner likes concise answers/g)?.length).toBe(1);
    expect(report.steps.find((s) => s.id === 'consolidate.inbox-route')?.applied?.length).toBeGreaterThan(0);
  });

  it('flags stale notes and archives only with --apply --archive', async () => {
    const stalePath = join(vault, 'Projects', 'old-note.md');
    await mkdir(join(vault, 'Projects'), { recursive: true });
    await writeFile(
      stalePath,
      '---\ntags: [project]\nnote_type: project-overview\nstale_after: 2020-01-01\n---\n\n# Old\n\nup:: [[Projects/_Index]]\n',
    );
    const dry = await runBrainConsolidate({ brainPath: vault, nowMs: Date.parse('2026-06-18'), runRetrieval: false, searchImpl: fakeSearch });
    expect(dry.steps.find((s) => s.id === 'consolidate.stale-archive')?.findings.length).toBeGreaterThan(0);

    await runBrainConsolidate({
      brainPath: vault,
      apply: true,
      archive: true,
      nowMs: Date.parse('2026-06-18'),
      runRetrieval: false,
      searchImpl: fakeSearch,
    });
    await expect(readFile(stalePath, 'utf8')).rejects.toThrow();
    await expect(readFile(join(vault, 'Shared', 'Archive', 'old-note.md'), 'utf8')).resolves.toContain('# Old');
  });
});
