import { describe, expect, it } from 'vitest';
import { distillSession, distilledCandidatesFromMessages, distilledFactsFromMessages } from './session-distill.js';

// Proven by the H5 experiment at ~0.88 precision / 0.70 recall on an independently-generated
// benchmark. NOT wired as a default yet — end-to-end recall is gated by BM25 paraphrase retrieval,
// not by extraction. These tests lock in the extractor's behavior as a maintained building block.

describe('distillSession', () => {
  it('extracts decisions, gotchas, preferences and constraints; rejects noise', () => {
    const out = distillSession([
      { role: 'user', text: 'hey, quick question before we start' }, // greeting → noise
      { role: 'user', text: 'For this repo we decided to use pnpm, not npm, for package management.' }, // decision
      { role: 'assistant', text: 'Got it. Let me check the lockfile.' }, // transient → noise
      { role: 'assistant', text: 'The bug was a missing await in the auth handler; the fix was to await verifyToken().' }, // gotcha
      { role: 'user', text: 'Also our convention is to name React hooks with a use prefix.' }, // preference
      { role: 'assistant', text: 'Note that secrets must never be written into the repo.' }, // constraint
      { role: 'assistant', text: 'Traceback (most recent call last): at foo.js:12' }, // log → noise
    ]);
    const text = out.map((c) => c.text).join(' | ').toLowerCase();
    expect(text).toContain('pnpm');
    expect(text).toContain('await');
    expect(text).toContain('use prefix');
    expect(text).toContain('secrets must never');
    // noise rejected
    expect(text).not.toContain('quick question');
    expect(text).not.toContain('let me check');
    expect(text).not.toContain('traceback');
    // kinds are tagged
    expect(out.some((c) => c.kind === 'decision')).toBe(true);
    expect(out.some((c) => c.kind === 'gotcha')).toBe(true);
  });

  it('extracts nothing from a pure-noise transcript (false-positive resistance)', () => {
    const out = distillSession([
      { role: 'user', text: 'hi there' },
      { role: 'assistant', text: 'Hello! How can I help?' },
      { role: 'user', text: 'can you list the files?' },
      { role: 'assistant', text: 'Sure, here is the output: a.ts b.ts c.ts' },
    ]);
    expect(out).toEqual([]);
  });

  it('distilledFactsFromMessages flattens ModelMessage content (string + parts) to fact texts', () => {
    const messages = [
      { role: 'user', content: 'We decided to use Bun, not Node, for the test runner.' },
      { role: 'assistant', content: [{ type: 'text', text: 'Noted. The convention is to keep tests next to source files.' }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolName: 'read_file' }] }, // no text part → ignored
    ];
    const candidates = distilledCandidatesFromMessages(messages);
    expect(candidates.map((c) => c.kind)).toEqual(['decision', 'preference']);

    const facts = distilledFactsFromMessages(messages);
    const joined = facts.join(' | ').toLowerCase();
    expect(joined).toContain('bun');
    expect(joined).toContain('convention');
  });

  it('uses the strongest kind when a sentence has mixed durable-memory signals', () => {
    const out = distillSession([
      { role: 'user', text: 'We decided API keys must never be committed to the repo.' },
      { role: 'assistant', text: 'The convention is that release checks must run before packaging.' },
    ]);
    expect(out).toEqual([
      { text: 'We decided API keys must never be committed to the repo.', kind: 'constraint' },
      { text: 'The convention is that release checks must run before packaging.', kind: 'preference' },
    ]);
  });

  it('keeps explicit preferences stronger than X-over-Y decision fallback', () => {
    const out = distillSession([
      { role: 'user', text: 'Pick prefers Playwright over Puppeteer for browser automation.' },
    ]);
    expect(out).toEqual([
      { text: 'Pick prefers Playwright over Puppeteer for browser automation.', kind: 'preference' },
    ]);
  });

  it('treats comma-separated X-not-Y phrasing as a decision signal', () => {
    const out = distillSession([
      { role: 'user', text: 'Use pnpm, not npm, for package management.' },
    ]);
    expect(out).toEqual([
      { text: 'Use pnpm, not npm, for package management.', kind: 'decision' },
    ]);
  });

  it('strips Markdown task-list markers before persisting durable facts', () => {
    const out = distillSession([
      {
        role: 'assistant',
        text: '- [x] We decided to use task lists for release gates.\n1. [ ] Secrets must never be written into release notes.',
      },
    ]);

    expect(out).toEqual([
      { text: 'We decided to use task lists for release gates.', kind: 'decision' },
      { text: 'Secrets must never be written into release notes.', kind: 'constraint' },
    ]);
  });

  it('strips indented Markdown list markers before classifying durable facts', () => {
    const out = distillSession([
      {
        role: 'assistant',
        text: '  - [ ] The convention is to write release notes locally.\n\t2) Secrets must never be logged.',
      },
    ]);

    expect(out).toEqual([
      { text: 'The convention is to write release notes locally.', kind: 'preference' },
      { text: 'Secrets must never be logged.', kind: 'constraint' },
    ]);
  });

  it('strips plus-sign Markdown task-list markers before persisting durable facts', () => {
    const out = distillSession([
      { role: 'assistant', text: '+ [ ] We decided to include local-only maintenance notes.' },
    ]);

    expect(out).toEqual([
      { text: 'We decided to include local-only maintenance notes.', kind: 'decision' },
    ]);
  });

  it('does not treat leading digits in prose as ordered-list markers', () => {
    const out = distillSession([
      { role: 'assistant', text: '2FA must be enabled for production deploy access.' },
    ]);

    expect(out).toEqual([
      { text: '2FA must be enabled for production deploy access.', kind: 'constraint' },
    ]);
  });

  it('extracts Thai durable facts without spaces or ASCII dedupe keys', () => {
    const out = distillSession([
      { role: 'assistant', text: 'ปิ๊กชอบใช้โหมดมืดเสมอ.\nปิ๊กชอบใช้โหมดมืดเสมอ.' },
    ]);

    expect(out).toEqual([
      { text: 'ปิ๊กชอบใช้โหมดมืดเสมอ.', kind: 'preference' },
    ]);
  });

  it('dedupes visually identical Unicode facts with different normalization forms', () => {
    const out = distillSession([
      { role: 'assistant', text: 'Piqué prefers dark mode.\nPique\u0301 prefers dark mode.' },
    ]);

    expect(out).toEqual([
      { text: 'Piqué prefers dark mode.', kind: 'preference' },
    ]);
  });

  it('dedupes repeated facts and ignores system messages', () => {
    const out = distillSession([
      { role: 'system', text: 'You are a coding agent. Always be helpful.' }, // system → ignored
      { role: 'user', text: 'We decided to use Postgres not MySQL.' },
      { role: 'assistant', text: 'We decided to use Postgres not MySQL.' }, // dup
    ]);
    expect(out).toHaveLength(1);
  });
});
