// Prompt-injection fencing for memory/persona content that gets wrapped in XML-ish blocks
// (<auto_memory>, <owner_persona>, <brain_vault>, …) inside the system prompt. A remembered fact or
// vault line is untrusted data — if it contains a literal `</auto_memory>` (or a fake `<system>` /
// role tag) it could forge the end of its block and smuggle instructions into the prompt. We break any
// such boundary token by inserting a zero-width space after the `<`, so the rendered text looks
// identical to a human but no longer parses as a real tag.

const BLOCK_TAGS = /<\/?\s*(auto_memory|owner_persona|brain_vault|memory|system|user|assistant|tool_result|tool_call)\b/gi;

const ZW = '​'; // zero-width space — visually invisible, breaks the `<tag` token

/** Neutralize block-boundary / role tags embedded in untrusted memory text. Idempotent-ish and safe on
 * normal prose (only touches the specific tag tokens above). */
export function neutralizeBlockTags(text: string): string {
  return text.replace(BLOCK_TAGS, (m) => `<${ZW}${m.slice(1)}`);
}
