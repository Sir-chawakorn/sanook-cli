import type { ModelMessage } from 'ai';

const TRUNC_HEAD = 400;
const TRUNC_TAIL = 600;
const CHARS_PER_TOKEN = 4; // ประมาณคร่าวๆ (จริง ~3.5-4 ต่อ token)

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
  return messages.map((m, i) => {
    if (i >= cut) return m;
    if (m.role !== 'tool' || !Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map((part) => {
        if (
          part.type === 'tool-result' &&
          part.output?.type === 'text' &&
          typeof part.output.value === 'string'
        ) {
          return { ...part, output: { ...part.output, value: truncateText(part.output.value) } };
        }
        return part;
      }),
    } as ModelMessage;
  });
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
