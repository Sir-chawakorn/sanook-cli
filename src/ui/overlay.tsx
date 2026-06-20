import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { HOTKEYS } from '../hotkeys.js';
import type { McpHubState } from '../mcp-hub.js';
import type { ModelPickerOption, ModelProviderEntry } from '../model-picker.js';
import type { Session } from '../session.js';
import type { CompletionItem } from '../slash-completion.js';
import type { Skill } from '../skills.js';
import type { ToolCatalogEntry } from '../tool-catalog.js';
import type { TaskRecord } from '../orchestrate.js';

export type OverlayKind = 'hotkeys' | 'mcp' | 'model' | 'pager' | 'skills' | 'sessions' | 'tasks' | 'tools';

export interface HotkeysOverlayState {
  kind: 'hotkeys';
}

export interface ModelOverlayState {
  kind: 'model';
  phase: 'provider' | 'model';
  providerFilter?: string;
  providers: ModelProviderEntry[];
  options: ModelPickerOption[];
  selected: number;
}

export interface McpOverlayState {
  detail: boolean;
  kind: 'mcp';
  notes: string[];
  probe?: McpOverlayProbe;
  selected: number;
  servers: McpHubState['entries'];
  toolSelected?: number;
}

export interface McpOverlayProbe {
  error?: string;
  serverName: string;
  status: 'fail' | 'pass' | 'running';
  tools?: { name: string; description?: string }[];
  transport?: 'http' | 'stdio';
}

export interface PagerOverlayState {
  kind: 'pager';
  lines: string[];
  offset: number;
  title?: string;
}

export interface SkillsOverlayState {
  detail: boolean;
  kind: 'skills';
  selected: number;
  skills: Skill[];
}

export interface SessionsOverlayState {
  currentCwd?: string;
  detail?: boolean;
  kind: 'sessions';
  notice?: string;
  pendingDeleteId?: string;
  renaming?: string;
  selected: number;
  sessions: Session[];
}

export interface ToolsOverlayState {
  detail: boolean;
  kind: 'tools';
  selected: number;
  tools: ToolCatalogEntry[];
}

export interface TasksOverlayState {
  detail: boolean;
  kind: 'tasks';
  selected: number;
  tasks: TaskRecord[];
}

export type OverlayState =
  | HotkeysOverlayState
  | McpOverlayState
  | ModelOverlayState
  | PagerOverlayState
  | SkillsOverlayState
  | SessionsOverlayState
  | TasksOverlayState
  | ToolsOverlayState;

export interface OverlayNavigation {
  next?: () => void;
  previous?: () => void;
  select?: () => void;
}

export interface FloatingOverlayProps {
  columns: number;
  overlay: OverlayState | null;
  pageSize?: number;
}

export interface CompletionOverlayProps {
  columns: number;
  items: CompletionItem[];
  selected: number;
}

interface OverlayBoxProps {
  children: ReactNode;
  columns: number;
}

const MIN_OVERLAY_COLUMNS = 42;
const MAX_OVERLAY_COLUMNS = 96;
const MODEL_WINDOW = 10;
const MCP_WINDOW = 10;
const SKILL_WINDOW = 10;
const SESSION_WINDOW = 10;
const TASK_WINDOW = 10;
const TOOL_WINDOW = 10;
const DEFAULT_PAGER_PAGE_SIZE = 12;
const COMPLETION_WINDOW = 8;

function OverlayBox({ children, columns }: OverlayBoxProps) {
  const width = overlayWidth(columns);
  return (
    <Box borderStyle="double" borderColor="cyan" flexDirection="column" marginBottom={1} paddingX={1} width={width}>
      {children}
    </Box>
  );
}

function overlayWidth(columns: number): number {
  return Math.max(34, Math.min(Math.max(MIN_OVERLAY_COLUMNS, Math.floor(columns || 80) - 4), MAX_OVERLAY_COLUMNS));
}

