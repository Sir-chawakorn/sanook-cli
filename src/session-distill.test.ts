import { describe, expect, it } from 'vitest';
import { distillSession, distilledFactsFromMessages } from './session-distill.js';

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
    const facts = distilledFactsFromMessages([
      { role: 'user', content: 'We decided to use Bun, not Node, for the test runner.' },
      { role: 'assistant', content: [{ type: 'text', text: 'Noted. The convention is to keep tests next to source files.' }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolName: 'read_file' }] }, // no text part → ignored
    ]);
    const joined = facts.join(' | ').toLowerCase();
    expect(joined).toContain('bun');
    expect(joined).toContain('convention');
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
