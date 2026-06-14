import { useState, useRef, useMemo } from 'react';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ModelMessage } from 'ai';
import { Box, Text, Static, useApp, useInput } from 'ink';

const execFileP = promisify(execFile);
import { parseCommand } from '../commands.js';
import { runAgent, type AgentEvent } from '../loop.js';
import { saveSession, newSessionId } from '../session.js';
import { getBrainPath, appendBrainWorklog } from '../memory.js';
import { autoCompact, estimateTokens } from '../compaction.js';
import { BRAND } from '../brand.js';
import { Banner } from './banner.js';

interface Turn {
  id: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export interface AppProps {
  initialModel: string;
  fallbackModel?: string;
  budgetUsd?: number;
  permissionMode?: 'auto' | 'ask';
  /** ต่อจาก session ก่อน (sanook -c) — โหลด conversation เดิมเข้า REPL */
  initialHistory?: ModelMessage[];
}

export function App({ initialModel, fallbackModel, budgetUsd, permissionMode = 'ask', initialHistory }: AppProps) {
  const { exit } = useApp();
  const [history, setHistory] = useState<Turn[]>(
    initialHistory?.length
      ? [{ id: -1, role: 'system', text: `↻ ต่อจาก session ก่อน (${initialHistory.length} ข้อความ)` }]
      : [],
  );
  const [input, setInput] = useState('');
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

  useInput((char, key) => {
    // มี approval ค้าง → จับ y/n ก่อน (แม้ agent กำลังรัน/busy)
    if (approvalReq) {
      if (char === 'y' || char === 'Y' || key.return) {
        approvalResolve.current?.(true);
        setApprovalReq(null);
      } else if (char === 'n' || char === 'N' || key.escape) {
        approvalResolve.current?.(false);
        setApprovalReq(null);
      }
      return;
    }
    if (busy) return;
    if (key.return) {
      void submit();
    } else if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
    } else if (key.ctrl && char === 'c') {
      exit();
    } else if (char && !key.ctrl && !key.meta) {
      setInput((s) => s + char);
    }
  });

  async function submit(): Promise<void> {
    const text = input.trim();
    if (!text) return;
    setInput('');

    const cmd = parseCommand(text, { model, costSummary: lastCost.current });
    if (cmd.handled) {
      addTurn('user', text);
      if (cmd.action === 'quit') return exit();
      if (cmd.action === 'clear') {
        msgsRef.current = [];
        return setHistory([]);
      }
      if (cmd.action === 'compact') {
        const before = estimateTokens(msgsRef.current);
        msgsRef.current = autoCompact(msgsRef.current, 40_000, 20);
        const after = estimateTokens(msgsRef.current);
        addTurn('system', `บีบ context แล้ว: ~${before} → ~${after} tokens`);
        return;
      }
      if (cmd.action === 'diff') {
        void runGit(['diff', '--stat'], 'diff');
        return;
      }
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

    addTurn('user', text);
    setBusy(true);
    let buf = '';
    let lastFlush = 0;
    try {
      const { cost, messages } = await runAgent({
        model,
        fallbackModel,
        prompt: text,
        history: msgsRef.current,
        budgetUsd,
        permissionMode,
        approve: requestApproval,
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
      addTurn('assistant', buf.trim());
      // เซฟ session ทุกรอบ → resume ได้ด้วย sanook -c (เดิม REPL ไม่เคยเซฟ)
      void saveSession({
        id: sessionId.current,
        created: sessionCreated.current,
        updated: new Date().toISOString(),
        model,
        cwd: process.cwd(),
        messages,
      });
      // worklog เข้า second-brain (REPL ก็เขียน ไม่ใช่แค่ headless) — vault จำว่าทำอะไรใน session นี้
      void (async () => {
        const brain = await getBrainPath();
        if (brain) {
          await appendBrainWorklog(brain, {
            prompt: text,
            summary: cost.summary(),
            model,
            today: new Date().toISOString().slice(0, 10),
          }).catch(() => {});
        }
      })();
    } catch (err) {
      addTurn('system', `ERROR: ${(err as Error).message}`);
    } finally {
      setStreaming('');
      setBusy(false);
    }
  }

  const banner = useMemo(() => <Banner model={initialModel} />, [initialModel]);

  return (
    <Box flexDirection="column">
      {banner}
      <Static items={history}>{(turn) => <TurnView key={turn.id} turn={turn} />}</Static>
      {streaming ? <Text>{streaming}</Text> : null}
      {approvalReq ? (
        <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text color="yellow">⚠ ขออนุมัติรัน {approvalReq.tool}</Text>
          <Text>{approvalReq.summary}</Text>
          <Text color="gray">อนุมัติ? (y = รัน · n = ปฏิเสธ)</Text>
        </Box>
      ) : (
        <Box borderStyle="round" borderColor="gray" paddingX={1}>
          <Text color={busy ? 'gray' : 'cyan'}>{busy ? '… ' : '› '}</Text>
          <Text>{input || (busy ? '' : 'พิมพ์คำสั่ง หรือ /help')}</Text>
        </Box>
      )}
      <Text color="gray" dimColor>
        {'  '}? for shortcuts · /help · model: {model}
        {permissionMode === 'ask' ? ' · 🔒 ask-mode' : ''}
      </Text>
    </Box>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const color = turn.role === 'user' ? 'cyan' : turn.role === 'system' ? 'yellow' : undefined;
  return (
    <Text color={color}>
      {turn.role === 'user' ? '› ' : ''}
      {turn.text}
    </Text>
  );
}
