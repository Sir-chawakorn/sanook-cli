// minimal unified-ish diff (zero dep) — โชว์ให้เห็นว่าแก้อะไรก่อน/หลัง โปร่งใส
const MAX_LINES = 14;

/** diff ของ edit (old block → new block) — render เป็น -old / +new */
export function renderEditDiff(oldStr: string, newStr: string): string {
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
  const lines: string[] = [];
  for (const l of oldMid.slice(0, MAX_LINES)) lines.push(`- ${l}`);
  if (oldMid.length > MAX_LINES) lines.push(`  …(-${oldMid.length - MAX_LINES} บรรทัด)`);
  for (const l of newMid.slice(0, MAX_LINES)) lines.push(`+ ${l}`);
  if (newMid.length > MAX_LINES) lines.push(`  …(+${newMid.length - MAX_LINES} บรรทัด)`);
  return lines.join('\n');
}

/** สรุปการ write — จำนวนบรรทัด/ตัวอักษร + ถ้าเขียนทับ บอก before→after */
export function summarizeWrite(content: string, previous?: string): string {
  const lines = content === '' ? 0 : content.split('\n').length;
  if (previous === undefined) return `เขียนใหม่ ${lines} บรรทัด (${content.length} ตัวอักษร)`;
  const prevLines = previous === '' ? 0 : previous.split('\n').length;
  return `เขียนทับ ${prevLines} → ${lines} บรรทัด (${content.length} ตัวอักษร)`;
}
