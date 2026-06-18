import type { ModelMessage } from 'ai';
import { selectiveCompressText } from './context-compression.js';

const TRUNC_HEAD = 400;
const TRUNC_TAIL = 600;
const CHARS_PER_TOKEN = 4; // ประมาณคร่าวๆ (จริง ~3.5-4 ต่อ token)
const SELECTIVE_TOOL_TARGET_CHARS = 6_000;
const SELECTIVE_TOOL_MIN_CHARS = 8_000;

function textFromMessageContent(content: ModelMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'object' && part && 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') return part.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function latestUserText(messages: readonly ModelMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    const text = textFromMessageContent(messages[i].content).trim();
    if (text) return text;
  }
  return undefined;
}

function adaptiveStaleTarget(baseTarget: number, rank: number, count: number): number {
  if (count <= 1) return baseTarget;
  const recency = rank / Math.max(1, count - 1); // 0 = oldest, 1 = newest stale
  return Math.max(1_500, Math.floor(baseTarget * (0.35 + 0.65 * recency)));
}

function adaptiveMinChars(targetChars: number, baseMinChars: number): number {
  return Math.min(baseMinChars, Math.max(targetChars + 1_000, Math.floor(targetChars * 1.45)));
}

/** ตัดข้อความยาว เก็บหัว (intent) + ท้าย (error/result) */
export function truncateText(s: string): string {
  if (s.length <= TRUNC_HEAD + TRUNC_TAIL + 40) return s;
  return (
    s.slice(0, TRUNC_HEAD) +
    `\n... [pruned ${s.length - TRUNC_HEAD - TRUNC_TAIL} chars] ...\n` +
    s.slice(-TRUNC_TAIL)
  );
}

/**
 * prune tool-result ที่ยาวใน message เก่า (นอก tail) ให้สั้นลง
 * — tool transcript มักเป็น ~90%+ ของ token ในงานยาว, clear ก่อนเป็นวิธีถูกสุด
 * เก็บ message ท้าย keepTail ไว้เต็ม (ยัง relevant ต่อ step ถัดไป)
 */
export function pruneToolResults(messages: ModelMessage[], keepTail = 4): ModelMessage[] {
  const cut = Math.max(0, messages.length - keepTail);
  let changed = false;
  const out = messages.map((m, i) => {
    if (i >= cut) return m;
    if (m.role !== 'tool' || !Array.isArray(m.content)) return m;
    const content = m.content.map((part) => {
      if (
        part.type === 'tool-result' &&
        part.output?.type === 'text' &&
        typeof part.output.value === 'string'
      ) {
        const compressed = selectiveCompressText(part.output.value, {
          targetChars: SELECTIVE_TOOL_TARGET_CHARS,
          minChars: SELECTIVE_TOOL_MIN_CHARS,
        });
        if (compressed.changed) {
          changed = true;
          return { ...part, output: { ...part.output, value: compressed.text } };
        }
        const truncated = truncateText(part.output.value);
        if (truncated !== part.output.value) {
          changed = true;
          return { ...part, output: { ...part.output, value: truncated } };
        }
      }
      return part;
    });
    return content === m.content ? m : ({ ...m, content } as ModelMessage);
  });
  return changed ? out : messages;
}

/**
 * Per-step token optimizer (zero LLM cost).
 * Compresses stale, very large tool results before each model request while keeping the latest tail full.
 */
export function selectivelyCompressStaleToolResults(
  messages: ModelMessage[],
  keepTail = 6,
  targetChars = SELECTIVE_TOOL_TARGET_CHARS,
  minChars = SELECTIVE_TOOL_MIN_CHARS,
  query = latestUserText(messages),
): ModelMessage[] {
  const cut = Math.max(0, messages.length - keepTail);
  const staleToolIndexes = messages
    .map((m, i) => ({ m, i }))
    .filter(({ m, i }) => i < cut && m.role === 'tool' && Array.isArray(m.content))
    .map(({ i }) => i);
  const rankByIndex = new Map(staleToolIndexes.map((index, rank) => [index, rank]));
  let changed = false;
  const out = messages.map((m, i) => {
    if (i >= cut) return m;
    if (m.role !== 'tool' || !Array.isArray(m.content)) return m;
    let messageChanged = false;
    const adaptiveTarget = adaptiveStaleTarget(targetChars, rankByIndex.get(i) ?? 0, staleToolIndexes.length);
    const adaptiveMin = adaptiveMinChars(adaptiveTarget, minChars);
    const content = m.content.map((part) => {
      if (
        part.type === 'tool-result' &&
        part.output?.type === 'text' &&
        typeof part.output.value === 'string'
      ) {
        const compressed = selectiveCompressText(part.output.value, { targetChars: adaptiveTarget, minChars: adaptiveMin, query });
        if (compressed.changed) {
          changed = true;
          messageChanged = true;
          return { ...part, output: { ...part.output, value: compressed.text } };
        }
      }
      return part;
    });
    return messageChanged ? ({ ...m, content } as ModelMessage) : m;
  });
  return changed ? out : messages;
}

