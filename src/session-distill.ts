// Session knowledge distiller — extracts DURABLE facts (decisions, gotchas, preferences,
// constraints) from a finished session transcript so they can be folded into the memory store
// WITHOUT the model voluntarily calling `remember`. Pure + deterministic (heuristic): the offline,
// zero-cost fallback. An LLM-based extractor can layer on top when a model is available.

export type DistillKind = 'decision' | 'gotcha' | 'preference' | 'constraint';

export interface DistillCandidate {
  text: string;
  kind: DistillKind;
}

export interface DistillMessage {
  role: string;
  text: string;
}

// Signal patterns — a sentence is a candidate only if it matches one (keeps precision up).
const SIGNALS: { kind: DistillKind; re: RegExp }[] = [
  { kind: 'decision', re: /\b(decided|we['’]?ll use|we will use|we use|going with|chose|switch(?:ed|ing)? to|standardiz(?:e|ed|ing) on|settled on|agreed to)\b/i },
  { kind: 'preference', re: /\b(prefer(?:s|red)?|convention(?: is|:)|by convention|coding style|likes? to|always (?:use|run|prefer|name)|we name)\b/i },
  { kind: 'constraint', re: /\b(must not|must|never|do ?n['’]?t|don['’]t|required to|is required|only (?:use|run|allow)|forbidden|not allowed|has to)\b/i },
  { kind: 'gotcha', re: /\b(gotcha|caveat|watch out|the (?:bug|issue|problem|error) (?:was|is)|turned out|root cause|fix(?:ed)? (?:was|by|it by)|fails? (?:if|when|because)|breaks? (?:if|when)|broke because|because the|note that|important:|heads up)\b/i },
];
const KIND_PRECEDENCE: DistillKind[] = ['preference', 'constraint', 'gotcha', 'decision'];
// Strong "X not Y" / "X instead of Y" decision signal (e.g. "pnpm not npm", "tabs over spaces").
const X_NOT_Y = /\b[\w.@/+-]{2,}\s*,?\s+(?:not|instead of|over|rather than)\s+[\w.@/+-]{2,}\b/i;

const MAX_CANDIDATES = 12;
const MIN_WORDS = 4;
const MAX_WORDS = 45;

function looksLikeCodeOrLog(s: string): boolean {
  if (/^\s*[$#>]/.test(s)) return true; // shell prompt / diff marker
  if (/[{};=]\s*$/.test(s) && /[(){}\[\]=;]/.test(s)) return true; // code-ish line
  if (/\b(at |Error:|Traceback|stack trace|node_modules\/)/.test(s) && /:\d+/.test(s)) return true; // stack trace
  const symbolRatio = (s.replace(/[\w\s]/g, '').length || 0) / Math.max(1, s.length);
  return symbolRatio > 0.3; // mostly punctuation/symbols
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^[-*•\d.)\s]+/, '').trim();
}

function classifyKind(s: string): DistillKind | undefined {
  const matched = new Set(SIGNALS.filter((sig) => sig.re.test(s)).map((sig) => sig.kind));
  for (const kind of KIND_PRECEDENCE) {
    if (matched.has(kind)) return kind;
  }
  return X_NOT_Y.test(s) ? 'decision' : undefined;
}

/**
 * Extract durable-fact candidates from a transcript. Skips questions, chit-chat, code/log lines,
 * and too-short/too-long sentences; requires a decision/gotcha/preference/constraint signal.
 */
export function distillSession(messages: DistillMessage[]): DistillCandidate[] {
  const out: DistillCandidate[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    for (const raw of splitSentences(msg.text)) {
      const s = normalize(raw);
      const words = s.split(/\s+/).filter(Boolean);
      if (words.length < MIN_WORDS || words.length > MAX_WORDS) continue;
      if (s.endsWith('?')) continue; // questions aren't durable facts
      if (looksLikeCodeOrLog(s)) continue;
      const kind = classifyKind(s);
      if (!kind) continue;
      const key = s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ text: s, kind });
      if (out.length >= MAX_CANDIDATES) return out;
    }
  }
  return out;
}

/** flatten an AI-SDK ModelMessage content (string | parts[]) to its plain text. */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (p && typeof p === 'object' && 'text' in p && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
    .join(' ')
    .trim();
}

/** distill durable-fact candidates from a finished conversation (ModelMessage[]-shaped). Pure. */
export function distilledCandidatesFromMessages(messages: { role: string; content: unknown }[]): DistillCandidate[] {
  return distillSession(messages.map((m) => ({ role: m.role, text: messageText(m.content) })));
}

/** distill durable-fact texts from a finished conversation (ModelMessage[]-shaped). Pure. */
export function distilledFactsFromMessages(messages: { role: string; content: unknown }[]): string[] {
  return distilledCandidatesFromMessages(messages).map((c) => c.text);
}
