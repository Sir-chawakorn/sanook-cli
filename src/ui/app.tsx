import { useEffect, useState, useRef } from 'react';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ModelMessage } from 'ai';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { homedir } from 'node:os';
import {
  BUILTIN_COMMANDS,
  HELP_TEXT,
  expandCustomCommand,
  loadCustomCommands,
  parseCommand,
  parseSlashInvocation,
} from '../commands.js';
import { runAgent, type AgentEvent } from '../loop.js';
import { finalizeReplSession, formatFinalizeMessage } from '../session-brain.js';
import { saveSession, newSessionId, listSessions, removeSession, renameSession, type Session } from '../session.js';
import { TOOL_CATALOG } from '../tool-catalog.js';
import { getBrainPath, appendBrainWorklog, appendBrainTranscript } from '../memory.js';
import { autoCompact, estimateTokens, summarizeCompact } from '../compaction.js';
import { makeSummarizer } from '../summarize.js';
import { agentTuning, patchGlobalConfig } from '../config.js';
import { snapshotWorkTree, restoreWorkTree } from '../checkpoint.js';
import { renderInsights } from '../insights.js';
import { loadMcpHubEntries } from '../mcp-hub.js';
import { probeMcpServer } from '../mcp.js';
import {
  filterModelPickerOptions,
  initialModelPickerIndex,
  modelPickerOptions,
  modelProviderEntries,
} from '../model-picker.js';
import { clampCompletionIndex, completionForInput, completionReplaceValue } from '../slash-completion.js';
import { loadSkills, saveSkill } from '../skills.js';
import { maybeAutoSkill } from '../self-improve.js';
import { defaultSkillSynthesizer } from '../self-improve-synth.js';
import { copyTextToClipboard } from '../clipboard.js';
import { useEditor } from './useEditor.js';
import { useBusyElapsedSeconds } from './useBusyElapsed.js';
import { useGitBranch } from './useGitBranch.js';
import { loadHistory, appendHistory } from './history.js';
import { expandMentions } from './mentions.js';
import { BRAND } from '../brand.js';
import { backgroundTaskRunningCount, listBackgroundTasks } from '../tools/task.js';
import { Banner, type BannerSignal } from './banner.js';
import { CompletionOverlay, FloatingOverlay, firstUserSummary, type OverlayState } from './overlay.js';
import { clampQueueActiveIndex, compactPreview, getQueueWindow, queueActiveIndexAfterDelete } from './queue.js';
import { MarkdownText, StreamingMarkdownText } from './markdown.js';
import { SessionPanel, type StartupSectionPreview } from './session-panel.js';
import { getTranscriptWindow, transcriptScrollStep, transcriptWindowSize } from './transcript.js';
import { footerStatus } from './status.js';
import { inputViewport, graphemesOf, cursorGraphemeIndex, SCROLL_LEAD, SCROLL_TAIL } from './input-view.js';
import { PersonaOverlay } from './persona-wizard.js';
import { thinkingPanelLines, snapshotThinking, type DetailsDisplayMode } from './thinking-panel.js';
import { toolTrailLines, toolTrailHeader, toolTrailWidth, updateToolTrailOnEvent, type ToolTrailDisplayMode, type ToolTrailItem } from './tool-trail.js';

const execFileP = promisify(execFile);
const PRE_TURN_COMPACT_TOKENS = 100_000; // session ยาวมากเท่านั้นถึง summarize ก่อน turn (mode summarize)

interface Turn {
  id: number;
  role: 'user' | 'assistant' | 'system';
  thinking?: string;
  text: string;
  toolTrail?: ToolTrailItem[];
}
interface Mark {
  turnId: number;
  msgLen: number;
}
interface Checkpoint extends Mark {
  ref: string | null; // git snapshot ref (null = ไม่ใช่ git repo → ย้อนแค่บทสนทนา)
}
interface LastRun extends Mark {
  userText: string;
  promptText: string;
  images: string[];
}

interface StartupReadiness {
  brain: 'checking' | 'missing' | 'ready';
  mcp: 'checking' | StartupSectionPreview;
  skills: 'checking' | StartupSectionPreview;
}

const startupCount = (value: 'checking' | StartupSectionPreview): string =>
  value === 'checking' ? 'checking' : value.count ? `${value.count}` : 'none';