function clip(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

export function completionOverlayLines(items: CompletionItem[], selected: number, columns: number): string[] {
  if (!items.length) return [];
  const width = Math.max(28, Math.min(Math.max(34, columns - 6), MAX_OVERLAY_COLUMNS));
  const viewport = Math.min(COMPLETION_WINDOW, items.length);
  const safeSelected = Math.max(0, Math.min(selected, items.length - 1));
  const start = Math.max(0, Math.min(safeSelected - Math.floor(COMPLETION_WINDOW / 2), items.length - viewport));
  const visible = items.slice(start, start + viewport);
  const commandWidth = Math.max(10, Math.min(22, Math.floor(width * 0.34)));
  const metaWidth = Math.max(8, width - commandWidth - 7);
  const lines = visible.map((item, offset) => {
    const index = start + offset;
    const cursor = index === safeSelected ? '>' : ' ';
    return `${cursor} ${clip(item.display, commandWidth).padEnd(commandWidth)} ${clip(item.meta, metaWidth)}`;
  });
  lines.push('↑↓ select · Tab/Enter complete');
  return lines;
}

export function CompletionOverlay({ columns, items, selected }: CompletionOverlayProps) {
  const width = Math.max(28, Math.min(Math.max(34, columns - 6), MAX_OVERLAY_COLUMNS));
  const innerWidth = Math.max(1, width - 4);
  const lines = completionOverlayLines(items, selected, columns);
  if (!lines.length) return null;
  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" marginBottom={1} paddingX={1} width={width}>
      {lines.map((line, index) => {
        const isActive = line.startsWith('>');
        return (
          <Text
            key={`${index}-${line}`}
            color={isActive ? 'green' : undefined}
            dimColor={!isActive}
            inverse={isActive}
            wrap="truncate-end"
          >
            {clip(line, innerWidth)}
          </Text>
        );
      })}
    </Box>
  );
}

export function hotkeyOverlayLines(columns: number): string[] {
  const width = overlayWidth(columns);
  const keyWidth = Math.min(24, HOTKEYS.reduce((max, [key]) => Math.max(max, key.length), 0));
  const bodyWidth = Math.max(10, width - keyWidth - 7);
  return [
    'Sanook hotkeys',
    ...HOTKEYS.map(([key, help]) => `${key.padEnd(keyWidth)}  ${clip(help, bodyWidth)}`),
    'Esc / Enter / q        close',
  ];
}

function HotkeysOverlay({ columns }: { columns: number }) {
  const innerWidth = Math.max(1, overlayWidth(columns) - 4);
  const lines = hotkeyOverlayLines(columns);
  return (
    <OverlayBox columns={columns}>
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} color={index === 0 ? 'cyan' : undefined} dimColor={index > 0} wrap="truncate-end">
          {clip(line, innerWidth)}
        </Text>
      ))}
    </OverlayBox>
  );
}

function modelWindow(options: ModelPickerOption[], selected: number): { end: number; start: number } {
  const safeSelected = Math.max(0, Math.min(selected, Math.max(0, options.length - 1)));
  const start = Math.max(0, Math.min(safeSelected - Math.floor(MODEL_WINDOW / 2), Math.max(0, options.length - MODEL_WINDOW)));
  return { end: Math.min(options.length, start + MODEL_WINDOW), start };
}

function listWindow(count: number, selected: number, size: number): { end: number; start: number } {
  const safeSelected = Math.max(0, Math.min(selected, Math.max(0, count - 1)));
  const start = Math.max(0, Math.min(safeSelected - Math.floor(size / 2), Math.max(0, count - size)));
  return { end: Math.min(count, start + size), start };
}

function shortDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso.slice(0, 16);
  return new Date(parsed).toISOString().slice(0, 16).replace('T', ' ');
}

export function modelOverlayLines(overlay: ModelOverlayState, columns: number): string[] {
  const width = overlayWidth(columns);
  const innerWidth = Math.max(1, width - 4);
  if (overlay.phase === 'provider') {
    const window = listWindow(overlay.providers.length, overlay.selected, MODEL_WINDOW);
    const visible = overlay.providers.slice(window.start, window.end);
    const nameWidth = Math.max(12, Math.min(24, Math.floor(innerWidth * 0.45)));
    const lines = ['Sanook model picker — choose provider'];
    if (window.start > 0) lines.push(`... ${window.start} above`);
    for (const [offset, provider] of visible.entries()) {
      const index = window.start + offset;
      const cursor = index === overlay.selected ? '>' : ' ';
      lines.push(
        `${cursor} ${clip(provider.label, nameWidth).padEnd(nameWidth)} ${provider.modelCount} models · ${provider.status}`,
      );
    }
    if (window.end < overlay.providers.length) lines.push(`... ${overlay.providers.length - window.end} more`);
    lines.push('Enter drill down · Esc/q close');
    return lines;
  }

  const window = modelWindow(overlay.options, overlay.selected);
  const visible = overlay.options.slice(window.start, window.end);
  const optionWidth = Math.max(10, Math.min(28, Math.floor(innerWidth * 0.38)));
  const metaWidth = Math.max(10, innerWidth - optionWidth - 8);
  const providerLabel = overlay.providerFilter ?? 'all';
  const lines = [`Sanook model picker — ${providerLabel}`];

  if (window.start > 0) lines.push(`... ${window.start} above`);
  for (const [offset, option] of visible.entries()) {
    const index = window.start + offset;
    const cursor = index === overlay.selected ? '>' : ' ';
    const current = option.current ? '*' : ' ';
    lines.push(`${cursor}${current} ${clip(option.label, optionWidth).padEnd(optionWidth)} ${clip(option.meta, metaWidth)}`);
  }
  if (window.end < overlay.options.length) lines.push(`... ${overlay.options.length - window.end} more`);
  lines.push('Enter switch · Esc back to providers · q close');
  return lines;
}

