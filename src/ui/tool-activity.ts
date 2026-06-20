// ============================================================================
// src/ui/tool-activity.ts — turns a tool call's INPUT into a human-friendly activity:
// a clear one-line title ("แก้ไฟล์ src/app.tsx", "$ npm test") plus, for code edits, a
// colored diff (green + additions, red - deletions). Computed at tool-call time so the
// REPL shows in detail what the agent is doing in real time — not after the fact.
// ============================================================================

export interface DiffLine {
  sign: '+' | '-' | ' ';
  text: string;
}

import { editDiffSegments } from '../diff.js';

export interface ToolActivity {
  /** human-friendly one-liner of what's happening */
  title: string;
  /** colored diff for edit/write (green +, red -) */
  diff?: DiffLine[];
}

// PER-SIDE diff cap (removed and added counted separately) — a two-sided edit can still yield up to
// ~2×this rows, so the overall per-row height bound is enforced by ActivityRow (MAX_ROW_DIFF_LINES).
// diffLines/additionLines append a correct "…(+N บรรทัด)" sentinel per side when exceeded.
const MAX_DIFF_LINES = 10;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function basenameish(p: string): string {
  return p.length > 52 ? `…${p.slice(-51)}` : p;
}

/** structured edit diff (old → new) with common prefix/suffix trimmed — green +, red -.
 * Built on the shared core in src/diff.ts so the algorithm doesn't drift from renderEditDiff. */
export function diffLines(oldStr: string, newStr: string, max = MAX_DIFF_LINES): DiffLine[] {
  const seg = editDiffSegments(oldStr, newStr, max);
  const out: DiffLine[] = [];
  for (const l of seg.removed) out.push({ sign: '-', text: l });
  if (seg.moreRemoved) out.push({ sign: ' ', text: `…(-${seg.moreRemoved} บรรทัด)` });
  for (const l of seg.added) out.push({ sign: '+', text: l });
  if (seg.moreAdded) out.push({ sign: ' ', text: `…(+${seg.moreAdded} บรรทัด)` });
  return out;
}

/** whole-content as additions (new file write) — all green. Drops the trailing empty line of a
 * file ending in \n so the green-line count matches the title's countLines() (no spurious blank). */
function additionLines(content: string, max = MAX_DIFF_LINES): DiffLine[] {
  if (content === '') return []; // empty write → no diff body (title already shows "+0 บรรทัด")
  const all = content.split('\n');
  if (content.endsWith('\n')) all.pop();
  const out: DiffLine[] = all.slice(0, max).map((text) => ({ sign: '+' as const, text }));
  if (all.length > max) out.push({ sign: ' ', text: `…(+${all.length - max} บรรทัด)` });
  return out;
}

function countLines(s: string): number {
  if (s === '') return 0;
  const lines = s.split('\n');
  if (s.endsWith('\n')) lines.pop();
  return lines.length;
}

/** map a tool name + its input into a friendly title (+ optional colored diff) */
export function describeToolCall(name: string, input: unknown): ToolActivity {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'edit_file': {
      const path = basenameish(str(i.path));
      const all = i.replace_all ? ' (ทุกที่)' : '';
      return { title: `✎ แก้ไฟล์ ${path}${all}`, diff: diffLines(str(i.old_string), str(i.new_string)) };
    }
    case 'write_file': {
      const path = basenameish(str(i.path));
      const content = str(i.content);
      return { title: `✚ เขียนไฟล์ ${path} (+${countLines(content)} บรรทัด)`, diff: additionLines(content) };
    }
    case 'run_bash':
      return { title: `$ ${str(i.cmd)}` };
    case 'run_python':
      return { title: i.path ? `▶ python ${str(i.path)}` : `▶ รัน python (${str(i.code).length} ตัวอักษร)` };
    case 'run_rust':
      return { title: i.path ? `▶ rust ${str(i.path)}` : `▶ รัน rust (${str(i.code).length} ตัวอักษร)` };
    case 'read_file':
      return { title: `📖 อ่านไฟล์ ${basenameish(str(i.path))}` };
    case 'list_dir':
      return { title: `📁 ดูโฟลเดอร์ ${basenameish(str(i.path) || '.')}` };
    case 'glob':
      return { title: `🔎 ค้นไฟล์ ${str(i.pattern)}` };
    case 'grep':
      return { title: `🔎 ค้นโค้ด "${str(i.pattern)}"` };
    case 'git_status':
      return { title: 'git status' };
    case 'git_diff':
      return { title: 'git diff' };
    case 'git_log':
      return { title: 'git log' };
    case 'git_commit':
      return { title: `⎇ git commit -m "${str(i.message).slice(0, 60)}"` };
    case 'remember':
      return { title: `🧠 จำ: ${str(i.fact).slice(0, 60)}` };
    case 'recall':
      return { title: `🧠 ค้นความจำ "${str(i.query)}"` };
    case 'create_skill':
      return { title: `✨ สร้าง skill ${str(i.name)}` };
    case 'find_skills':
      return { title: `✨ หา skill "${str(i.query)}"` };
    case 'skill':
      return { title: `✨ เปิด skill ${str(i.name)}` };
    case 'web_fetch':
      return { title: `🌐 โหลด ${str(i.url).slice(0, 60)}` };
    case 'task':
      return { title: `🤖 มอบงานให้ sub-agent: ${str(i.prompt || i.task).slice(0, 50)}` };
    case 'schedule_task':
      return { title: `⏰ ตั้งเวลา: ${str(i.when)} → ${str(i.task).slice(0, 40)}` };
    default: {
      const detail = pickDetail(i);
      return { title: detail ? `${name} ${detail}` : name };
    }
  }
}

function pickDetail(i: Record<string, unknown>): string {
  for (const key of ['path', 'query', 'pattern', 'name', 'url', 'id']) {
    if (typeof i[key] === 'string' && i[key]) return String(i[key]).slice(0, 60);
  }
  return '';
}