const shortSignal = (value: string, max = 18): string =>
  value.length > max ? `…${value.slice(Math.max(0, value.length - max + 1))}` : value;

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
  const { stdout } = useStdout();
  const [history, setHistory] = useState<Turn[]>(() => {
    const seed: Turn[] = [];
    if (initialNote) seed.push({ id: -2, role: 'system', text: initialNote });
    if (initialHistory?.length) seed.push({ id: -1, role: 'system', text: `↻ ต่อจาก session ก่อน (${initialHistory.length} ข้อความ)` });
    return seed;
  });
  const [streaming, setStreaming] = useState('');
  const [thinking, setThinking] = useState('');
  const [agentStatus, setAgentStatus] = useState('');
  const [toolTrail, setToolTrail] = useState<ToolTrailItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState(initialModel);
  const [approvalReq, setApprovalReq] = useState<{ tool: string; summary: string } | null>(null);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [historyResetKey, setHistoryResetKey] = useState(0);
  const [queueActiveIndex, setQueueActiveIndex] = useState<number | null>(null);
  const [toolTrailMode, setToolTrailModeState] = useState<ToolTrailDisplayMode>('expanded');
  const [thinkingMode, setThinkingMode] = useState<DetailsDisplayMode>('collapsed');
  const [contextCompression, setContextCompression] = useState<'headroom' | 'off' | 'selective' | undefined>();
  const [transcriptScroll, setTranscriptScroll] = useState(0);
  const [personaOpen, setPersonaOpen] = useState(false);
  const idRef = useRef(0);
  const lastCost = useRef<string>('');
  const nextToolTrailId = useRef(0);
  const toolTrailRef = useRef<ToolTrailItem[]>([]);
  const toolTrailModeRef = useRef<ToolTrailDisplayMode>('expanded');
  const thinkingRef = useRef('');
  const msgsRef = useRef<ModelMessage[]>(initialHistory ?? []); // conversation จริงสำหรับ LLM (สะสมข้ามรอบ)
  const sessionId = useRef(newSessionId());
  const sessionCreated = useRef(new Date().toISOString());
  const exitingRef = useRef(false);
  const approvalResolve = useRef<((ok: boolean) => void) | null>(null);
  const replHistory = useRef<string[]>(loadHistory()); // prompt เก่า (persist) สำหรับ ↑/↓
  const checkpoints = useRef<Checkpoint[]>([]);
  const lastRun = useRef<LastRun | null>(null);
  const editor = useEditor(replHistory.current);
  const cwd = process.cwd();
  const [startupReadiness, setStartupReadiness] = useState<StartupReadiness>({
    brain: 'checking',
    mcp: 'checking',
    skills: 'checking',
  });
  // real-time steering: หยุด turn ที่กำลังรัน (abort) + คิวข้อความที่พิมพ์ระหว่าง busy
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<string[]>([]);
  const [queued, setQueued] = useState<string[]>([]);
  const [bgTaskCount, setBgTaskCount] = useState(0);
  const enqueue = (msg: string): void => {
    queueRef.current.push(msg);
    setQueued([...queueRef.current]);
    setQueueActiveIndex((index) => clampQueueActiveIndex(index, queueRef.current.length));
  };
  const dequeue = (): string | undefined => {
    const m = queueRef.current.shift();
    setQueued([...queueRef.current]);
    setQueueActiveIndex((index) => {
      if (!queueRef.current.length) return null;
      if (index === null) return 0;
      return clampQueueActiveIndex(index - 1, queueRef.current.length);
    });
    return m;
  };
  const clearQueue = (): void => {
    queueRef.current = [];
    setQueued([]);
    setQueueActiveIndex(null);
  };
  const moveQueueActive = (delta: number): void => {
    setQueueActiveIndex((index) => {
      const active = clampQueueActiveIndex(index, queueRef.current.length);
      return active === null ? null : clampQueueActiveIndex(active + delta, queueRef.current.length);
    });
  };
  const removeActiveQueued = (): string | undefined => {
    const length = queueRef.current.length;
    const active = clampQueueActiveIndex(queueActiveIndex, length);
    if (active === null) return undefined;
    const [removed] = queueRef.current.splice(active, 1);
    setQueued([...queueRef.current]);
    setQueueActiveIndex(queueActiveIndexAfterDelete(active, length));
    return removed;
  };

  const resetLiveToolTrail = (): void => {
    nextToolTrailId.current = 0;
    toolTrailRef.current = [];
    setToolTrail([]);
  };

  const resetLiveThinking = (): void => {
    thinkingRef.current = '';
    setThinking('');
  };

  const setToolTrailMode = (mode: ToolTrailDisplayMode): void => {
    toolTrailModeRef.current = mode;
    setToolTrailModeState(mode);
    // NOTE: this remount is load-bearing — the transcript lives in <Static>, which freezes already-
    // emitted turns; bumping the key is what re-renders past turns in the new mode. (Cost: a full
    // scrollback re-emit on toggle — a known <Static> trade-off, not removable without a rewrite.)
    setHistoryResetKey((key) => key + 1);
  };

  const changeToolTrailMode = (mode?: ToolTrailDisplayMode): ToolTrailDisplayMode => {
    const next = mode ?? (toolTrailModeRef.current === 'expanded' ? 'compact' : 'expanded');
    setToolTrailMode(next);
    return next;
  };

  const noteToolTrailMode = (mode: ToolTrailDisplayMode): void => {
    addTurn('system', `tool trail → ${mode} (${mode === 'compact' ? 'สรุปสั้น' : mode === 'hidden' ? 'ซ่อน' : 'แสดงรายละเอียด'})`);
  };

  const snapshotToolTrail = (): ToolTrailItem[] | undefined =>
    toolTrailRef.current.length ? toolTrailRef.current.map((item) => ({ ...item })) : undefined;

  const applyDetailsMode = (section: 'thinking' | 'tools' | undefined, mode: DetailsDisplayMode | undefined): void => {
    if (!section || !mode) return;
    if (section === 'thinking') {
      setThinkingMode(mode);
      setHistoryResetKey((key) => key + 1); // remount needed to restyle frozen <Static> turns (see setToolTrailMode)
      addTurn('system', `details thinking → ${mode}`);
      return;
    }
    const nextToolMode: ToolTrailDisplayMode = mode === 'expanded' ? 'expanded' : mode === 'hidden' ? 'hidden' : 'compact';
    noteToolTrailMode(changeToolTrailMode(nextToolMode));
  };

  const addTurn = (role: Turn['role'], text: string, extras?: { thinking?: string; toolTrail?: ToolTrailItem[] }): void => {
    setTranscriptScroll(0);
    setHistory((h) => [
      ...h,
      {
        id: idRef.current++,
        role,
        thinking: extras?.thinking,
        text,
        toolTrail: extras?.toolTrail?.length ? extras.toolTrail.map((item) => ({ ...item })) : undefined,
      },
    ]);
  };

  const recordToolTrailEvent = (event: AgentEvent): void => {
    if (event.type !== 'tool-call' && event.type !== 'tool-result' && event.type !== 'error') return;
    const type = event.type === 'tool-call' ? 'tool-call' : event.type === 'tool-result' ? 'tool-result' : 'error';
    const next = updateToolTrailOnEvent(
      toolTrailRef.current,
      { detail: event.detail, text: event.text, tool: event.tool, type },
      nextToolTrailId.current,
    );
    nextToolTrailId.current = next.nextId;
    toolTrailRef.current = next.items;
    setToolTrail(next.items);
  };

  const replaceHistory = (next: Turn[]): void => {
    setHistoryResetKey((key) => key + 1);
    setTranscriptScroll(0);
    setHistory(next);
  };

  const filterHistory = (predicate: (turn: Turn) => boolean): void => {
    setHistoryResetKey((key) => key + 1);
    setTranscriptScroll(0);
    setHistory((h) => h.filter(predicate));
  };

  const gitBranch = useGitBranch(cwd);
  const busyElapsedSeconds = useBusyElapsedSeconds(busy);
  const columns = Math.max(20, stdout?.columns ?? 80);
  const pagerPageSize = Math.max(5, Math.min(18, (stdout?.rows ?? 24) - 10));
  const completion = !overlay && !busy ? completionForInput(editor.value, cwd) : { items: [], replaceFrom: 0 };
  const completions = completion.items;
  const selectedCompletion = clampCompletionIndex(completionIndex, completions.length);

  useEffect(() => {
    let alive = true;
    void agentTuning()
      .then((tuning) => {
        if (alive) setContextCompression(tuning.contextCompression);
      })
      .catch(() => {
        if (alive) setContextCompression(undefined);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.allSettled([getBrainPath(), loadMcpHubEntries(cwd), loadSkills(cwd)]).then(([brain, mcp, skills]) => {
      if (!alive) return;
      setStartupReadiness({
        brain: brain.status === 'fulfilled' && brain.value ? 'ready' : 'missing',
        mcp:
          mcp.status === 'fulfilled'
            ? { count: mcp.value.entries.length, names: mcp.value.entries.map((entry) => entry.name) }
            : { count: 0, names: [] },
        skills:
          skills.status === 'fulfilled'
            ? { count: skills.value.length, names: skills.value.map((skill) => skill.name) }
            : { count: 0, names: [] },
      });
    });
    return () => {
      alive = false;
    };
  }, [cwd]);

  useEffect(() => {
    const refresh = (): void => setBgTaskCount(backgroundTaskRunningCount());
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, []);

  const bannerSignals: BannerSignal[] = [
    { label: 'brain', tone: startupReadiness.brain === 'ready' ? 'ready' : startupReadiness.brain === 'checking' ? 'muted' : 'warn', value: startupReadiness.brain },
    { label: 'mcp', tone: startupReadiness.mcp === 'checking' ? 'muted' : startupReadiness.mcp.count ? 'ready' : 'warn', value: startupCount(startupReadiness.mcp) },
    { label: 'skills', tone: startupReadiness.skills === 'checking' ? 'muted' : startupReadiness.skills.count ? 'ready' : 'warn', value: startupCount(startupReadiness.skills) },
    ...(gitBranch ? [{ label: 'git', tone: 'ready' as const, value: shortSignal(gitBranch) }] : []),
  ];

  const applyCompletion = (): boolean => {
    const next = completionReplaceValue(editor.value, completions[selectedCompletion], completion.replaceFrom);
    if (!next) return false;
    editor.setValue(next);
    setCompletionIndex(0);
    return true;
  };

  const requestExit = (): void => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    void finalizeReplSession({
      sessionId: sessionId.current,
      sessionCreated: sessionCreated.current,
      model,
      cwd,
      messages: msgsRef.current,
      history: history.map((turn) => ({ role: turn.role, text: turn.text })),
    })
      .then((result) => {
        const note = formatFinalizeMessage(result);
        if (note) process.stderr.write(`\n${note}\n`);
        exit();
      })
      .catch(() => exit());
  };

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

  const openModelPicker = (): void => {
    const providers = modelProviderEntries();
    const options = modelPickerOptions(model);
    setOverlay({
      kind: 'model',
      phase: 'provider',
      providers,
      options,
      selected: 0,
    });
  };

  const openMcpHub = async (): Promise<void> => {
    try {
      const state = await loadMcpHubEntries(process.cwd());
      setOverlay({ detail: false, kind: 'mcp', notes: state.notes, selected: 0, servers: state.entries });
    } catch (e) {
      addTurn('system', `mcp: ${(e as Error).message}`);
    }
  };

  const moveMcpHub = (delta: number): void => {
    setOverlay((current) => {
      if (current?.kind !== 'mcp' || current.detail) return current;
      const last = Math.max(0, current.servers.length - 1);
      return { ...current, probe: undefined, selected: Math.max(0, Math.min(last, current.selected + delta)), toolSelected: 0 };
    });
  };

  const moveMcpToolCatalog = (delta: number): void => {
    setOverlay((current) => {
      if (current?.kind !== 'mcp' || !current.detail) return current;
      const tools = current.probe?.status === 'pass' ? (current.probe.tools ?? []) : [];
      if (!tools.length) return current;
      const last = tools.length - 1;
      const selected = Math.max(0, Math.min(last, (current.toolSelected ?? 0) + delta));
      return { ...current, toolSelected: selected };
    });
  };

  const testMcpServerFromOverlay = (current: OverlayState): void => {
    if (current.kind !== 'mcp') return;
    const server = current.servers[current.selected];
    if (!server) return;

    setOverlay({ ...current, detail: true, probe: { serverName: server.name, status: 'running' }, toolSelected: 0 });
    void probeMcpServer(server.config, 8_000)
      .then((result) => {
        setOverlay((latest) => {
          if (latest?.kind !== 'mcp' || !latest.detail || latest.probe?.serverName !== server.name) return latest;
          return {
            ...latest,
            detail: true,
            probe: result.ok
              ? { serverName: server.name, status: 'pass', tools: result.tools, transport: result.transport }
              : {
                  error: result.error ?? 'unknown error',
                  serverName: server.name,
                  status: 'fail',
                  transport: result.transport,
                },
            toolSelected: 0,
          };
        });
      })
      .catch((e) => {
        setOverlay((latest) => {
          if (latest?.kind !== 'mcp' || !latest.detail || latest.probe?.serverName !== server.name) return latest;
          return {
            ...latest,
            detail: true,
            probe: { error: (e as Error).message, serverName: server.name, status: 'fail' },
            toolSelected: 0,
          };
        });
      });
  };

  const moveModelPicker = (delta: number): void => {
    setOverlay((current) => {
      if (current?.kind !== 'model') return current;
      const list = current.phase === 'provider' ? current.providers : current.options;
      const last = Math.max(0, list.length - 1);
      return { ...current, selected: Math.max(0, Math.min(last, current.selected + delta)) };
    });
  };

  const selectModelFromOverlay = (current: OverlayState): void => {
    if (current.kind !== 'model') return;
    if (current.phase === 'provider') {
      const provider = current.providers[current.selected];
      if (!provider) return;
      const options = filterModelPickerOptions(modelPickerOptions(model), provider.id);
      setOverlay({
        kind: 'model',
        phase: 'model',
        providerFilter: provider.id,
        providers: current.providers,
        options,
        selected: initialModelPickerIndex(options),
      });
      return;
    }
    const selectedSpec = current.options[current.selected]?.spec ?? '';
    setOverlay(null);
    if (!selectedSpec) return;
    const result = parseCommand(`/model ${selectedSpec}`, { model, costSummary: lastCost.current });
    if (result.modelChange) setModel(result.modelChange);
    if (result.message) addTurn('system', result.message);
  };

  const openHelpPager = (text = HELP_TEXT): void => {
    setOverlay({ kind: 'pager', lines: text.split('\n'), offset: 0, title: 'Sanook help' });
  };

  const movePager = (delta: number | 'top' | 'bottom'): void => {
    setOverlay((current) => {
      if (current?.kind !== 'pager') return current;
      const max = Math.max(0, current.lines.length - pagerPageSize);
      const step = delta === 'top' ? -current.lines.length : delta === 'bottom' ? current.lines.length : delta;
      const next = Math.max(0, Math.min(current.offset + step, max));
      return next === current.offset ? current : { ...current, offset: next };
    });
  };

  const pagePagerForward = (): void => {
    setOverlay((current) => {
      if (current?.kind !== 'pager') return current;
      const max = Math.max(0, current.lines.length - pagerPageSize);
      if (current.offset >= max) return null;
      return { ...current, offset: Math.min(current.offset + pagerPageSize, max) };
    });
  };

  const openSkillsHub = async (): Promise<void> => {
    try {
      const skills = (await loadSkills()).sort((a, b) => a.name.localeCompare(b.name));
      setOverlay({ detail: false, kind: 'skills', selected: 0, skills });
    } catch (e) {
      addTurn('system', `skills: ${(e as Error).message}`);
    }
  };

  const openToolsHub = (): void => {
    setOverlay({ detail: false, kind: 'tools', selected: 0, tools: TOOL_CATALOG });
  };

  const openTasksHub = (): void => {
    const tasks = listBackgroundTasks().sort((a, b) => b.startedMs - a.startedMs);
    setOverlay({ detail: false, kind: 'tasks', selected: 0, tasks });
  };

  const moveTasksHub = (delta: number): void => {
    setOverlay((current) => {
      if (current?.kind !== 'tasks' || current.detail) return current;
      const last = Math.max(0, current.tasks.length - 1);
      return { ...current, selected: Math.max(0, Math.min(last, current.selected + delta)) };
    });
  };

  const copyLatestAssistant = async (): Promise<void> => {
    const latest = [...history].reverse().find((turn) => turn.role === 'assistant' && turn.text.trim());
    if (!latest) {
      addTurn('system', 'copy: ยังไม่มีคำตอบ assistant ให้คัดลอก');
      return;
    }
    try {
      const result = await copyTextToClipboard(latest.text, { writeOsc52: (sequence) => stdout?.write(sequence) });
      addTurn('system', `copy: copied latest assistant (${latest.text.length} chars) via ${result.detail}`);
    } catch (e) {
      addTurn('system', `copy: ${(e as Error).message}`);
    }
  };

  const moveToolsHub = (delta: number): void => {
    setOverlay((current) => {
      if (current?.kind !== 'tools' || current.detail) return current;
      const last = Math.max(0, current.tools.length - 1);
      return { ...current, selected: Math.max(0, Math.min(last, current.selected + delta)) };
    });
  };

  const moveSkillsHub = (delta: number): void => {
    setOverlay((current) => {
      if (current?.kind !== 'skills' || current.detail) return current;
      const last = Math.max(0, current.skills.length - 1);
      return { ...current, selected: Math.max(0, Math.min(last, current.selected + delta)) };
    });
  };

  const openSessionsHub = async (): Promise<void> => {
    try {
      const sessions = await listSessions({ cwd: null, limit: 20 });
      setOverlay({ currentCwd: cwd, kind: 'sessions', selected: 0, sessions });
    } catch (e) {
      addTurn('system', `sessions: ${(e as Error).message}`);
    }
  };

  const moveSessionsHub = (delta: number): void => {
    setOverlay((current) => {
      if (current?.kind !== 'sessions') return current;
      const last = Math.max(0, current.sessions.length - 1);
      return { ...current, notice: undefined, pendingDeleteId: undefined, selected: Math.max(0, Math.min(last, current.selected + delta)) };
    });
  };

  const inspectSessionFromOverlay = (current: OverlayState): void => {
    if (current.kind !== 'sessions' || !current.sessions[current.selected]) return;
    setOverlay({ ...current, detail: true, notice: undefined, pendingDeleteId: undefined });
  };

  const resumeSessionFromOverlay = (current: OverlayState): void => {
    if (current.kind !== 'sessions') return;
    const session = current.sessions[current.selected];
    setOverlay(null);
    if (!session) return;
    restoreSession(session);
  };

  const restoreSession = (session: Session): void => {
    msgsRef.current = session.messages;
    checkpoints.current = [];
    lastRun.current = null;
    lastCost.current = '';
    sessionId.current = session.id;
    sessionCreated.current = session.created;
    setModel(session.model);
    resetLiveToolTrail();
    resetLiveThinking();
    const crossProject = session.cwd !== cwd;
    const cwdNote = crossProject ? ` · cwd ${session.cwd.replace(homedir(), '~')}` : '';
    replaceHistory([
      {
        id: idRef.current++,
        role: 'system',
        text: `↻ เปิด session ${session.id} (${session.messages.length} messages)${cwdNote}${crossProject ? ' · --continue-any' : ''}`,
      },
    ]);
  };

  const startSessionRename = (current: OverlayState): void => {
    if (current.kind !== 'sessions') return;
    const session = current.sessions[current.selected];
    if (!session) return;
    const draft = session.title || firstUserSummary(session) || '';
    setOverlay({
      ...current,
      detail: false,
      notice: undefined,
      pendingDeleteId: undefined,
      renaming: draft,
    });
  };

  const confirmSessionRename = async (current: OverlayState): Promise<void> => {
    if (current.kind !== 'sessions' || current.renaming === undefined) return;
    const session = current.sessions[current.selected];
    if (!session) return;
    const title = current.renaming.trim();
    if (!title) {
      setOverlay({ ...current, notice: 'rename: title cannot be empty' });
      return;
    }
    try {
      const updated = await renameSession(session.id, title);
      if (!updated) {
        setOverlay({ ...current, notice: `rename failed: ${session.id} not found` });
        return;
      }
      const sessions = current.sessions.map((item) => (item.id === session.id ? updated : item));
      setOverlay({
        ...current,
        notice: `renamed → ${title}`,
        renaming: undefined,
        sessions,
      });
    } catch (e) {
      setOverlay({ ...current, notice: `rename failed: ${(e as Error).message}` });
    }
  };

  const deleteSessionFromOverlay = async (current: OverlayState): Promise<void> => {
    if (current.kind !== 'sessions') return;
    const session = current.sessions[current.selected];
    if (!session) return;

    if (current.pendingDeleteId !== session.id) {
      setOverlay({ ...current, notice: `delete? press d again: ${session.id}`, pendingDeleteId: session.id });
      return;
    }

    try {
      const removed = await removeSession(session.id);
      const sessions = current.sessions.filter((item) => item.id !== session.id);
      const selected = Math.max(0, Math.min(current.selected, sessions.length - 1));
      setOverlay({
        detail: false,
        kind: 'sessions',
        notice: removed ? `deleted ${session.id}` : `already removed ${session.id}`,
        selected,
        sessions,
      });
    } catch (e) {
      setOverlay({ ...current, notice: `delete failed: ${(e as Error).message}`, pendingDeleteId: undefined });
    }
  };

  useInput((input, key) => {
    if (overlay) {
      if (overlay.kind === 'model') {
        if (input === 'q' || input === 'Q') setOverlay(null);
        else if (key.escape) {
          if (overlay.phase === 'model') {
            setOverlay({ ...overlay, phase: 'provider', providerFilter: undefined, selected: 0 });
          } else setOverlay(null);
        } else if (key.return) selectModelFromOverlay(overlay);
        else if (key.downArrow || input === 'j' || input === 'J') moveModelPicker(1);
        else if (key.upArrow || input === 'k' || input === 'K') moveModelPicker(-1);
        return;
      }
      if (overlay.kind === 'mcp') {
        if (input === 'q' || input === 'Q') setOverlay(null);
        else if (input === 't' || input === 'T') testMcpServerFromOverlay(overlay);
        else if (overlay.detail && (key.escape || key.return)) setOverlay({ ...overlay, detail: false, toolSelected: 0 });
        else if (key.escape) setOverlay(null);
        else if (key.return && overlay.servers.length) setOverlay({ ...overlay, detail: true, toolSelected: 0 });
        else if (overlay.detail && (key.downArrow || input === 'j' || input === 'J')) moveMcpToolCatalog(1);
        else if (overlay.detail && (key.upArrow || input === 'k' || input === 'K')) moveMcpToolCatalog(-1);
        else if (key.downArrow || input === 'j' || input === 'J') moveMcpHub(1);
        else if (key.upArrow || input === 'k' || input === 'K') moveMcpHub(-1);
        return;
      }
      if (overlay.kind === 'pager') {
        if (key.escape || input === 'q' || input === 'Q') setOverlay(null);
        else if (key.upArrow || input === 'k' || input === 'K') movePager(-1);
        else if (key.downArrow || input === 'j' || input === 'J') movePager(1);
        else if (key.pageUp || input === 'b' || input === 'B') movePager(-pagerPageSize);
        else if (input === 'g') movePager('top');
        else if (input === 'G') movePager('bottom');
        else if (key.return || key.pageDown || input === ' ') pagePagerForward();
        return;
      }
      if (overlay.kind === 'skills') {
        if (input === 'q' || input === 'Q') setOverlay(null);
        else if (overlay.detail && (key.escape || key.return)) setOverlay({ ...overlay, detail: false });
        else if (key.escape) setOverlay(null);
        else if (key.return && overlay.skills.length) setOverlay({ ...overlay, detail: true });
        else if (key.downArrow || input === 'j' || input === 'J') moveSkillsHub(1);
        else if (key.upArrow || input === 'k' || input === 'K') moveSkillsHub(-1);
        return;
      }
      if (overlay.kind === 'sessions') {
        if (overlay.renaming !== undefined) {
          if (key.escape) setOverlay({ ...overlay, notice: undefined, renaming: undefined });
          else if (key.return) void confirmSessionRename(overlay);
          else if (key.backspace || key.delete) setOverlay({ ...overlay, renaming: overlay.renaming.slice(0, -1) });
          else if (input && !key.ctrl && !key.meta) setOverlay({ ...overlay, renaming: overlay.renaming + input });
          return;
        }
        if (input === 'q' || input === 'Q') setOverlay(null);
        else if (overlay.detail && key.escape) setOverlay({ ...overlay, detail: false, notice: undefined, pendingDeleteId: undefined });
        else if (key.escape) setOverlay(null);
        else if (input === 'd' || input === 'D') void deleteSessionFromOverlay(overlay);
        else if (input === 'r' || input === 'R') startSessionRename(overlay);
        else if (input === 'i' || input === 'I') inspectSessionFromOverlay(overlay);
        else if (key.return) resumeSessionFromOverlay(overlay);
        else if (!overlay.detail && (key.downArrow || input === 'j' || input === 'J')) moveSessionsHub(1);
        else if (!overlay.detail && (key.upArrow || input === 'k' || input === 'K')) moveSessionsHub(-1);
        return;
      }
      if (overlay.kind === 'tools') {
        if (input === 'q' || input === 'Q') setOverlay(null);
        else if (overlay.detail && (key.escape || key.return)) setOverlay({ ...overlay, detail: false });
        else if (key.escape) setOverlay(null);
        else if (key.return && overlay.tools.length) setOverlay({ ...overlay, detail: true });
        else if (key.downArrow || input === 'j' || input === 'J') moveToolsHub(1);
        else if (key.upArrow || input === 'k' || input === 'K') moveToolsHub(-1);
        return;
      }
      if (overlay.kind === 'tasks') {
        if (input === 'q' || input === 'Q') setOverlay(null);
        else if (overlay.detail && (key.escape || key.return)) setOverlay({ ...overlay, detail: false, tasks: listBackgroundTasks().sort((a, b) => b.startedMs - a.startedMs) });
        else if (key.escape) setOverlay(null);
        else if (key.return && overlay.tasks.length) setOverlay({ ...overlay, detail: true });
        else if (key.downArrow || input === 'j' || input === 'J') moveTasksHub(1);
        else if (key.upArrow || input === 'k' || input === 'K') moveTasksHub(-1);
        return;
      }
      if (key.escape || key.return || input === 'q' || input === 'Q') setOverlay(null);
      return;
    }
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
      if (key.ctrl && input === 't') {
        noteToolTrailMode(changeToolTrailMode());
        return;
      }
      if (key.ctrl && input === 'x') {
        removeActiveQueued();
        return;
      }
      if (!editor.value && queueRef.current.length && (key.upArrow || key.downArrow)) {
        moveQueueActive(key.upArrow ? -1 : 1);
        return;
      }
      // พิมพ์ระหว่าง busy ได้ — Enter = ต่อคิว (รันอัตโนมัติหลัง turn นี้จบ)
      const a = editor.handleKey(input, key);
      if (a === 'submit') {
        const v = editor.value.trim();
        const expanded = editor.expandValue(v).trim();
        editor.reset();
        const slash = parseSlashInvocation(v);
        if (slash?.name === 'stop') {
          addTurn('user', v);
          abortRef.current?.abort();
          clearQueue();
          return;
        }
        if (expanded) enqueue(expanded);
      }
      return;
    }
    if (completions.length) {
      if (key.upArrow) {
        setCompletionIndex((index) => clampCompletionIndex(index - 1, completions.length));
        return;
      }
      if (key.downArrow) {
        setCompletionIndex((index) => clampCompletionIndex(index + 1, completions.length));
        return;
      }
      if (key.tab || key.return) {
        if (applyCompletion()) return;
      }
    }
    if (key.ctrl && input === 't') {
      noteToolTrailMode(changeToolTrailMode());
      return;
    }
    const transcriptLimit = transcriptWindowSize(stdout?.rows);
    const transcriptStep = transcriptScrollStep(transcriptLimit);
    if (history.length > transcriptLimit) {
      if (key.pageUp || (key.ctrl && input === 'u')) {
        setTranscriptScroll((scroll) => {
          const max = Math.max(0, history.length - transcriptLimit);
          return Math.min(max, scroll + transcriptStep);
        });
        return;
      }
      if (key.pageDown || (key.ctrl && input === 'd')) {
        setTranscriptScroll((scroll) => Math.max(0, scroll - transcriptStep));
        return;
      }
    }
    const action = editor.handleKey(input, key);
    if (action === 'submit') void submit(editor.value);
    else if (action === 'interrupt') {
      if (editor.value) editor.reset(); // Ctrl+C ครั้งแรก = ล้างบรรทัด, ว่างแล้ว = ออก
      else requestExit();
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
    lastRun.current = null;
    filterHistory((t) => t.id < cp.turnId);
    addTurn('system', `↩ ย้อนกลับ 1 turn${note}`);
  }

  async function retryLastTurn(): Promise<void> {
    const previous = lastRun.current;
    if (!previous) {
      addTurn('user', '/retry');
      addTurn('system', 'ยังไม่มี turn ให้ retry');
      return;
    }
    msgsRef.current = msgsRef.current.slice(0, previous.msgLen);
    checkpoints.current = checkpoints.current.filter((cp) => cp.turnId < previous.turnId);
    filterHistory((t) => t.id < previous.turnId);
    const mark = { turnId: idRef.current, msgLen: previous.msgLen };
    const preview = previous.userText.length > 120 ? `${previous.userText.slice(0, 117)}...` : previous.userText;
    addTurn('user', '/retry');
    addTurn('system', `retry: ${preview}`);
    await runAssistantTurn(previous.promptText, previous.images, mark, previous.userText);
  }

  /** บีบ context: 'summarize' (ใช้ model ถูกย่อ) ถ้าตั้งไว้ ไม่งั้น 'truncate' (zero-LLM) */
  async function compactHistory(targetTokens: number, label: string): Promise<void> {
    const before = estimateTokens(msgsRef.current);
    if (before <= targetTokens) {
      addTurn('system', `context ~${before} tokens — ยังไม่ต้องบีบ`);
      return;
    }
      const tuning = await agentTuning().catch(() => null);
      if (tuning?.contextCompression) setContextCompression(tuning.contextCompression);
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
    const displayText = raw.trim();
    const text = editor.expandValue(displayText).trim();
    editor.reset();
    if (!displayText) return;
    appendHistory(displayText, replHistory.current[replHistory.current.length - 1]);
    replHistory.current.push(displayText);

    const slash = parseSlashInvocation(displayText);
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
          addTurn('user', displayText);
          if (!expanded.trim()) {
            addTurn('system', `custom command /${slash.name} ว่าง`);
            return;
          }
          await runAssistantTurn(expanded, [], mark, displayText);
          return;
        }
      }
    }

    const cmd = parseCommand(displayText, { model, costSummary: lastCost.current });
    if (cmd.handled) {
      addTurn('user', displayText);
      if (cmd.action === 'quit') return requestExit();
      if (cmd.action === 'clear') {
        msgsRef.current = [];
        checkpoints.current = [];
        lastRun.current = null;
        setStreaming('');
        resetLiveToolTrail();
        replaceHistory([]);
        return;
      }
      if (cmd.action === 'compact') {
        void compactHistory(40_000, 'บีบ context');
        return;
      }
      if (cmd.action === 'copyLast') {
        void copyLatestAssistant();
        return;
      }
      if (cmd.action === 'diff') return void runGit(['diff', '--stat'], 'diff');
      if (cmd.action === 'retry') return void retryLastTurn();
      if (cmd.action === 'personality') {
        void patchGlobalConfig({ personality: cmd.personalityChange || undefined })
          .then(() => addTurn('system', cmd.message ?? 'ตั้ง personality แล้ว'))
          .catch((e) => addTurn('system', `personality: ${(e as Error).message}`));
        return;
      }
      if (cmd.action === 'personaSetup') {
        setPersonaOpen(true);
        return;
      }
      if (cmd.action === 'insights') {
        void renderInsights({ days: cmd.insightsDays, cwd: cmd.insightsAll ? null : undefined })
          .then((msg) => addTurn('system', msg))
          .catch((e) => addTurn('system', `insights: ${(e as Error).message}`));
        return;
      }
      if (cmd.action === 'undo') {
        void runGit(['stash', 'push', '-u', '-m', BRAND.undoStashMessage], 'undo').then(() =>
          addTurn('system', 'กู้คืน: git stash pop'),
        );
        return;
      }
      if (cmd.action === 'help') {
        openHelpPager(cmd.message);
        return;
      }
      if (cmd.action === 'mcpHub') {
        void openMcpHub();
        return;
      }
      if (cmd.action === 'hotkeys') {
        setOverlay({ kind: 'hotkeys' });
        return;
      }
      if (cmd.action === 'modelPicker') {
        openModelPicker();
        return;
      }
      if (cmd.action === 'skillsHub') {
        void openSkillsHub();
        return;
      }
      if (cmd.action === 'toolTrail') {
        noteToolTrailMode(changeToolTrailMode(cmd.toolTrailMode));
        return;
      }
      if (cmd.action === 'details') {
        applyDetailsMode(cmd.detailSection, cmd.detailMode);
        return;
      }
      if (cmd.action === 'toolsHub') {
        openToolsHub();
        return;
      }
      if (cmd.action === 'sessionsHub') {
        void openSessionsHub();
        return;
      }
      if (cmd.action === 'tasksHub') {
        openTasksHub();
        return;
      }
      if (cmd.modelChange) setModel(cmd.modelChange);
      if (cmd.message) addTurn('system', cmd.message);
      return;
    }

    // prompt ปกติ → expand @mentions (inline ไฟล์ text + เก็บ path รูป)
    const mark = { turnId: idRef.current, msgLen: msgsRef.current.length };
    addTurn('user', displayText);
    const { text: expanded, images, errors } = await expandMentions(text);
    if (errors.length) addTurn('system', `@mention: ${errors.join(' · ')}`);
    await runAssistantTurn(expanded, images, mark, displayText);
  }

  async function runAssistantTurn(promptText: string, images: string[], mark: Mark, userText = promptText): Promise<void> {
    lastRun.current = { ...mark, userText, promptText, images };
    // proactive summarize-compaction สำหรับ session ยาวมาก (เฉพาะ mode summarize) — เริ่ม turn ให้ context lean
    // (mode truncate: ปล่อยให้ loop.ts ตัดต่อ-step เอา; ไม่บีบที่นี่ กัน latency)
    if (estimateTokens(msgsRef.current) > PRE_TURN_COMPACT_TOKENS) {
      const t = await agentTuning().catch(() => null);
      if (t?.contextCompression) setContextCompression(t.contextCompression);
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
    resetLiveToolTrail();
    resetLiveThinking();
    setStreaming('');
    setAgentStatus('Starting…');
    setBusy(true);
    let buf = '';
    let reasoningBuf = '';
    let lastFlush = 0;
    let lastThinkingFlush = 0;
    const rememberedFacts: string[] = []; // 🧠 ที่ user สั่งจำใน turn นี้ → โชว์ indicator ใน terminal
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
        usageMeta: { sessionId: sessionId.current, source: 'repl' },
        onEvent: (e: AgentEvent) => {
          if (e.type === 'status' && typeof e.detail === 'string') {
            setAgentStatus(e.detail);
          } else if (e.type === 'text') {
            setAgentStatus((prev) => (prev.startsWith('Codex') || prev.startsWith('Agent') ? 'Writing…' : prev));
            buf += e.text ?? '';
            const now = Date.now();
            if (now - lastFlush > 80) {
              setStreaming(buf);
              lastFlush = now;
            }
          } else if (e.type === 'tool-call') {
            if (e.tool === 'remember') {
              const fact = (e.detail as { fact?: unknown } | undefined)?.fact;
              if (typeof fact === 'string' && fact.trim()) rememberedFacts.push(fact.trim());
            }
            recordToolTrailEvent(e);
          } else if (e.type === 'tool-result' || e.type === 'error') {
            recordToolTrailEvent(e);
          } else if (e.type === 'reasoning') {
            reasoningBuf += e.text ?? '';
            thinkingRef.current = reasoningBuf;
            const now = Date.now();
            if (now - lastThinkingFlush > 120) {
              setThinking(reasoningBuf);
              lastThinkingFlush = now;
            }
          }
        },
      });
      msgsRef.current = messages;
      lastCost.current = cost.summary();
      const answerText = buf.trim() || text.trim();
      addTurn('assistant', answerText, { thinking: snapshotThinking(reasoningBuf), toolTrail: snapshotToolTrail() });
      // 🧠 indicator: ผู้ใช้สั่งให้จำ → บันทึกถาวรแล้ว (memory + second-brain ถ้าตั้งไว้)
      for (const fact of rememberedFacts) addTurn('system', `🧠 จำไว้แล้ว: ${fact}`);
      // เซฟ session ทุกรอบ → resume ได้ด้วย sanook -c
      void saveSession({
        id: sessionId.current,
        created: sessionCreated.current,
        updated: new Date().toISOString(),
        model,
        cwd: process.cwd(),
        messages,
      });
      // worklog (ย่อ) + บทสนทนาเต็ม (ถ้าเปิด brainTranscript) เข้า second-brain
      void (async () => {
        const brain = await getBrainPath();
        if (brain) {
          await appendBrainWorklog(brain, {
            prompt: promptText,
            summary: cost.summary(),
            model,
            today: new Date().toISOString().slice(0, 10),
          }).catch(() => {});
          await appendBrainTranscript(brain, {
            sessionId: sessionId.current,
            prompt: promptText,
            answer: answerText,
            model,
            // per-turn timestamp → correct HH:MM heading + correct day file (matches the worklog
            // above); sessionCreated is frozen at session start so it stamped every turn the same.
            createdIso: new Date().toISOString(),
          }).catch(() => {});
        }
      })();
      // self-improvement: งานเดิมที่สั่งซ้ำถึง threshold → สร้าง skill อัตโนมัติ + แจ้งใน terminal
      void (async () => {
        try {
          const existing = new Set((await loadSkills()).map((s) => s.name));
          const result = await maybeAutoSkill(promptText, {
            synthesize: defaultSkillSynthesizer(model),
            saveSkill,
            existingSkillNames: existing,
          });
          if (result.created && result.announcement) addTurn('system', result.announcement);
        } catch {
          /* self-improvement เป็น best-effort — ไม่ให้ล้ม turn */
        }
      })();
    } catch (err) {
      if (ac.signal.aborted) {
        // หยุดเอง — เก็บ partial output ไว้ดู, ทิ้ง turn นี้ออกจาก LLM history (msgsRef ไม่อัปเดต)
        if (buf.trim()) addTurn('assistant', buf.trim(), { thinking: snapshotThinking(reasoningBuf), toolTrail: snapshotToolTrail() });
        addTurn('system', '⊘ หยุด turn แล้ว (ไฟล์ที่ tool แก้ไปแล้วคืนด้วย /rewind ได้)');
      } else {
        addTurn('system', `ERROR: ${(err as Error).message}`);
      }
    } finally {
      setStreaming('');
      setAgentStatus('');
      resetLiveThinking();
      resetLiveToolTrail();
      setBusy(false);
      abortRef.current = null;
    }
    // steering: ข้อความที่พิมพ์ค้างคิวระหว่าง turn → รันต่อทันที (ถ้าไม่ได้ถูกหยุด)
    const next = ac.signal.aborted ? undefined : dequeue();
    if (next) void submit(next);
  }

  const costHint = lastCost.current.includes('cost ') ? lastCost.current.split('cost ')[1] : '';
  const contextTokens = estimateTokens(msgsRef.current);
  const activeQueueIndex = clampQueueActiveIndex(queueActiveIndex, queued.length);
  const queueWindow = getQueueWindow(queued.length, activeQueueIndex);
  // gate only — the expanded view renders via ToolTrailView/ActivityRow and the compact view
  // recomputes its own strings; equivalent to toolTrailLines(...).length without building the array each render.
  const showToolTrail = toolTrailMode !== 'hidden' && toolTrail.length > 0;
  // id of the most recent turn that has a tool trail — only it keeps full expanded diffs in
  // scrollback (older tool turns downgrade to compact). Tracks the trail, not just the last turn,
  // so trailing text/command turns don't strip detail off the latest tool work.
  let latestTrailTurnId: number | undefined;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].toolTrail) {
      latestTrailTurnId = history[i].id;
      break;
    }
  }
  const thinkingView = thinkingPanelLines(thinking, columns, thinkingMode);
  const transcriptLimit = transcriptWindowSize(stdout?.rows);
  const transcriptView = getTranscriptWindow(history.length, transcriptLimit, transcriptScroll);
  const visibleHistory = history.slice(transcriptView.start, transcriptView.end);

  return (
    <Box flexDirection="column">
      {history.length === 0 ? (
        <>
          <Banner columns={columns} model={model} mode={permissionMode === 'ask' ? 'ask' : 'auto'} signals={bannerSignals} />
          <SessionPanel
            columns={columns}
            cwd={cwd}
            mcp={startupReadiness.mcp}
            model={model}
            mode={permissionMode === 'ask' ? 'ask' : 'auto'}
            skills={startupReadiness.skills}
          />
        </>
      ) : null}
      {transcriptView.showOlder ? (
        <Text dimColor>… {transcriptView.start} older turns · PgUp/Ctrl+U scroll · PgDn/Ctrl+D newer</Text>
      ) : null}
      {visibleHistory.map((turn) => (
        <TurnView
          key={`${historyResetKey}-${turn.id}`}
          columns={columns}
          isLatest={turn.id === latestTrailTurnId}
          thinkingMode={thinkingMode}
          toolTrailMode={toolTrailMode}
          turn={turn}
        />
      ))}
      {transcriptView.showNewer ? (
        <Text dimColor>… {transcriptView.scrollFromBottom} newer turns hidden · PgDn/Ctrl+D to catch up</Text>
      ) : null}
      {thinkingView.length ? <ThinkingView columns={columns} mode={thinkingMode} text={thinking} /> : null}
      {streaming ? (
        <Box flexDirection="column" marginTop={1}>
          <StreamingMarkdownText columns={columns} text={streaming} />
        </Box>
      ) : null}
      {showToolTrail ? (
        <ToolTrailView columns={columns} items={toolTrail} mode={toolTrailMode} />
      ) : null}
      <FloatingOverlay columns={columns} overlay={overlay} pageSize={pagerPageSize} />
      <CompletionOverlay columns={columns} items={completions} selected={selectedCompletion} />
      {queued.length ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>queued ({queued.length}) · ↑↓ select · Ctrl+X delete · Esc clears</Text>
          {queueWindow.showLead ? <Text dimColor> …</Text> : null}
          {queued.slice(queueWindow.start, queueWindow.end).map((q, i) => (
            <Text
              key={`${queueWindow.start + i}-${q.slice(0, 16)}`}
              color={queueWindow.start + i === activeQueueIndex ? 'yellow' : undefined}
              dimColor={queueWindow.start + i !== activeQueueIndex}
            >
              {queueWindow.start + i === activeQueueIndex ? '›' : ' '} {queueWindow.start + i + 1}.{' '}
              {compactPreview(q, Math.max(16, columns - 10))}
            </Text>
          ))}
          {queueWindow.showTail ? <Text dimColor>  …and {queued.length - queueWindow.end} more</Text> : null}
        </Box>
      ) : null}
      {approvalReq ? (
        <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text color="yellow">อนุมัติรัน {approvalReq.tool}?</Text>
          <Text dimColor>{approvalReq.summary}</Text>
          <Text dimColor>y = รัน · n = ปฏิเสธ</Text>
        </Box>
      ) : personaOpen ? (
        <PersonaOverlay onDone={(msg) => { setPersonaOpen(false); addTurn('system', msg); }} />
      ) : (
        <Box marginTop={1} borderStyle="round" borderColor={busy ? 'gray' : 'blue'} paddingX={1}>
          <Text color={busy ? 'gray' : 'cyan'}>{busy ? '· ' : '› '}</Text>
          <InputView value={editor.value} cursor={editor.cursor} busy={busy} agentStatus={agentStatus} toolTrail={toolTrail} columns={columns} />
        </Box>
      )}
      <Text dimColor wrap="truncate-end">
        {footerStatus({
          branch: gitBranch,
          backgroundTaskCount: bgTaskCount,
          busy,
          columns,
          contextCompression,
          contextTokens,
          costHint,
          cwd,
          elapsedSeconds: busyElapsedSeconds,
          model,
          mode: permissionMode === 'ask' ? 'ask' : 'auto',
          queuedCount: queued.length,
        })}
      </Text>
    </Box>
  );
}

