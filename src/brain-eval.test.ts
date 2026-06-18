import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BRAIN_DEFAULTS, scaffoldBrain } from './brain.js';
import { formatBrainEvalReport, runBrainEval, type BrainEvalSearch } from './brain-eval.js';

describe('runBrainEval', () => {
  let dir: string;
  let vault: string;
  let indexPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-brain-eval-'));
    vault = join(dir, 'vault');
    indexPath = join(dir, 'search', 'index.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeFreshIndex(): Promise<void> {
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, '{}\n', 'utf8');
  }

  it('fails clearly when no brain path is configured', async () => {
    const report = await runBrainEval({ runRetrieval: false });

    expect(report.ok).toBe(false);
    expect(report.cases).toHaveLength(1);
    expect(report.cases[0]).toMatchObject({ id: 'SB-CONFIG', status: 'fail' });
  });

  it('passes the static benchmark checks for a fresh scaffolded vault', async () => {
    await scaffoldBrain(vault, { ...BRAIN_DEFAULTS, today: '2026-06-18' });
    await writeFreshIndex();

    const report = await runBrainEval({ brainPath: vault, indexPath, runRetrieval: false });

    expect(report.ok).toBe(true);
    expect(report.score).toBe(report.maxScore);
    expect(report.cases.map((item) => item.id)).toContain('SB-09');
    expect(formatBrainEvalReport(report)).toContain('Sanook brain eval');
  });

  it('adds retrieval benchmark cases when enabled', async () => {
    await scaffoldBrain(vault, { ...BRAIN_DEFAULTS, today: '2026-06-18' });
    await writeFreshIndex();
    const searchImpl: BrainEvalSearch = async (_query, _opts) => ({
      mode: 'fts',
      total: 1,
      hits: [
        {
          id: 'vault:Shared/Rules/memory-write-protocol.md#0',
          source: 'vault',
          title: 'Memory-Write Protocol',
          path: 'Shared/Rules/memory-write-protocol.md',
          tags: ['rule'],
          score: 0,
          snippet: 'ADD UPDATE DELETE NOOP',
        },
      ],
    });

    const report = await runBrainEval({ brainPath: vault, indexPath, searchImpl });

    expect(report.ok).toBe(false);
    expect(report.cases.find((item) => item.id === 'RET-01')).toMatchObject({ status: 'pass' });
    expect(report.cases.find((item) => item.id === 'RET-02')).toMatchObject({ status: 'partial' });
  });
});
