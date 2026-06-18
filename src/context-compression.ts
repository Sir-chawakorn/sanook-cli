export interface SelectiveCompressionOptions {
  targetChars?: number;
  minChars?: number;
  headChars?: number;
  tailChars?: number;
  maxLineChars?: number;
  query?: string;
}

export interface SelectiveCompressionResult {
  text: string;
  changed: boolean;
  originalChars: number;
  compressedChars: number;
  omittedLines: number;
  omittedChars: number;
}

const DEFAULT_TARGET_CHARS = 6_000;
const DEFAULT_MIN_CHARS = 8_000;
const DEFAULT_MAX_LINE_CHARS = 800;
const IMPORTANT_RE = /\b(error|exception|fail(?:ed|ure)?|warning|warn|timeout|denied|unauthorized|traceback|panic|regression|todo|fixme)\b/i;
const CODE_RE = /^\s*(?:import|export|function|class|interface|type|const|let|var|async|await|return|if|for|while|switch|case)\b/;
const DIFF_RE = /^\s*(?:diff --git|@@|\+\+\+|---|\+|-)/;
const PATH_RE = /(?:^|\s)[\w@./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|rs|go|java|css|scss|html|yml|yaml|toml)(?::\d+)?\b/;
const STRUCTURE_RE = /^\s*(?:#{1,6}\s|\*|-|\d+\.|["'][^"']+["']\s*:)/;
const TOKEN_RE = /[\p{L}\p{N}_./:-]{2,}/gu;

function clampPositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}

function tokens(line: string): string[] {
  return [...line.toLowerCase().matchAll(TOKEN_RE)].map((match) => match[0]);
}

function queryTokens(query: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const token of tokens(query ?? '')) {
    if (token.length >= 3) out.add(token);
    const leaf = token.split(/[/:\\]/).pop();
    if (leaf && leaf.length >= 3) out.add(leaf);
  }
  return out;
}

function shrinkLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  const head = Math.max(80, Math.floor(maxChars * 0.55));
  const tail = Math.max(60, maxChars - head - 48);
  return `${line.slice(0, head)} ... [line pruned ${line.length - head - tail} chars] ... ${line.slice(-tail)}`;
}

function addAnchors(lines: string[], budget: number, fromEnd = false): Set<number> {
  const selected = new Set<number>();
  let chars = 0;
  for (let step = 0; step < lines.length; step++) {
    const index = fromEnd ? lines.length - 1 - step : step;
    if (index < 0 || index >= lines.length) break;
    if (chars >= budget) break;
    selected.add(index);
    chars += lines[index].length + 1;
  }
  return selected;
}

function selectedChars(lines: string[], selected: Set<number>, maxLineChars: number): number {
  let chars = 0;
  for (const index of selected) chars += Math.min(lines[index].length, maxLineChars) + 1;
  return chars;
}

function lineScores(lines: string[], selected: Set<number>, query: Set<string>): Map<number, number> {
  const candidates = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => !selected.has(index) && line.trim());
  const df = new Map<string, number>();
  for (const { line } of candidates) {
    for (const token of new Set(tokens(line))) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const total = Math.max(1, candidates.length);
  const seenLines = new Map<string, number>();
  const scores = new Map<number, number>();
  for (const { line, index } of candidates) {
    const clean = line.trim();
    const lineTokens = tokens(clean);
    let score = 0;
    for (const token of lineTokens) score += Math.log((total + 1) / ((df.get(token) ?? 0) + 1));
    score = score / Math.sqrt(Math.max(1, lineTokens.length));
    if (query.size) {
      let overlap = 0;
      for (const token of new Set(lineTokens)) {
        const leaf = token.split(/[/:\\]/).pop() ?? token;
        if (query.has(token) || query.has(leaf)) overlap += 1;
      }
      if (overlap) score += Math.min(40, overlap * 18);
    }
    if (IMPORTANT_RE.test(clean)) score += 8;
    if (PATH_RE.test(clean)) score += 5;
    if (DIFF_RE.test(clean)) score += 4;
    if (CODE_RE.test(clean)) score += 3;
    if (STRUCTURE_RE.test(clean)) score += 2;
    if (/https?:\/\//i.test(clean)) score += 2;
    if (/^\s*[}\])],?\s*$/.test(clean)) score -= 1;
    if (clean.length > 500 && !/\s/.test(clean)) score -= 5;
    const repeated = seenLines.get(clean) ?? 0;
    if (repeated) score -= Math.min(8, repeated * 2);
    seenLines.set(clean, repeated + 1);
    scores.set(index, score);
  }
  return scores;
}