/** input ที่มี cursor (inverse) + placeholder — minimal; รับ input ได้แม้ busy (ต่อคิว) */
function InputView({
  value,
  cursor,
  busy,
  agentStatus,
  toolTrail,
  columns = 80,
}: {
  value: string;
  cursor: number;
  busy: boolean;
  agentStatus?: string;
  toolTrail?: ToolTrailItem[];
  columns?: number;
}) {
  if (busy && !value) {
    const runningTool = toolTrail?.find((item) => item.status === 'running');
    // prefer the running tool's friendly activity title (e.g. "📖 อ่านไฟล์ src/x.ts", "$ npm test") over
    // the raw "Tool · read_file" status — same detail the tool trail shows, so the one-line status during a
    // turn says specifically what's happening; falls back to agentStatus (Thinking…/Writing…/Agent · model).
    const detail = runningTool?.activity?.title || agentStatus || (runningTool ? `Tool · ${runningTool.name}` : 'Working…');
    // wrap="truncate-end": status ต้องอยู่ 1 บรรทัดเสมอ — กัน timer/elapsed ทำบรรทัดเด้งหลังส่ง prompt
    return (
      <Text dimColor wrap="truncate-end">
        {detail} · Esc/Ctrl+C หยุด · พิมพ์เพื่อต่อคิว (⏎)
      </Text>
    );
  }
  if (!busy && !value) {
    return (
      <Text dimColor wrap="truncate-end">
        ถามอะไรก็ได้ — /help ดูคำสั่ง · /tools ดู tools · @ไฟล์ แนบ context/รูป
      </Text>
    );
  }

  // multiline (กด Alt+Enter / ลงท้าย \) — สูงหลายบรรทัดตั้งใจอยู่แล้ว: render grapheme-cursor แบบ wrap ปกติ
  if (value.includes('\n')) {
    const ci = cursorGraphemeIndex(value, cursor);
    const graphemes = graphemesOf(value);
    const before = graphemes.slice(0, ci).join('');
    const at = ci < graphemes.length ? graphemes[ci] : ' ';
    const after = ci < graphemes.length ? graphemes.slice(ci + 1).join('') : '';
    return (
      <Text>
        {before}
        <Text inverse>{at}</Text>
        {after}
        {busy ? <Text dimColor>{'  '}(⏎ ต่อคิว)</Text> : null}
      </Text>
    );
  }

  // บรรทัดเดียว: viewport กว้างคงที่ (เลื่อนแนวนอนแทน wrap) → กล่อง input สูง 1 บรรทัดเสมอ ไม่เด้งตอนพิมพ์ไทย
  // เผื่อ overhead: border(2) + paddingX(2) + prefix "› "(2) + ช่อง cursor/suffix ~2
  const queueHint = busy ? '  (⏎ ต่อคิว)' : '';
  const reserved = 8 + queueHint.length;
  const vp = inputViewport(value, cursor, Math.max(8, columns - reserved));
  return (
    <Text wrap="truncate-end">
      {vp.lead ? <Text dimColor>{SCROLL_LEAD}</Text> : null}
      {vp.before}
      <Text inverse>{vp.at}</Text>
      {vp.after}
      {vp.tail ? <Text dimColor>{SCROLL_TAIL}</Text> : null}
      {queueHint ? <Text dimColor>{queueHint}</Text> : null}
    </Text>
  );
}

