import { describe, it, expect } from 'vitest';
import {
  chunkMarkdown,
  parseFrontmatter,
  extractWikilinks,
  pathHash,
} from './chunk.js';

describe('parseFrontmatter', () => {
  it('parses note_type, inline tags, parent/up wikilinks', () => {
    const md = `---
note_type: distillation
tags: [ops, deploy]
parent: "[[Distillations/_Index]]"
---

# Body
content here that is definitely longer than the min chunk threshold so it survives packing.`;
    const { data, body } = parseFrontmatter(md);
    expect(data.noteType).toBe('distillation');
    expect(data.tags).toEqual(['ops', 'deploy']);
    expect(data.parent).toBe('Distillations/_Index');
    expect(body.startsWith('# Body')).toBe(true);
  });

  it('parses YAML block-list tags', () => {
    const md = `---
tags:
  - alpha
  - beta
---
x`;
    expect(parseFrontmatter(md).data.tags).toEqual(['alpha', 'beta']);
  });

  it('no frontmatter → empty data + full body', () => {
    const { data, body } = parseFrontmatter('# Just a doc\nhello');
    expect(data.tags).toEqual([]);
    expect(body).toContain('Just a doc');
  });

  it('unterminated frontmatter degrades, does not throw', () => {
    const { data } = parseFrontmatter('---\nnote_type: x\nno closing fence');
    expect(data.tags).toEqual([]);
  });
});

describe('extractWikilinks', () => {
  it('extracts targets, strips aliases and #anchors, dedups', () => {
    const links = extractWikilinks('see [[Deploy Runbook|the runbook]] and [[Deploy Runbook]] and [[Vault Map#section]]');
    expect(links).toContain('Deploy Runbook');
    expect(links).toContain('Vault Map');
    expect(links.filter((l) => l === 'Deploy Runbook')).toHaveLength(1);
  });

  it('ignores [[ inside code fences', () => {
    const md = 'real [[Link]]\n```\nnot a [[CodeLink]]\n```\n';
    const links = extractWikilinks(md);
    expect(links).toEqual(['Link']);
  });
});

describe('chunkMarkdown', () => {
  it('splits a multi-heading doc and gives stable ids keyed by path', () => {
    const md = `# Intro
${'lead paragraph that is long enough to stand as its own chunk for sure. '.repeat(3)}

## Section A
${'alpha section body, also nicely long enough to be its own chunk here. '.repeat(3)}

## Section B
${'beta section body, equally long enough to become a standalone chunk. '.repeat(3)}`;
    const { chunks } = chunkMarkdown('Notes/x.md', md);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].id).toBe(`${pathHash('Notes/x.md')}#0`);
    expect(chunks.map((c) => c.heading)).toContain('Section A');
    // ids are stable & unique per ordinal
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });

  it('folds tiny sections forward so no micro-chunks', () => {
    const md = `# A
short.

# B
tiny.

# C
${'this is the section that finally pushes the buffer over the minimum char threshold. '.repeat(2)}`;
    const { chunks } = chunkMarkdown('p.md', md);
    // the two tiny sections fold into the group that reaches MIN
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toContain('tiny');
    expect(chunks[0].text).toContain('threshold');
  });

  it('extracts frontmatter + links alongside chunks', () => {
    const md = `---
note_type: learning
tags: [x]
---
# T
body referencing [[Other Note]] and long enough to remain a chunk after packing the section.`;
    const doc = chunkMarkdown('a.md', md);
    expect(doc.frontmatter.noteType).toBe('learning');
    expect(doc.links).toEqual(['Other Note']);
    expect(doc.chunks.length).toBe(1);
  });

  it('whitespace-only file yields no chunks, no throw', () => {
    expect(chunkMarkdown('e.md', '   \n\n').chunks).toEqual([]);
  });
});

describe('pathHash', () => {
  it('is deterministic and uses a wider SHA-256 prefix rather than a tiny 32-bit id', () => {
    const h = pathHash('Notes/x.md');
    expect(pathHash('Notes/x.md')).toBe(h);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(pathHash('Notes/y.md')).not.toBe(h);
  });
});