function ModelPickerOverlay({ columns, overlay }: { columns: number; overlay: ModelOverlayState }) {
  const innerWidth = Math.max(1, overlayWidth(columns) - 4);
  const lines = modelOverlayLines(overlay, columns);
  return (
    <OverlayBox columns={columns}>
      {lines.map((line, index) => {
        const isHeader = index === 0;
        const isActive = line.startsWith('>');
        return (
          <Text
            key={`${index}-${line}`}
            color={isHeader ? 'cyan' : isActive ? 'green' : undefined}
            dimColor={!isHeader && !isActive}
            inverse={isActive}
            wrap="truncate-end"
          >
            {clip(line, innerWidth)}
          </Text>
        );
      })}
    </OverlayBox>
  );
}

export function mcpOverlayLines(overlay: McpOverlayState, columns: number): string[] {
  const width = overlayWidth(columns);
  const innerWidth = Math.max(1, width - 4);
  const selected = overlay.servers[overlay.selected];

  if (!overlay.servers.length) {
    return [
      'Sanook MCP hub',
      'No MCP servers configured',
      'add: sanook mcp search github · sanook mcp install <server>',
      ...overlay.notes.slice(0, 2).map((note) => `note: ${clip(note, Math.max(1, innerWidth - 6))}`),
      'Esc/q close',
    ];
  }

  if (overlay.detail && selected) {
    const probe = overlay.probe?.serverName === selected.name ? overlay.probe : undefined;
    const probeLines = mcpProbeLines(probe, innerWidth, overlay.toolSelected ?? 0);
    return [
      'Sanook MCP hub',
      `${selected.name} (${selected.transport})`,
      clip(selected.target, innerWidth),
      `secrets: ${selected.secretSummary}`,
      `doctor: t test selected · sanook mcp test ${selected.name}`,
      ...probeLines,
      't test · Enter/Esc back · q close',
    ];
  }

  const nameWidth = Math.max(10, Math.min(22, Math.floor(innerWidth * 0.28)));
  const targetWidth = Math.max(10, innerWidth - nameWidth - 19);
  const window = listWindow(overlay.servers.length, overlay.selected, MCP_WINDOW);
  const visible = overlay.servers.slice(window.start, window.end);
  const lines = ['Sanook MCP hub', `${overlay.servers.length} servers · Enter inspect · t test`];

  if (overlay.notes.length) lines.push(`note: ${clip(overlay.notes[0], Math.max(1, innerWidth - 6))}`);
  if (window.start > 0) lines.push(`... ${window.start} above`);
  for (const [offset, server] of visible.entries()) {
    const index = window.start + offset;
    const cursor = index === overlay.selected ? '>' : ' ';
    lines.push(
      `${cursor} ${clip(server.name, nameWidth).padEnd(nameWidth)} ${server.transport.padEnd(5)} ${clip(server.target, targetWidth)}`,
    );
  }
  if (window.end < overlay.servers.length) lines.push(`... ${overlay.servers.length - window.end} more`);
  lines.push('↑↓/jk select · Enter inspect · t test · Esc/q close');
  return lines;
}

