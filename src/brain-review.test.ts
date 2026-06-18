import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BRAIN_DEFAULTS, scaffoldBrain } from './brain.js';
import { formatBrainReviewReport, parseBrainReviewArgs, reviewBrain } from './brain-review.js';

describe('parseBrainReviewArgs', () => {
  it('parses hygiene toggles', () => {
    expect(parseBrainReviewArgs([])).toEqual({ ok: true, value: { scanMarkdownHygiene: true } });
    expect(parseBrainReviewArgs(['--no-hygiene'])).toEqual({ ok: true, value: { scanMarkdownHygiene: false } });
    expect(parseBrainReviewArgs(['--hygiene'])).toEqual({ ok: true, value: { scanMarkdownHygiene: true } });
  });

  it('rejects unknown flags', () => {
    expect(parseBrainReviewArgs(['--json']).ok).toBe(false);
  });
});

describe('reviewBrain', () => {
  let dir: string;
  let vault: string;
  let indexPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-brain-review-'));
    vault = join(dir, 'vault');
    indexPath = join(dir, 'search', 'index.json');
    await scaffoldBrain(vault, { ...BRAIN_DEFAULTS, today: '2026-06-18' });
    await writeIndexManifest();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function sessionManifest(): Promise<Record<string, { mtimeMs: number; size: number; sha: string; ids: string[] }>> {
    const out: Record<string, { mtimeMs: number; size: number; sha: string; ids: string[] }> = {};
    for (const entry of await readdir(join(vault, 'Sessions'), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === '_Index.md') continue;
      const rel = `Sessions/${entry.name}`;
      const s = await stat(join(vault, rel));
      out[rel] = { mtimeMs: s.mtimeMs, size: s.size, sha: `sha-${entry.name}`, ids: [`vault:${rel}#0`] };
    }
    return out;
  }

  async function writeIndexManifest(extra: Record<string, { mtimeMs: number; size: number; sha: string; ids: string[] }> = {}): Promise<void> {
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, `${JSON.stringify({ v: 1, index: {}, manifest: { ...(await sessionManifest()), ...extra } })}\n`, 'utf8');
  }

  it('fails clearly when no brain path is configured', async () => {
    const report = await reviewBrain();

    expect(report.ok).toBe(false);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ id: 'review.configured', status: 'fail' });
  });

  it('passes a freshly scaffolded and indexed vault', async () => {
    const report = await reviewBrain({ brainPath: vault, indexPath, scanMarkdownHygiene: true });

    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.status === 'pass')).toBe(true);
    expect(formatBrainReviewReport(report)).toContain('Sanook brain review');
  });

  it('warns about duplicate and contradictory Memory-Inbox candidates', async () => {
    await writeFile(
      join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md'),
      [
        '# Inbox',
        '',
        '## New Candidates',
        '- owner likes concise answers',
        '- owner likes concise answers',
        '- owner likes dark mode',
        '- owner does not like dark mode',
        '',
        '## Needs Merge',
        '- duplicated preference needs merge',
      ].join('\n'),
      'utf8',
    );

    const report = await reviewBrain({ brainPath: vault, indexPath, scanMarkdownHygiene: false });
    const check = report.checks.find((item) => item.id === 'review.memory-inbox');

    expect(check).toMatchObject({ status: 'warn' });
    expect(check?.findings?.map((finding) => finding.message).join('\n')).toContain('duplicate');
    expect(check?.findings?.map((finding) => finding.message).join('\n')).toContain('possible contradictory');
  });

  it('warns when session notes are missing from the search manifest', async () => {
    await writeFile(indexPath, `${JSON.stringify({ v: 1, index: {}, manifest: {} })}\n`, 'utf8');

    const report = await reviewBrain({ brainPath: vault, indexPath, scanMarkdownHygiene: false });
    const check = report.checks.find((item) => item.id === 'review.session-index');

    expect(check).toMatchObject({ status: 'warn' });
    expect(check?.findings?.[0].message).toContain('session note');
  });

  it('warns about context packs missing required sections or index links', async () => {
    await writeFile(
      join(vault, 'Shared', 'Context-Packs', 'quick-fix.md'),
      '---\nparent: "[[Shared/Context-Packs/_Index]]"\n---\n\n# Quick Fix\n\n> incomplete pack\n\nup:: [[Shared/Context-Packs/_Index]]\n',
      'utf8',
    );

    const report = await reviewBrain({ brainPath: vault, indexPath, scanMarkdownHygiene: false });
    const check = report.checks.find((item) => item.id === 'review.context-packs');

    expect(check).toMatchObject({ status: 'warn' });
    expect(check?.findings?.map((finding) => finding.message).join('\n')).toContain('quick-fix.md');
  });

  it('warns when framework files are newer than eval evidence', async () => {
    const oldDate = new Date('2026-06-18T00:00:00.000Z');
    const newDate = new Date('2026-06-18T01:00:00.000Z');
    await utimes(join(vault, 'Evals', 'second-brain-benchmarks.md'), oldDate, oldDate);
    await utimes(join(vault, 'Evals', 'retrieval-eval.md'), oldDate, oldDate);
    await utimes(join(vault, 'Evals', 'quality-ledger.md'), oldDate, oldDate);
    await utimes(join(vault, 'Shared', 'Rules', 'context-assembly-policy.md'), newDate, newDate);

    const report = await reviewBrain({ brainPath: vault, indexPath, scanMarkdownHygiene: false });
    const check = report.checks.find((item) => item.id === 'review.eval-freshness');

    expect(check).toMatchObject({ status: 'warn' });
    expect(check?.findings?.[0].message).toContain('newer than eval evidence');
  });

  it('does not warn for small scaffold-order mtime skew between framework and eval files', async () => {
    const evalDate = new Date(Date.now() + 60_000);
    const frameworkDate = new Date(evalDate.getTime() + 30_000);
    await utimes(join(vault, 'Evals', 'second-brain-benchmarks.md'), evalDate, evalDate);
    await utimes(join(vault, 'Evals', 'retrieval-eval.md'), evalDate, evalDate);
    await utimes(join(vault, 'Evals', 'quality-ledger.md'), evalDate, evalDate);
    await utimes(join(vault, 'Shared', 'Rules', 'context-assembly-policy.md'), frameworkDate, frameworkDate);

    const report = await reviewBrain({ brainPath: vault, indexPath, scanMarkdownHygiene: false });
    const check = report.checks.find((item) => item.id === 'review.eval-freshness');

    expect(check).toMatchObject({ status: 'pass' });
  });

  it('warns about markdown routing hygiene gaps', async () => {
    await writeFile(join(vault, 'Learning', 'bad-note.md'), '# Bad Note\n\nNo routing metadata.\n', 'utf8');

    const report = await reviewBrain({ brainPath: vault, indexPath });
    const check = report.checks.find((item) => item.id === 'review.markdown-hygiene');

    expect(check).toMatchObject({ status: 'warn' });
    expect(check?.findings?.map((finding) => finding.message).join('\n')).toContain('purpose blockquote');
    expect(check?.findings?.map((finding) => finding.message).join('\n')).toContain('parent frontmatter');
    expect(check?.findings?.map((finding) => finding.message).join('\n')).toContain('up::');
  });

  it('warns when a session final gate still has TODO or PASS without evidence', async () => {
    await writeFile(
      join(vault, 'Sessions', '2026-06-18-bad-final.md'),
      [
        '---',
        'tags: [final-gate]',
        'note_type: final-gate',
        'parent: "[[Sessions/_Index]]"',
        '---',
        '',
        '# Bad Final',
        '',
        '> incomplete final gate',
        '',
        '## 1. Objective / DoD Lock',
        '## 2. Evidence-Backed Checklist',
        '## 3. Status Matrix',
        '## 4. Evidence Matrix',
        '## 5. Residual Risk',
        '## 6. Change Summary Audit',
        '## 7. Final Answer Draft',
        '## 8. Second-Brain Routing / Memory Closeout',
        'If a row has no evidence, it cannot be `PASS`.',
        '## Final Verdict',
        '| Gate | Status | Evidence |',
        '|---|---|---|',
        '| Verification ran | PASS |  |',
        '| Memory closeout | TODO |  |',
        '',
        'up:: [[Sessions/_Index]]',
      ].join('\n'),
      'utf8',
    );

    const report = await reviewBrain({ brainPath: vault, indexPath, scanMarkdownHygiene: false });
    const check = report.checks.find((item) => item.id === 'review.final-gates');

    expect(check).toMatchObject({ status: 'warn' });
    expect(check?.findings?.[0].details?.join('\n')).toContain('PASS row has no evidence');
    expect(check?.findings?.[0].details?.join('\n')).toContain('TODO status remains');
  });
});
