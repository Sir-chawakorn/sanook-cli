import type { ModelMessage } from 'ai';

const TRUNC_HEAD = 400;
const TRUNC_TAIL = 600;

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