function statusColor(status: ToolTrailItem['status']): string {
  return status === 'error' ? 'red' : status === 'running' ? 'yellow' : 'green';
}

function statusMarker(status: ToolTrailItem['status']): string {
  return status === 'error' ? '✗' : status === 'running' ? '›' : '✓';
}

// total diff rows rendered per tool row — a hard per-item height bound. diffLines caps each SIDE at
// MAX_DIFF_LINES, so a two-sided edit can exceed this; we cap the combined rows here and show a plain
// "…" (no count — the inner per-side "…(+N)" sentinels already carry the numbers, so we don't double-count).
const MAX_ROW_DIFF_LINES = 14;

/** one tool's activity: a friendly title line + colored diff (green +, red -), height-bounded. */
function ActivityRow({ item, width }: { item: ToolTrailItem; width: number }) {
  const title = item.activity?.title ?? item.name;
  const fullDiff = item.activity?.diff;
  const diff = fullDiff?.slice(0, MAX_ROW_DIFF_LINES);
  const diffClipped = (fullDiff?.length ?? 0) > MAX_ROW_DIFF_LINES;
  return (
    <Box flexDirection="column">
      <Text color={statusColor(item.status)} wrap="truncate-end">
        {statusMarker(item.status)} {title}
      </Text>
      {diff?.map((line, idx) => (
        <Text
          key={`d-${item.id}-${idx}`}
          color={line.sign === '+' ? 'green' : line.sign === '-' ? 'red' : undefined}
          dimColor={line.sign === ' '}
          wrap="truncate-end"
        >
          {'  '}
          {line.sign === ' ' ? ' ' : line.sign} {line.text.slice(0, Math.max(0, width - 4))}
        </Text>
      ))}
      {diffClipped ? <Text dimColor>{'      …'}</Text> : null}
      {item.status !== 'running' && item.detail ? (
        <Text color={item.status === 'error' ? 'red' : undefined} dimColor wrap="truncate-end">
          {'    ↳ '}
          {item.detail.slice(0, Math.max(0, width - 6))}
        </Text>
      ) : null}
    </Box>
  );
}

