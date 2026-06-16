import { useState, useRef } from 'react';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ModelMessage } from 'ai';
import { Box, Text, Static, useApp, useInput } from 'ink';
import {
  BUILTIN_COMMANDS,
  expandCustomCommand,
  loadCustomCommands,
  parseCommand,
  parseSlashInvocation,
} from '../commands.js';
import { runAgent, type AgentEvent } from '../loop.js';
import { saveSession, newSessionId } from '../session.js';
import { getBrainPath, appendBrainWorklog } from '../memory.js';
import { autoCompact, estimateTokens, summarizeCompact } from '../compaction.js';
import { makeSummarizer } from '../summarize.js';
import { agentTuning } from '../config.js';
import { snapshotWorkTree, restoreWorkTree } from '../checkpoint.js';
import { useEditor } from './useEditor.js';
import { loadHistory, appendHistory } from './history.js';
import { expandMentions } from './mentions.js';
import { BRAND } from '../brand.js';
import { Banner } from './banner.js';

const execFileP = promisify(execFile);
const PRE_TURN_COMPACT_TOKENS = 100_000; // session ยาวมากเท่านั้นถึง summarize ก่อน turn (mode summarize)

interface Turn {
  id: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
}
interface Mark {
  turnId: number;
  msgLen: number;
}
interface Checkpoint extends Mark {
  ref: string | null; // git snapshot ref (null = ไม่ใช่ git repo → ย้อนแค่บทสนทนา)
}

export interface AppProps {
  initialModel: string;
  fallbackModel?: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  /** ต่อจาก session ก่อน (sanook -c) — โหลด conversation เดิมเข้า REPL */
  initialHistory?: ModelMessage[];
  /** system note แสดงตอนเปิด (เช่น ผล scaffold second-brain หลัง setup wizard) */
  initialNote?: string;
}