function renderSelected(lines: string[], selected: Set<number>, maxLineChars: number): { text: string; omittedLines: number; omittedChars: number } {
  const out: string[] = [];
  let omittedLines = 0;
  let omittedChars = 0;
  let gapLines = 0;
  let gapChars = 0;
  const flushGap = (): void => {
    if (!gapLines) return;
    out.push(`... [selective context compression: omitted ${gapLines} line(s), ${gapChars} chars] ...`);
    omittedLines += gapLines;
    omittedChars += gapChars;
    gapLines = 0;
    gapChars = 0;
  };
  for (let index = 0; index < lines.length; index++) {
    if (selected.has(index)) {
      flushGap();
      out.push(shrinkLine(lines[index], maxLineChars));
    } else {
      gapLines += 1;
      gapChars += lines[index].length + 1;
    }
  }
  flushGap();
  return { text: out.join('\n'), omittedLines, omittedChars };
}

/**
 * Zero-LLM selective context compression inspired by Selective Context / Headroom:
 * keep anchors plus high-information lines (errors, paths, code structure, rare terms),
 * then preserve original order with omission markers.
 */
export function selectiveCompressText(input: string, options: SelectiveCompressionOptions = {}): SelectiveCompressionResult {
  const originalChars = input.length;
  const targetChars = clampPositive(options.targetChars, DEFAULT_TARGET_CHARS);
  const minChars = clampPositive(options.minChars, DEFAULT_MIN_CHARS);
  const maxLineChars = clampPositive(options.maxLineChars, DEFAULT_MAX_LINE_CHARS);
  if (originalChars <= minChars || originalChars <= targetChars) {
    return { text: input, changed: false, originalChars, compressedChars: originalChars, omittedLines: 0, omittedChars: 0 };
  }

  const lines = input.split(/\r?\n/);
  if (lines.length <= 4) {
    const text = shrinkLine(input, targetChars);
    return {
      text,
      changed: text !== input,
      originalChars,
      compressedChars: text.length,
      omittedLines: text === input ? 0 : 1,
      omittedChars: Math.max(0, originalChars - text.length),
    };
  }

  const headBudget = Math.min(clampPositive(options.headChars, Math.floor(targetChars * 0.18)), Math.floor(targetChars * 0.35));
  const tailBudget = Math.min(clampPositive(options.tailChars, Math.floor(targetChars * 0.25)), Math.floor(targetChars * 0.45));
  const selected = new Set<number>([
    ...addAnchors(lines, headBudget),
    ...addAnchors(lines, tailBudget, true),
  ]);
  const scores = lineScores(lines, selected, queryTokens(options.query));
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  let used = selectedChars(lines, selected, maxLineChars);
  const softBudget = Math.max(400, targetChars - 600);
  for (const [index] of ranked) {
    const nextCost = Math.min(lines[index].length, maxLineChars) + 1;
    if (used + nextCost > softBudget && selected.size > 0) continue;
    selected.add(index);
    used += nextCost;
    if (used >= softBudget) break;
  }

  const rendered = renderSelected(lines, selected, maxLineChars);
  if (rendered.text.length >= originalChars) {
    return { text: input, changed: false, originalChars, compressedChars: originalChars, omittedLines: 0, omittedChars: 0 };
  }
  return {
    text: rendered.text,
    changed: true,
    originalChars,
    compressedChars: rendered.text.length,
    omittedLines: rendered.omittedLines,
    omittedChars: rendered.omittedChars,
  };
}
