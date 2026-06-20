// minimal unified-ish diff (zero dep) — โชว์ให้เห็นว่าแก้อะไรก่อน/หลัง โปร่งใส
const MAX_LINES = 14;

/** structured changed-region of an edit: common prefix/suffix trimmed, each side capped at `max`. */
export interface EditDiffSegments {
  removed: string[];
  added: string[];
  /** removed lines beyond `max` (0 if none) */
  moreRemoved: number;
  /** added lines beyond `max` (0 if none) */
  moreAdded: number;
}

/**
 * core prefix/suffix-trim diff — shared by renderEditDiff (string) and the REPL's colored
 * diffLines (src/ui/tool-activity.ts) so the algorithm lives in one place. Callers pick their
 * own line cap; only the formatting differs.
 */
export function editDiffSegments(oldStr: string, newStr: string, max = MAX_LINES): EditDiffSegments {
  const oldL = oldStr.split('\n');
  const newL = newStr.split('\n');
  // ตัด common prefix/suffix lines ที่เหมือนกัน เพื่อโชว์เฉพาะส่วนที่เปลี่ยน
  let pre = 0;
  while (pre < oldL.length && pre < newL.length && oldL[pre] === newL[pre]) pre++;
  let suf = 0;
  while (
    suf < oldL.length - pre &&
    suf < newL.length - pre &&
    oldL[oldL.length - 1 - suf] === newL[newL.length - 1 - suf]
  )
    suf++;

  const oldMid = oldL.slice(pre, oldL.length - suf);
  const newMid = newL.slice(pre, newL.length - suf);
  return {
    removed: oldMid.slice(0, max),
    added: newMid.slice(0, max),
    moreRemoved: Math.max(0, oldMid.length - max),
    moreAdded: Math.max(0, newMid.length - max),
  };
}

/** diff ของ edit (old block → new block) — render เป็น -old / +new */
export function renderEditDiff(oldStr: string, newStr: string): string {
  const seg = editDiffSegments(oldStr, newStr, MAX_LINES);
  const lines: string[] = [];
  for (const l of seg.removed) lines.push(`- ${l}`);
  if (seg.moreRemoved) lines.push(`  …(-${seg.moreRemoved} บรรทัด)`);
  for (const l of seg.added) lines.push(`+ ${l}`);
  if (seg.moreAdded) lines.push(`  …(+${seg.moreAdded} บรรทัด)`);
  return lines.join('\n');
}

/** สรุปการ write — จำนวนบรรทัด/ตัวอักษร + ถ้าเขียนทับ บอก before→after */
export function summarizeWrite(content: string, previous?: string): string {
  const lines = countLogicalLines(content);
  if (previous === undefined) return `เขียนใหม่ ${lines} บรรทัด (${content.length} ตัวอักษร)`;
  const prevLines = countLogicalLines(previous);
  return `เขียนทับ ${prevLines} → ${lines} บรรทัด (${content.length} ตัวอักษร)`;
}

function countLogicalLines(content: string): number {
  if (content === '') return 0;
  const lines = content.split(/\r\n|\n|\r/);
  if (/(\r\n|\n|\r)$/.test(content)) lines.pop();
  return lines.length;
}
