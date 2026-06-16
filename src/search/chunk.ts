// ============================================================================
// src/search/chunk.ts — ONE generic, heading-aware markdown chunker.
//
// arra-oracle ships five hardcoded type parsers (resonance/learning/retro/
// distillation/security-corpus), each splitting on its own header convention.
// We replace all five with a single type-agnostic chunker: split on ATX
// headings, fold sub-MIN sections forward so we never emit a tiny chunk, and key
// each chunk by a stable hash of (path)#ordinal so re-indexing a file replaces
// exactly its chunks (no posting creep — see index-core.addDoc).
//
// Everything is pure (no fs) and DEFENSIVE: malformed frontmatter, nested YAML,
// or a stray [[ inside a code fence degrade to "no frontmatter / no links"
// rather than throwing. We must never block indexing a real, messy vault file.
// ============================================================================
import { createHash } from 'node:crypto';

const MIN_CHARS = 120; // sections shorter than this fold into the next chunk

export interface Frontmatter {
  noteType?: string;
  tags: string[];
  parent?: string;
  up?: string;
}

export interface Chunk {
  id: string; // `${pathHash}#${ordinal}` — stable across runs for a given path+layout
  ordinal: number;
  heading: string; // the section's leading heading (or '' for the doc intro)
  text: string; // section body (heading line excluded so it can be a title-boosted field)
}

export interface ParsedDoc {
  frontmatter: Frontmatter;
  links: string[]; // resolved [[wikilink]] target names (deduped, alias stripped)
  chunks: Chunk[];
}

/** deterministic path hash — SHA-256 prefix keeps chunk ids short without 32-bit collision risk. */
export function pathHash(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 16);
}

/** split a leading `---\n…\n---` frontmatter block from the body. Defensive: no block ⇒ {} + full md. */
export function parseFrontmatter(md: string): { data: Frontmatter; body: string } {
  const empty: Frontmatter = { tags: [] };
  if (!md.startsWith('---')) return { data: empty, body: md };
  const end = md.indexOf('\n---', 3);
  if (end === -1) return { data: empty, body: md };
  const block = md.slice(3, end).trim();
  // หา newline หลัง closing fence; ถ้าไม่มี (frontmatter-only ไม่มี trailing newline) body = '' ไม่ใช่ทั้งไฟล์
  // (indexOf คืน -1 → slice(0) = ทั้งไฟล์ → frontmatter รั่วเข้า body ทำ index/search เพี้ยน)
  const afterFence = md.indexOf('\n', end + 1);
  const body = (afterFence === -1 ? '' : md.slice(afterFence + 1)).replace(/^\n+/, '');

  const data: Frontmatter = { tags: [] };
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'note_type' || key === 'notetype') data.noteType = stripQuotes(val);
    else if (key === 'parent') data.parent = unwrapLink(val);
    else if (key === 'up') data.up = unwrapLink(val);
    else if (key === 'tags') {
      if (val.startsWith('[')) data.tags = inlineList(val);
      else if (val) data.tags = [stripQuotes(val)];
      else {
        // YAML block list: subsequent "- item" lines
        for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) {
          data.tags.push(stripQuotes(lines[j].replace(/^\s*-\s+/, '').trim()));
        }
      }
    }
  }
  return { data, body };
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, '').trim();
}
function unwrapLink(s: string): string {
  const m = /\[\[([^\]]+)\]\]/.exec(s);
  return (m ? m[1] : stripQuotes(s)).split('|')[0].trim();
}
function inlineList(s: string): string[] {
  return s
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => stripQuotes(t))
    .filter(Boolean);
}

/** extract [[wikilink]] targets (alias after | dropped), ignoring fenced code blocks. Deduped. */
export function extractWikilinks(md: string): string[] {
  const noFences = md.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const out = new Set<string>();
  for (const m of noFences.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = m[1].split('|')[0].split('#')[0].trim();
    if (target) out.add(target);
  }
  return [...out];
}

interface RawSection {
  heading: string;
  body: string;
}

/** split body into sections at ATX headings (fenced code blocks are not headings). */
function splitSections(md: string): RawSection[] {
  const sections: RawSection[] = [];
  let cur: RawSection = { heading: '', body: '' };
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (m) {
      if (cur.heading || cur.body.trim()) sections.push(cur);
      cur = { heading: m[2].trim(), body: '' };
    } else {
      cur.body += `${line}\n`;
    }
  }
  if (cur.heading || cur.body.trim()) sections.push(cur);
  return sections;
}

/** greedily pack sections so no chunk is below MIN_CHARS; the first section's heading labels the group. */
function packSections(sections: RawSection[]): RawSection[] {
  const out: RawSection[] = [];
  let groupHeading: string | null = null;
  let buf = '';
  const flush = (): void => {
    if (buf.trim()) out.push({ heading: groupHeading ?? '', body: buf.trim() });
    buf = '';
    groupHeading = null;
  };
  for (const s of sections) {
    if (groupHeading === null) {
      groupHeading = s.heading;
      buf += s.body;
    } else {
      if (s.heading) buf += `\n${s.heading}\n`;
      buf += s.body;
    }
    if (buf.trim().length >= MIN_CHARS) flush();
  }
  flush();
  return out;
}

/**
 * Parse a markdown file into frontmatter + wikilink edges + heading-aware chunks.
 * Pure and total — any structural weirdness degrades, never throws.
 */
export function chunkMarkdown(path: string, md: string): ParsedDoc {
  // normalize CRLF→LF — ไฟล์ vault บน Windows มัก CRLF; ไม่งั้น frontmatter ('\n---') + split พัง+ hash เพี้ยนข้ามแพลตฟอร์ม
  md = md.replace(/\r\n/g, '\n');
  const { data, body } = parseFrontmatter(md);
  const links = extractWikilinks(body);
  const packed = packSections(splitSections(body));
  const hash = pathHash(path);
  const chunks: Chunk[] = packed.map((s, ordinal) => ({
    id: `${hash}#${ordinal}`,
    ordinal,
    heading: s.heading,
    text: s.body,
  }));
  // a file with a body but (after packing) no chunk — e.g. only whitespace — yields none; that's fine.
  return { frontmatter: data, links, chunks };
}
