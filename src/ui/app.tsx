import { useState, useRef, useMemo } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import { parseCommand } from '../commands.js';
import { runAgent, type AgentEvent } from '../loop.js';
import { Banner } from './banner.js';

interface Turn {
  id: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export interface AppProps {
  initialModel: string;
  budgetUsd?: number;
}

export function App({ initialModel, budgetUsd }: AppProps) {
  const { exit } = useApp();
  const [history, setHistory] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState(initialModel);
  const idRef = useRef(0);
  const lastCost = useRef<string>('');

  const addTurn = (role: Turn['role'], text: string): void =>
    setHistory((h) => [...h, { id: idRef.current++, role, text }]);

  useInput((char, key) => {
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
      if (cmd.action === 'clear') return setHistory([]);
      if (cmd.modelChange) setModel(cmd.modelChange);
      if (cmd.message) addTurn('system', cmd.message);
      return;
    }

    addTurn('user', text);
    setBusy(true);
    let buf = '';
    let lastFlush = 0;
    try {
      const { cost } = await runAgent({
        model,
        prompt: text,
        budgetUsd,
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
      lastCost.current = cost.summary();
      addTurn('assistant', buf.trim());
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
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color={busy ? 'gray' : 'cyan'}>{busy ? '… ' : '› '}</Text>
        <Text>{input || (busy ? '' : 'พิมพ์คำสั่ง หรือ /help')}</Text>
      </Box>
      <Text color="gray" dimColor>
        {'  '}? for shortcuts · /help · model: {model}
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