/** ประมาณ token ของ conversation (chars/4) — ไม่เป๊ะแต่พอใช้ตัดสิน compact */
export function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      chars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const part of m.content as Record<string, unknown>[]) {
        if (typeof part.text === 'string') chars += part.text.length;
        else if (
          part.type === 'tool-result' &&
          (part.output as { type?: string; value?: unknown })?.type === 'text' &&
          typeof (part.output as { value?: unknown }).value === 'string'
        ) {
          chars += ((part.output as { value: string }).value).length;
        } else {
          chars += JSON.stringify(part).length;
        }
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * auto-compact (zero LLM cost) — กัน context overflow ในงานยาว:
 * 1) ถ้า token ≤ limit → คืนเดิม (no-op)
 * 2) prune tool results เต็ม (transcript = token ส่วนใหญ่)
 * 3) ยังเกิน → sliding window: เก็บ user แรก (intent) + N message ล่าสุด, ตัดกลาง + marker
 */
export function autoCompact(messages: ModelMessage[], tokenLimit: number, keepRecent = 20): ModelMessage[] {
  if (estimateTokens(messages) <= tokenLimit) return messages;

  // เก็บ system message ที่นำหน้า (cached preamble: SYSTEM/skills/brain/git) ไว้เสมอ — ห้ามตัดทิ้ง
  const firstNon = messages.findIndex((m) => m.role !== 'system');
  const lead = firstNon > 0 ? messages.slice(0, firstNon) : [];
  const body = lead.length ? messages.slice(lead.length) : messages;
  const withLead = (rest: ModelMessage[]): ModelMessage[] => (lead.length ? [...lead, ...rest] : rest);

  const pruned = pruneToolResults(body, 2);
  if (estimateTokens(withLead(pruned)) <= tokenLimit) return withLead(pruned);

  if (pruned.length <= keepRecent + 1) return withLead(pruned);
  const firstUser = pruned.find((m) => m.role === 'user');
  let recent = pruned.slice(-keepRecent);
  // ตัด tool message ที่ค้างหัว — tool-result ที่ tool-call ถูกตัดไปแล้ว = orphan → API reject
  while (recent.length && recent[0].role === 'tool') recent = recent.slice(1);
  const marker: ModelMessage = {
    role: 'user',
    content: '[บทสนทนาเก่าถูกตัดออกเพื่อประหยัด context — รายละเอียดดูได้จาก memory/session]',
  };
  const tail = firstUser && !recent.includes(firstUser) ? [firstUser, marker, ...recent] : [marker, ...recent];
  return withLead(tail);
}

/** flatten messages → readable transcript (สำหรับให้ model ย่อ) — ตัด tool-result ยาวกัน prompt บวม */
export function messagesToText(messages: ModelMessage[]): string {
  const out: string[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      if (m.content.trim()) out.push(`${m.role}: ${m.content}`);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content as Record<string, unknown>[]) {
        if (typeof part.text === 'string' && part.text.trim()) out.push(`${m.role}: ${part.text}`);
        else if (part.type === 'tool-call') out.push(`${m.role}: [call ${String(part.toolName ?? 'tool')}]`);
        else if (
          part.type === 'tool-result' &&
          (part.output as { type?: string; value?: unknown })?.type === 'text' &&
          typeof (part.output as { value?: unknown }).value === 'string'
        ) {
          out.push(`tool: ${truncateText((part.output as { value: string }).value)}`);
        }
      }
    }
  }
  return out.join('\n');
}

/**
 * compaction แบบ "ย่อ" (quality สูงกว่า truncate): เก็บ system lead + user แรก (intent) + N message ล่าสุด,
 * ส่วนกลางถูก "ย่อ" ด้วย summarize() (cheap model) แทนการตัดทิ้ง → จำ context ได้ดีกว่าที่ budget เท่าเดิม.
 * pure orchestration (inject summarize) → test ได้โดยไม่ต้องมี LLM. summarize ล้มเหลว → fallback autoCompact.
 */
export async function summarizeCompact(
  messages: ModelMessage[],
  tokenLimit: number,
  summarize: (transcript: string) => Promise<string>,
  keepRecent = 20,
): Promise<ModelMessage[]> {
  if (estimateTokens(messages) <= tokenLimit) return messages;

  const firstNon = messages.findIndex((m) => m.role !== 'system');
  const lead = firstNon > 0 ? messages.slice(0, firstNon) : [];
  const body = lead.length ? messages.slice(lead.length) : messages;
  const withLead = (rest: ModelMessage[]): ModelMessage[] => (lead.length ? [...lead, ...rest] : rest);

  const pruned = pruneToolResults(body, 2);
  if (estimateTokens(withLead(pruned)) <= tokenLimit) return withLead(pruned);
  if (pruned.length <= keepRecent + 1) return withLead(pruned);

  const firstUser = pruned.find((m) => m.role === 'user');
  let recent = pruned.slice(-keepRecent);
  while (recent.length && recent[0].role === 'tool') recent = recent.slice(1); // กัน orphan tool-result หัว window
  const recentSet = new Set(recent);
  const middle = pruned.filter((m) => m !== firstUser && !recentSet.has(m));
  if (!middle.length) return withLead(firstUser ? [firstUser, ...recent] : recent);

  let summary: string;
  try {
    summary = (await summarize(messagesToText(middle))).trim();
  } catch {
    return autoCompact(messages, tokenLimit, keepRecent); // ย่อไม่ได้ → กลับไป truncate (ไม่บล็อกงาน)
  }
  if (!summary) return autoCompact(messages, tokenLimit, keepRecent);

  const summaryMsg: ModelMessage = {
    role: 'user',
    content: `[สรุปบทสนทนาก่อนหน้า (ย่อเพื่อประหยัด context)]\n${summary}`,
  };
  const tail = firstUser ? [firstUser, summaryMsg, ...recent] : [summaryMsg, ...recent];
  return withLead(tail);
}