function mcpProbeLines(probe: McpOverlayProbe | undefined, innerWidth: number, selectedIndex = 0): string[] {
  if (!probe) return [];
  if (probe.status === 'running') return ['test: running...'];
  if (probe.status === 'fail') {
    const transport = probe.transport ? ` (${probe.transport})` : '';
    return [`test: FAIL${transport} ${clip(probe.error ?? 'unknown error', Math.max(1, innerWidth - 12))}`];
  }

  const tools = probe.tools ?? [];
  const lines = [`test: PASS (${tools.length} tools)`];
  if (!tools.length) return lines;

  const active = Math.max(0, Math.min(selectedIndex, tools.length - 1));
  const window = listWindow(tools.length, active, 6);
  const visible = tools.slice(window.start, window.end);
  lines.push(`catalog: ${tools.length} tools · ↑↓/jk browse`);
  if (window.start > 0) lines.push(`... ${window.start} above`);
  for (const [offset, tool] of visible.entries()) {
    const index = window.start + offset;
    const cursor = index === active ? '>' : ' ';
    const description = tool.description ? ` - ${tool.description}` : '';
    lines.push(`${cursor} ${clip(`${tool.name}${description}`, Math.max(1, innerWidth - 2))}`);
  }
  if (window.end < tools.length) lines.push(`... ${tools.length - window.end} more tools`);
  return lines;
}

function McpHubOverlay({ columns, overlay }: { columns: number; overlay: McpOverlayState }) {
  const innerWidth = Math.max(1, overlayWidth(columns) - 4);
  const lines = mcpOverlayLines(overlay, columns);
  return (
    <OverlayBox columns={columns}>
      {lines.map((line, index) => {
        const isHeader = index === 0;
        const isActive = line.startsWith('>');
        return (
          <Text
            key={`${index}-${line}`}
            color={isHeader ? 'cyan' : isActive ? 'green' : undefined}
            dimColor={!isHeader && !isActive}
            inverse={isActive}
            wrap="truncate-end"
          >
            {clip(line, innerWidth)}
          </Text>
        );
      })}
    </OverlayBox>
  );
}

export function pagerOverlayLines(overlay: PagerOverlayState, columns: number, pageSize = DEFAULT_PAGER_PAGE_SIZE): string[] {
  const width = overlayWidth(columns);
  const innerWidth = Math.max(1, width - 4);
  const size = Math.max(3, pageSize);
  const max = Math.max(0, overlay.lines.length - size);
  const offset = Math.max(0, Math.min(overlay.offset, max));
  const end = Math.min(overlay.lines.length, offset + size);
  const title = overlay.title || 'Sanook pager';
  const visible = overlay.lines.slice(offset, end).map((line) => clip(line || ' ', innerWidth));
  const hint =
    end < overlay.lines.length
      ? `↑↓/jk line · Enter/Space/PgDn page · b/PgUp back · g/G top/bottom · Esc/q close (${end}/${overlay.lines.length})`
      : `end · ↑↓/jk · b/PgUp back · g top · Esc/q close (${overlay.lines.length} lines)`;
  return [title, ...visible, clip(hint, innerWidth)];
}

function PagerOverlay({ columns, overlay, pageSize }: { columns: number; overlay: PagerOverlayState; pageSize: number }) {
  const innerWidth = Math.max(1, overlayWidth(columns) - 4);
  const lines = pagerOverlayLines(overlay, columns, pageSize);
  return (
    <OverlayBox columns={columns}>
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} color={index === 0 ? 'cyan' : undefined} dimColor={index > 0} wrap="truncate-end">
          {clip(line, innerWidth)}
        </Text>
      ))}
    </OverlayBox>
  );
}

export function skillsOverlayLines(overlay: SkillsOverlayState, columns: number): string[] {
  const width = overlayWidth(columns);
  const innerWidth = Math.max(1, width - 4);
  const selected = overlay.skills[overlay.selected];
  const nameWidth = Math.max(12, Math.min(30, Math.floor(innerWidth * 0.34)));
  const descWidth = Math.max(10, innerWidth - nameWidth - 6);

  if (!overlay.skills.length) {
    return ['Sanook skills hub', 'No skills found', 'Esc/q close'];
  }

  if (overlay.detail && selected) {
    return [
      'Sanook skills hub',
      selected.name,
      selected.description ? clip(selected.description, innerWidth) : '(no description)',
      selected.whenToUse ? `when: ${clip(selected.whenToUse, Math.max(1, innerWidth - 6))}` : '',
      `path: ${clip(selected.path, Math.max(1, innerWidth - 6))}`,
      'Enter/Esc back · q close',
    ].filter(Boolean);
  }

  const window = listWindow(overlay.skills.length, overlay.selected, SKILL_WINDOW);
  const visible = overlay.skills.slice(window.start, window.end);
  const lines = ['Sanook skills hub', `${overlay.skills.length} skills · Enter inspect`];

  if (window.start > 0) lines.push(`... ${window.start} above`);
  for (const [offset, skill] of visible.entries()) {
    const index = window.start + offset;
    const cursor = index === overlay.selected ? '>' : ' ';
    lines.push(`${cursor} ${clip(skill.name, nameWidth).padEnd(nameWidth)} ${clip(skill.description || '(no description)', descWidth)}`);
  }
  if (window.end < overlay.skills.length) lines.push(`... ${overlay.skills.length - window.end} more`);
  lines.push('↑↓/jk select · Enter inspect · Esc/q close');
  return lines;
}