export function App({ initialModel, fallbackModel, budgetUsd, permissionMode = 'ask', initialHistory, initialNote }: AppProps) {
  const { exit } = useApp();
  const [history, setHistory] = useState<Turn[]>(() => {
    const seed: Turn[] = [];
    if (initialNote) seed.push({ id: -2, role: 'system', text: initialNote });
    if (initialHistory?.length) seed.push({ id: -1, role: 'system', text: `↻ ต่อจาก session ก่อน (${initialHistory.length} ข้อความ)` });
    return seed;
  });
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState(initialModel);
  const [approvalReq, setApprovalReq] = useState<{ tool: string; summary: string } | null>(null);
  const idRef = useRef(0);
  const lastCost = useRef<string>('');
  const msgsRef = useRef<ModelMessage[]>(initialHistory ?? []); // conversation จริงสำหรับ LLM (สะสมข้ามรอบ)
  const sessionId = useRef(newSessionId());
  const sessionCreated = useRef(new Date().toISOString());
  const approvalResolve = useRef<((ok: boolean) => void) | null>(null);
  const replHistory = useRef<string[]>(loadHistory()); // prompt เก่า (persist) สำหรับ ↑/↓
  const checkpoints = useRef<Checkpoint[]>([]);
  const editor = useEditor(replHistory.current);
  // real-time steering: หยุด turn ที่กำลังรัน (abort) + คิวข้อความที่พิมพ์ระหว่าง busy
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<string[]>([]);
  const [queued, setQueued] = useState<string[]>([]);
  const enqueue = (msg: string): void => {
    queueRef.current.push(msg);
    setQueued([...queueRef.current]);
  };
  const dequeue = (): string | undefined => {
    const m = queueRef.current.shift();
    setQueued([...queueRef.current]);
    return m;
  };
  const clearQueue = (): void => {
    queueRef.current = [];
    setQueued([]);
  };

  const addTurn = (role: Turn['role'], text: string): void =>
    setHistory((h) => [...h, { id: idRef.current++, role, text }]);

  // /diff /undo — git-backed (execFile ไม่ผ่าน shell)
  async function runGit(args: string[], label: string): Promise<void> {
    try {
      const { stdout, stderr } = await execFileP('git', args, { cwd: process.cwd(), maxBuffer: 1_000_000 });
      addTurn('system', (stdout || stderr).trim() || `(${label}: ไม่มีการเปลี่ยนแปลง)`);
    } catch (e) {
      addTurn('system', `git ${label}: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  // ask-mode: tool ขออนุมัติ → คืน Promise ที่ resolve เมื่อ user กด y/n
  const requestApproval = (tool: string, summary: string): Promise<boolean> =>
    new Promise((resolve) => {
      approvalResolve.current = resolve;
      setApprovalReq({ tool, summary });
    });

  useInput((input, key) => {
    // มี approval ค้าง → จับ y/n ก่อน (แม้ agent กำลังรัน/busy)
    if (approvalReq) {
      if (input === 'y' || input === 'Y' || key.return) {
        approvalResolve.current?.(true);
        setApprovalReq(null);
      } else if (input === 'n' || input === 'N' || key.escape) {
        approvalResolve.current?.(false);
        setApprovalReq(null);
      }
      return;
    }
    if (busy) {
      // steering ระหว่าง turn: Esc / Ctrl+C = หยุด turn นี้ (ไม่ออกจากแอป) + ล้างคิว
      if (key.escape || (key.ctrl && input === 'c')) {
        abortRef.current?.abort();
        clearQueue();
        return;
      }
      // พิมพ์ระหว่าง busy ได้ — Enter = ต่อคิว (รันอัตโนมัติหลัง turn นี้จบ)
      const a = editor.handleKey(input, key);
      if (a === 'submit') {
        const v = editor.value.trim();
        editor.reset();
        if (v) enqueue(v);
      }
      return;
    }
    const action = editor.handleKey(input, key);
    if (action === 'submit') void submit(editor.value);
    else if (action === 'interrupt') {
      if (editor.value) editor.reset(); // Ctrl+C ครั้งแรก = ล้างบรรทัด, ว่างแล้ว = ออก
      else exit();
    }
  });

  /** ย้อน 1 turn — คืนไฟล์ (git, recoverable) + ตัดบทสนทนากลับ */
  async function rewind(): Promise<void> {
    const cp = checkpoints.current.pop();
    if (!cp) {
      addTurn('system', 'ไม่มี checkpoint ให้ย้อน');
      return;
    }
    let note = '';
    if (cp.ref) {
      const r = await restoreWorkTree(cp.ref);
      note = r.ok
        ? r.recovery
          ? ` · ไฟล์คืนแล้ว (กู้สถานะก่อนหน้า: ${r.recovery})`
          : ' · ไฟล์คืนแล้ว'
        : ` · ไฟล์: ${r.reason}`;
    }
    msgsRef.current = msgsRef.current.slice(0, cp.msgLen);
    setHistory((h) => h.filter((t) => t.id < cp.turnId));
    addTurn('system', `↩ ย้อนกลับ 1 turn${note}`);
  }

  /** บีบ context: 'summarize' (ใช้ model ถูกย่อ) ถ้าตั้งไว้ ไม่งั้น 'truncate' (zero-LLM) */
  async function compactHistory(targetTokens: number, label: string): Promise<void> {
    const before = estimateTokens(msgsRef.current);
    if (before <= targetTokens) {
      addTurn('system', `context ~${before} tokens — ยังไม่ต้องบีบ`);
      return;
    }
    const tuning = await agentTuning().catch(() => null);
    if (tuning?.compaction === 'summarize') {
      addTurn('system', '⏳ กำลังย่อ context ด้วย model ถูก…');
      msgsRef.current = await summarizeCompact(
        msgsRef.current,
        targetTokens,
        makeSummarizer(model, tuning.summaryModel),
        20,
      ).catch(() => autoCompact(msgsRef.current, targetTokens, 20));
      addTurn('system', `ย่อ context แล้ว (summarize): ~${before} → ~${estimateTokens(msgsRef.current)} tokens`);
    } else {
      msgsRef.current = autoCompact(msgsRef.current, targetTokens, 20);
      addTurn('system', `บีบ context แล้ว: ~${before} → ~${estimateTokens(msgsRef.current)} tokens`);
    }
  }

  async function submit(raw: string): Promise<void> {
    const text = raw.trim();
    editor.reset();
    if (!text) return;
    appendHistory(text, replHistory.current[replHistory.current.length - 1]);
    replHistory.current.push(text);

    const slash = parseSlashInvocation(text);
    if (slash) {
      if (slash.name === 'rewind') {
        await rewind();
        return;
      }
      if (!BUILTIN_COMMANDS.has(slash.name)) {
        const custom = (await loadCustomCommands()).get(slash.name);
        if (custom) {
          const expanded = expandCustomCommand(custom, slash.args);
          const mark = { turnId: idRef.current, msgLen: msgsRef.current.length };
          addTurn('user', text);
          if (!expanded.trim()) {
            addTurn('system', `custom command /${slash.name} ว่าง`);
            return;
          }
          await runAssistantTurn(expanded, [], mark);
          return;
        }
      }
    }

    const cmd = parseCommand(text, { model, costSummary: lastCost.current });
    if (cmd.handled) {
      addTurn('user', text);
      if (cmd.action === 'quit') return exit();
      if (cmd.action === 'clear') {
        msgsRef.current = [];
        checkpoints.current = [];
        return setHistory([]);
      }
      if (cmd.action === 'compact') {
        void compactHistory(40_000, 'บีบ context');
        return;
      }
      if (cmd.action === 'diff') return void runGit(['diff', '--stat'], 'diff');
      if (cmd.action === 'undo') {
        void runGit(['stash', 'push', '-u', '-m', BRAND.undoStashMessage], 'undo').then(() =>
          addTurn('system', 'กู้คืน: git stash pop'),
        );
        return;
      }
      if (cmd.modelChange) setModel(cmd.modelChange);
      if (cmd.message) addTurn('system', cmd.message);
      return;
    }

    // prompt ปกติ → expand @mentions (inline ไฟล์ text + เก็บ path รูป)
    const mark = { turnId: idRef.current, msgLen: msgsRef.current.length };
    addTurn('user', text);
    const { text: expanded, images, errors } = await expandMentions(text);
    if (errors.length) addTurn('system', `@mention: ${errors.join(' · ')}`);
    await runAssistantTurn(expanded, images, mark);
  }

  async function runAssistantTurn(promptText: string, images: string[], mark: Mark): Promise<void> {
    // proactive summarize-compaction สำหรับ session ยาวมาก (เฉพาะ mode summarize) — เริ่ม turn ให้ context lean
    // (mode truncate: ปล่อยให้ loop.ts ตัดต่อ-step เอา; ไม่บีบที่นี่ กัน latency)
    if (estimateTokens(msgsRef.current) > PRE_TURN_COMPACT_TOKENS) {
      const t = await agentTuning().catch(() => null);
      if (t?.compaction === 'summarize') {
        addTurn('system', '⏳ context ยาว — ย่ออัตโนมัติก่อนรอบนี้…');
        msgsRef.current = await summarizeCompact(
          msgsRef.current,
          PRE_TURN_COMPACT_TOKENS,
          makeSummarizer(model, t.summaryModel),
          20,
        ).catch(() => msgsRef.current);
      }
    }
    // checkpoint สถานะก่อนรัน (ไฟล์ git + ขอบเขตบทสนทนา) → /rewind ย้อนได้
    const ref = await snapshotWorkTree();
    checkpoints.current.push({ ref, turnId: mark.turnId, msgLen: mark.msgLen });
    const ac = new AbortController(); // steering: ให้ Esc/Ctrl+C หยุด stream กลางทางได้
    abortRef.current = ac;
    setBusy(true);
    let buf = '';
    let lastFlush = 0;
    try {
      const { cost, messages, text } = await runAgent({
        model,
        fallbackModel,
        prompt: promptText,
        images: images.length ? images : undefined,
        history: msgsRef.current,
        budgetUsd,
        permissionMode,
        approve: requestApproval,
        signal: ac.signal,
        onEvent: (e: AgentEvent) => {
          if (e.type === 'text') {
            buf += e.text ?? '';
            const now = Date.now();
            if (now - lastFlush > 80) {
              setStreaming(buf);
              lastFlush = now;
            }
          } else if (e.type === 'tool-call') {
            buf += `\n→ ${e.tool}\n`;
            setStreaming(buf);
          }
        },
      });
      msgsRef.current = messages;
      lastCost.current = cost.summary();
      addTurn('assistant', buf.trim() || text.trim());
      // เซฟ session ทุกรอบ → resume ได้ด้วย sanook -c
      void saveSession({
        id: sessionId.current,
        created: sessionCreated.current,
        updated: new Date().toISOString(),
        model,
        cwd: process.cwd(),
        messages,
      });
      // worklog เข้า second-brain — vault จำว่าทำอะไรใน session นี้
      void (async () => {
        const brain = await getBrainPath();
        if (brain) {
          await appendBrainWorklog(brain, {
            prompt: promptText,
            summary: cost.summary(),
            model,
            today: new Date().toISOString().slice(0, 10),
          }).catch(() => {});
        }
      })();
    } catch (err) {
      if (ac.signal.aborted) {
        // หยุดเอง — เก็บ partial output ไว้ดู, ทิ้ง turn นี้ออกจาก LLM history (msgsRef ไม่อัปเดต)
        if (buf.trim()) addTurn('assistant', buf.trim());
        addTurn('system', '⊘ หยุด turn แล้ว (ไฟล์ที่ tool แก้ไปแล้วคืนด้วย /rewind ได้)');
      } else {
        addTurn('system', `ERROR: ${(err as Error).message}`);
      }
    } finally {
      setStreaming('');
      setBusy(false);
      abortRef.current = null;
    }
    // steering: ข้อความที่พิมพ์ค้างคิวระหว่าง turn → รันต่อทันที (ถ้าไม่ได้ถูกหยุด)
    const next = ac.signal.aborted ? undefined : dequeue();
    if (next) void submit(next);
  }

  const costHint = lastCost.current.includes('cost ') ? lastCost.current.split('cost ')[1] : '';

  return (
    <Box flexDirection="column">
      {history.length === 0 ? <Banner model={model} /> : null}
      <Static items={history}>{(turn) => <TurnView key={turn.id} turn={turn} />}</Static>
      {streaming ? (
        <Box marginTop={1}>
          <Text>{streaming}</Text>
        </Box>
      ) : null}
      {queued.length ? (
        <Box flexDirection="column" marginTop={1}>
          {queued.map((q, i) => (
            <Text key={i} dimColor>
              ⏳ คิว {i + 1}: {q.length > 64 ? `${q.slice(0, 64)}…` : q}
            </Text>
          ))}
        </Box>
      ) : null}
      {approvalReq ? (
        <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text color="yellow">อนุมัติรัน {approvalReq.tool}?</Text>
          <Text dimColor>{approvalReq.summary}</Text>
          <Text dimColor>y = รัน · n = ปฏิเสธ</Text>
        </Box>
      ) : (
        <Box marginTop={1} borderStyle="round" borderColor={busy ? 'gray' : 'blue'} paddingX={1}>
          <Text color={busy ? 'gray' : 'cyan'}>{busy ? '· ' : '› '}</Text>
          <InputView value={editor.value} cursor={editor.cursor} busy={busy} />
        </Box>
      )}
      <Text dimColor>
        {'  '}
        {model} · {permissionMode === 'ask' ? 'ask-mode' : 'auto'} · /help · @file · ↑ history
        {costHint ? ` · ${costHint}` : ''}
      </Text>
    </Box>
  );
}

/** input ที่มี cursor (inverse) + placeholder — minimal; รับ input ได้แม้ busy (ต่อคิว) */
function InputView({ value, cursor, busy }: { value: string; cursor: number; busy: boolean }) {
  if (busy && !value) return <Text dimColor>กำลังทำงาน… Esc/Ctrl+C หยุด · พิมพ์เพื่อต่อคิว (⏎)</Text>;
  if (!busy && !value) return <Text dimColor>ถามอะไรก็ได้ — /help ดูคำสั่ง · /tools ดู tools · @ไฟล์ แนบ context/รูป</Text>;
  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1) || ' ';
  const after = value.slice(cursor + 1);
  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
      {busy ? <Text dimColor>{'  '}(⏎ ต่อคิว)</Text> : null}
    </Text>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === 'system') return <Text dimColor>{turn.text}</Text>;
  if (turn.role === 'user')
    return (
      <Box marginTop={1}>
        <Text color="cyan">› </Text>
        <Text color="cyan">{turn.text}</Text>
      </Box>
    );
  return (
    <Box marginTop={1}>
      <Text>{turn.text}</Text>
    </Box>
  );
}