function ToolTrailView({ columns, items, mode }: { columns: number; items: ToolTrailItem[]; mode: ToolTrailDisplayMode }) {
  if (mode === 'hidden' || !items.length) return null;
  const header = toolTrailHeader(items, mode);
  // compact mode keeps the terse one-line string rendering
  if (mode === 'compact') {
    const lines = toolTrailLines(items, columns, mode);
    return (
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, index) => (
          <Text key={`${index}-${line}`} color={index === 0 ? 'cyan' : undefined} dimColor={index > 0} wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>
    );
  }
  // expanded: rich, colored per-tool activity with diffs
  const width = toolTrailWidth(columns);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan" wrap="truncate-end">
        {header[0]}
      </Text>
      <Text dimColor wrap="truncate-end">
        {header[1]}
      </Text>
      {items.map((item) => (
        <ActivityRow key={item.id} item={item} width={width} />
      ))}
    </Box>
  );
}

function ThinkingView({ columns, mode, text }: { columns: number; mode: DetailsDisplayMode; text?: string }) {
  const lines = thinkingPanelLines(text, columns, mode);
  if (!lines.length) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} color={index === 0 ? 'cyan' : undefined} dimColor={index > 0} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  );
}

function TurnView({
  columns,
  isLatest,
  thinkingMode,
  toolTrailMode,
  turn,
}: {
  columns: number;
  isLatest: boolean;
  thinkingMode: DetailsDisplayMode;
  toolTrailMode: ToolTrailDisplayMode;
  turn: Turn;
}) {
  if (turn.role === 'system') return <Text dimColor>{turn.text}</Text>;
  if (turn.role === 'user')
    return (
      <Box marginTop={1}>
        <Text color="cyan">› </Text>
        <Text color="cyan">{turn.text}</Text>
      </Box>
    );
  return (
    <Box flexDirection="column" marginTop={1}>
      {turn.thinking ? <ThinkingView columns={columns} mode={thinkingMode} text={turn.thinking} /> : null}
      <MarkdownText columns={columns} text={turn.text} />
      {turn.toolTrail ? (
        // scrollback: only the latest turn keeps the full expanded diff; older turns downgrade
        // expanded→compact so deep history can't stack many full diff blocks (Ctrl+T / /trail still
        // collapses everything; hidden stays hidden).
        <ToolTrailView columns={columns} items={turn.toolTrail} mode={isLatest || toolTrailMode !== 'expanded' ? toolTrailMode : 'compact'} />
      ) : null}
    </Box>
  );
}