function SkillsHubOverlay({ columns, overlay }: { columns: number; overlay: SkillsOverlayState }) {
  const innerWidth = Math.max(1, overlayWidth(columns) - 4);
  const lines = skillsOverlayLines(overlay, columns);
  return (
    <OverlayBox columns={columns}>
      {lines.map((line, index) => {
        const isHeader = index === 0;
        const isActive = line.startsWith('>');
        return (
          <Text
            key={`${index}-${line}`}
            color={isHeader ? 'cyan' : isActive ? 'green' : undefined}
            dimColor={!isHeader && !isActive}
            inverse={isActive}
            wrap="truncate-end"
          >
            {clip(line, innerWidth)}
          </Text>
        );
      })}
    </OverlayBox>
  );
}

export function toolsOverlayLines(overlay: ToolsOverlayState, columns: number): string[] {
  const width = overlayWidth(columns);
  const innerWidth = Math.max(1, width - 4);
  const selected = overlay.tools[overlay.selected];
  const groupWidth = Math.max(8, Math.min(16, Math.floor(innerWidth * 0.2)));
  const nameWidth = Math.max(12, Math.min(26, Math.floor(innerWidth * 0.3)));
  const summaryWidth = Math.max(10, innerWidth - groupWidth - nameWidth - 8);

  if (!overlay.tools.length) {
    return ['Sanook tools hub', 'No built-in tools found', 'Esc/q close'];
  }

  if (overlay.detail && selected) {
    return [
      'Sanook tools hub',
      `${selected.group} / ${selected.name}`,
      clip(selected.summary, innerWidth),
      `detail: ${clip(selected.detail, Math.max(1, innerWidth - 8))}`,
      'MCP tools live in /mcp · skills live in /skills',
      'Enter/Esc back · q close',
    ].map((line) => clip(line, width));
  }

  const window = listWindow(overlay.tools.length, overlay.selected, TOOL_WINDOW);
  const visible = overlay.tools.slice(window.start, window.end);
  const lines = ['Sanook tools hub', `${overlay.tools.length} built-in lanes · Enter inspect`];

  if (window.start > 0) lines.push(`... ${window.start} above`);
  for (const [offset, tool] of visible.entries()) {
    const index = window.start + offset;
    const cursor = index === overlay.selected ? '>' : ' ';
    lines.push(
      `${cursor} ${clip(tool.group, groupWidth).padEnd(groupWidth)} ${clip(tool.name, nameWidth).padEnd(nameWidth)} ${clip(tool.summary, summaryWidth)}`,
    );
  }
  if (window.end < overlay.tools.length) lines.push(`... ${overlay.tools.length - window.end} more`);
  lines.push('↑↓/jk select · Enter inspect · Esc/q close');
  return lines.map((line) => clip(line, width));
}

function ToolsHubOverlay({ columns, overlay }: { columns: number; overlay: ToolsOverlayState }) {
  const innerWidth = Math.max(1, overlayWidth(columns) - 4);
  const lines = toolsOverlayLines(overlay, columns);
  return (
    <OverlayBox columns={columns}>
      {lines.map((line, index) => {
        const isHeader = index === 0;
        const isActive = line.startsWith('>');
        return (
          <Text
            key={`${index}-${line}`}
            color={isHeader ? 'cyan' : isActive ? 'green' : undefined}
            dimColor={!isHeader && !isActive}
            inverse={isActive}
            wrap="truncate-end"
          >
            {clip(line, innerWidth)}
          </Text>
        );
      })}
    </OverlayBox>
  );
}

