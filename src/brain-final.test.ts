import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAIN_DEFAULTS, scaffoldBrain } from './brain.js';
import { createBrainFinal, formatBrainFinalReport, parseBrainFinalArgs, validateFinalGateContent } from './brain-final.js';

describe('parseBrainFinalArgs', () => {
  it('parses task, diff, lite, force, and output flags', () => {
    expect(parseBrainFinalArgs(['--task', 'ship final gate', '--from-diff', '--lite', '--force', '--output', 'Sessions/out.md'])).toEqual({
      ok: true,
      value: { task: 'ship final gate', fromDiff: true, lite: true, force: true, output: 'Sessions/out.md' },
    });
    expect(parseBrainFinalArgs(['ship', 'final', '--from-diff'])).toEqual({
      ok: true,
      value: { task: 'ship final', fromDiff: true, lite: false, force: false },
    });
  });

  it('rejects ambiguous task input and unknown flags', () => {
    expect(parseBrainFinalArgs(['--task', 'one', 'two']).ok).toBe(false);
    expect(parseBrainFinalArgs(['--json']).ok).toBe(false);
    expect(parseBrainFinalArgs(['--task=']).ok).toBe(false);
  });

  it('rejects missing split option values without consuming the next flag', () => {
    const task = parseBrainFinalArgs(['--task', '--lite', 'ship final']);
    const output = parseBrainFinalArgs(['ship final', '--output', '--force']);

    expect(task.ok).toBe(false);
    if (!task.ok) expect(task.message).toContain('--task');
    expect(output.ok).toBe(false);
    if (!output.ok) expect(output.message).toContain('--output');
  });

  it('treats arguments after -- as literal task text', () => {
    expect(parseBrainFinalArgs(['--lite', '--', '--task', 'literal'])).toEqual({
      ok: true,
      value: { task: '--task literal', fromDiff: false, lite: true, force: false },
    });
  });
});

describe('createBrainFinal', () => {
  let dir: string;
  let vault: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-brain-final-'));
    vault = join(dir, 'vault');
    await scaffoldBrain(vault, { ...BRAIN_DEFAULTS, today: '2026-06-18' });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a full final gate in Sessions and links it from the session index', async () => {
    const report = await createBrainFinal({
      brainPath: vault,
      today: '2026-06-18',
      task: 'ship final command',
      fromDiff: true,
      diffFiles: ['src/brain-final.ts', 'second-brain/Templates/final-lite.md'],
    });

    expect(report.ok).toBe(true);
    expect(report.relPath).toBe('Sessions/2026-06-18-ship-final-command-final.md');
    expect(report.indexed).toBe(true);
    expect(report.diffFiles).toEqual(['second-brain/Templates/final-lite.md', 'src/brain-final.ts']);
    expect(formatBrainFinalReport(report)).toContain('Sanook brain final');

    const content = await readFile(join(vault, report.relPath!), 'utf8');
    expect(content).toContain('note_type: final-gate');
    expect(content).toContain('parent: "[[Sessions/_Index]]"');
    expect(content).toContain('# 2026-06-18 - ship final command - Final Gate');
    expect(content).toContain('ship final command');
    expect(content).toContain('`src/brain-final.ts`');
    expect(content).toContain('up:: [[Sessions/_Index]]');

    const index = await readFile(join(vault, 'Sessions', '_Index.md'), 'utf8');
    expect(index).toContain('[[Sessions/2026-06-18-ship-final-command-final]]');
  });

  it('creates a lite final gate when requested', async () => {
    const report = await createBrainFinal({
      brainPath: vault,
      today: '2026-06-18',
      task: 'quick closeout',
      lite: true,
      output: 'Sessions/custom-lite-final.md',
    });

    expect(report.ok).toBe(true);
    expect(report.template).toBe('final-lite.md');
    expect((await stat(join(vault, 'Sessions', 'custom-lite-final.md'))).isFile()).toBe(true);
    const content = await readFile(join(vault, 'Sessions', 'custom-lite-final.md'), 'utf8');
    expect(content).toContain('note_type: final-gate-lite');
    expect(content).toContain('Final Gate Lite');
  });

  it('refuses to overwrite unless forced and keeps output inside the vault', async () => {
    const first = await createBrainFinal({ brainPath: vault, today: '2026-06-18', task: 'same task' });
    const second = await createBrainFinal({ brainPath: vault, today: '2026-06-18', task: 'same task' });
    const outside = await createBrainFinal({ brainPath: vault, today: '2026-06-18', output: '../outside.md' });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.warnings.join('\n')).toContain('already exists');
    expect(outside.ok).toBe(false);
    expect(outside.warnings.join('\n')).toContain('inside the configured second-brain vault');
  });
});

describe('validateFinalGateContent', () => {
  it('warns when PASS rows have no evidence or placeholders remain', () => {
    const content = [
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
      '| Close memory | TODO |  |',
      '<leftover>',
    ].join('\n');

    const validation = validateFinalGateContent(content);
    expect(validation.ok).toBe(false);
    expect(validation.warnings.join('\n')).toContain('PASS row has no evidence');
    expect(validation.warnings.join('\n')).toContain('TODO status remains');
    expect(validation.warnings.join('\n')).toContain('Unfilled placeholder');
  });

  it('accepts markdown autolinks as final gate evidence', () => {
    const content = [
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
      '| Verification ran | PASS | <https://example.com/build-log> |',
    ].join('\n');

    expect(validateFinalGateContent(content)).toEqual({ ok: true, warnings: [] });
  });
});