function taskElapsed(rec: TaskRecord, now = Date.now()): string {
  if (rec.state === 'running') return `${Math.max(0, Math.floor((now - rec.startedMs) / 1000))}s…`;
  if (rec.endedMs) return `${((rec.endedMs - rec.startedMs) / 1000).toFixed(1)}s`;
  return '—';
}

export function tasksOverlayLines(overlay: TasksOverlayState, columns: number, now = Date.now()): string[] {
  const width = overlayWidth(columns);
  const innerWidth = Math.max(1, width - 4);
  const selected = overlay.tasks[overlay.selected];

  if (!overlay.tasks.length) {
    return [
      'Sanook background tasks',
      'No task_spawn jobs in this session',
      'Esc/q close · spawn via task_spawn tool',
    ];
  }

  if (overlay.detail && selected) {
    const lines = [
      'Sanook background tasks',
      `${selected.id} · ${selected.state} · ${taskElapsed(selected, now)}`,
      selected.description,
      'Esc back · q close',
    ];
    if (selected.state === 'done' && selected.text) {
      lines.push('', clip(selected.text.trim().slice(0, 800), innerWidth));
    } else if (selected.state === 'error' && selected.error) {
      lines.push('', clip(selected.error, innerWidth));
    } else if (selected.state === 'running') {
      lines.push('', 'Still running — task_collect(id) when ready');
    }
    return lines;
  }

  const window = listWindow(overlay.tasks.length, overlay.selected, TASK_WINDOW);
  const visible = overlay.tasks.slice(window.start, window.end);
  const running = overlay.tasks.filter((t) => t.state === 'running').length;
  const lines = [
    'Sanook background tasks',
    `${overlay.tasks.length} job(s) · ${running} running · Enter inspect`,
  ];
  for (let index = 0; index < visible.length; index++) {
    const rec = visible[index];
    const absolute = window.start + index;
    const cursor = absolute === overlay.selected ? '>' : ' ';
    lines.push(`${cursor} ${rec.id}  ${rec.state.padEnd(8)} ${taskElapsed(rec, now)}  ${clip(rec.description, Math.max(12, innerWidth - 28))}`);
  }
  if (window.end < overlay.tasks.length) lines.push(`... ${overlay.tasks.length - window.end} more`);
  lines.push('Esc/q close');
  return lines;
}

function TasksHubOverlay({ columns, overlay }: { columns: number; overlay: TasksOverlayState }) {
  const innerWidth = Math.max(1, overlayWidth(columns) - 4);
  const lines = tasksOverlayLines(overlay, columns);
  return (
    <OverlayBox columns={columns}>
      {lines.map((line, index) => {
        const isHeader = index === 0;
        const isActive = line.startsWith('>');
        return (
          <Text
            key={`${index}-${line}`}
            color={isHeader ? 'cyan' : isActive ? 'yellow' : undefined}
            dimColor={!isHeader && !isActive}
            inverse={isActive}
            wrap="truncate-end"
          >
            {clip(line, innerWidth)}
          </Text>
        );
      })}
    </OverlayBox>
  );
}

function sessionTitle(session: Session, currentCwd?: string): string {
  const base = session.title || firstUserSummary(session) || '(untitled)';
  if (currentCwd && session.cwd !== currentCwd) return `≠ ${base}`;
  return base;
}

export function firstUserSummary(session: Session): string {
  const user = session.messages.find((message) => message.role === 'user');
  const content = user?.content;
  if (typeof content === 'string') return content.replace(/\s+/g, ' ').trim();
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === 'object' && part && 'text' in part && typeof part.text === 'string' ? part.text : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  }
  return '';
}

export function sessionsOverlayLines(overlay: SessionsOverlayState, columns: number): string[] {
  const width = overlayWidth(columns);
  const innerWidth = Math.max(1, width - 4);
  if (!overlay.sessions.length) {
    return ['Sanook sessions', overlay.notice ? clip(overlay.notice, innerWidth) : 'No saved sessions yet', 'Esc/q close'];
  }

  const selected = overlay.sessions[overlay.selected];
  if (overlay.renaming !== undefined && selected) {
    const title = selected.title || firstUserSummary(selected) || selected.id;
    return [
      'Sanook sessions',
      `rename: ${title}`,
      `title: ${overlay.renaming || '(empty)'}`,
      clip(overlay.notice ?? 'Enter save · Esc cancel', innerWidth),
    ];
  }

  if (overlay.detail && selected) {
    const title = sessionTitle(selected, overlay.currentCwd);
    const user = firstUserSummary(selected) || '(no user prompt found)';
    const deleteHint =
      overlay.pendingDeleteId === selected.id
        ? 'Delete this session? press d again · Esc cancel'
        : 'Enter resume · r rename · d delete · Esc back · q close';
    return [
      'Sanook sessions',
      clip(title, innerWidth),
      `id: ${clip(selected.id, Math.max(1, innerWidth - 4))}`,
      `model: ${clip(selected.model, Math.max(1, innerWidth - 7))}`,
      `updated: ${shortDate(selected.updated)} · messages: ${selected.messages.length}`,
      `cwd: ${clip(selected.cwd, Math.max(1, innerWidth - 5))}`,
      `first: ${clip(user, Math.max(1, innerWidth - 7))}`,
      clip(deleteHint, innerWidth),
    ];
  }

  const idWidth = Math.max(12, Math.min(24, Math.floor(innerWidth * 0.28)));
  const metaWidth = Math.max(12, Math.min(28, Math.floor(innerWidth * 0.34)));
  const titleWidth = Math.max(10, innerWidth - idWidth - metaWidth - 8);
  const window = listWindow(overlay.sessions.length, overlay.selected, SESSION_WINDOW);
  const visible = overlay.sessions.slice(window.start, window.end);
  const lines = ['Sanook sessions', `${overlay.sessions.length} resumable · all projects · Enter resume · i inspect · r rename · d delete`];

  if (overlay.notice) lines.push(clip(overlay.notice, innerWidth));

  if (window.start > 0) lines.push(`... ${window.start} above`);
  for (const [offset, session] of visible.entries()) {
    const index = window.start + offset;
    const cursor = index === overlay.selected ? '>' : ' ';
    const title = sessionTitle(session, overlay.currentCwd);
    const meta = `${session.model} · ${shortDate(session.updated)}`;
    lines.push(
      `${cursor} ${clip(session.id, idWidth).padEnd(idWidth)} ${clip(title, titleWidth).padEnd(titleWidth)} ${clip(meta, metaWidth)}`,
    );
  }
  if (window.end < overlay.sessions.length) lines.push(`... ${overlay.sessions.length - window.end} more`);
  const active = overlay.sessions[overlay.selected];
  if (active && overlay.pendingDeleteId === active.id) lines.push('Delete selected? press d again · Esc cancel');
  else lines.push('↑↓/jk select · Enter resume · i inspect · r rename · Esc/q close');
  return lines;
}

function SessionsSwitcherOverlay({ columns, overlay }: { columns: number; overlay: SessionsOverlayState }) {
  const innerWidth = Math.max(1, overlayWidth(columns) - 4);
  const lines = sessionsOverlayLines(overlay, columns);
  return (
    <OverlayBox columns={columns}>
      {lines.map((line, index) => {
        const isHeader = index === 0;
        const isActive = line.startsWith('>');
        return (
          <Text
            key={`${index}-${line}`}
            color={isHeader ? 'cyan' : isActive ? 'green' : undefined}
            dimColor={!isHeader && !isActive}
            inverse={isActive}
            wrap="truncate-end"
          >
            {clip(line, innerWidth)}
          </Text>
        );
      })}
    </OverlayBox>
  );
}

/** Floating TUI overlays inspired by Hermes hubs; model/skills/session hubs plug in here. */
export function FloatingOverlay({ columns, overlay, pageSize = DEFAULT_PAGER_PAGE_SIZE }: FloatingOverlayProps) {
  if (!overlay) return null;
  if (overlay.kind === 'hotkeys') return <HotkeysOverlay columns={columns} />;
  if (overlay.kind === 'mcp') return <McpHubOverlay columns={columns} overlay={overlay} />;
  if (overlay.kind === 'model') return <ModelPickerOverlay columns={columns} overlay={overlay} />;
  if (overlay.kind === 'pager') return <PagerOverlay columns={columns} overlay={overlay} pageSize={pageSize} />;
  if (overlay.kind === 'skills') return <SkillsHubOverlay columns={columns} overlay={overlay} />;
  if (overlay.kind === 'sessions') return <SessionsSwitcherOverlay columns={columns} overlay={overlay} />;
  if (overlay.kind === 'tasks') return <TasksHubOverlay columns={columns} overlay={overlay} />;
  if (overlay.kind === 'tools') return <ToolsHubOverlay columns={columns} overlay={overlay} />;
  return null;
}
