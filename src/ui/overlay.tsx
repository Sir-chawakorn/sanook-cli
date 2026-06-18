import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { HOTKEYS } from '../hotkeys.js';
import type { ModelPickerOption } from '../model-picker.js';

export type OverlayKind = 'hotkeys' | 'model';

export interface HotkeysOverlayState {
  kind: 'hotkeys';
}

export interface ModelOverlayState {
  kind: 'model';
  options: ModelPickerOption[];
  selected: number;
}

export type OverlayState = HotkeysOverlayState | ModelOverlayState;

export interface OverlayNavigation {
  next?: () => void;
  previous?: () => void;
  select?: () => void;
}

export interface FloatingOverlayProps {
  columns: number;
  overlay: OverlayState | null;
}

interface OverlayBoxProps {
  children: ReactNode;
  columns: number;
}

const MIN_OVERLAY_COLUMNS = 42;
const MAX_OVERLAY_COLUMNS = 96;
const MODEL_WINDOW = 10;

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

export function modelOverlayLines(overlay: ModelOverlayState, columns: number): string[] {
  const width = overlayWidth(columns);
  const innerWidth = Math.max(1, width - 4);
  const window = modelWindow(overlay.options, overlay.selected);
  const visible = overlay.options.slice(window.start, window.end);
  const optionWidth = Math.max(10, Math.min(28, Math.floor(innerWidth * 0.38)));
  const metaWidth = Math.max(10, innerWidth - optionWidth - 8);
  const lines = ['Sanook model picker'];

  if (window.start > 0) lines.push(`... ${window.start} above`);
  for (const [offset, option] of visible.entries()) {
    const index = window.start + offset;
    const cursor = index === overlay.selected ? '>' : ' ';
    const current = option.current ? '*' : ' ';
    lines.push(`${cursor}${current} ${clip(option.label, optionWidth).padEnd(optionWidth)} ${clip(option.meta, metaWidth)}`);
  }
  if (window.end < overlay.options.length) lines.push(`... ${overlay.options.length - window.end} more`);
  lines.push('↑↓/jk select · Enter switch · Esc/q close');
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

/** Floating TUI overlays inspired by Hermes hubs; model/skills/session hubs plug in here. */
export function FloatingOverlay({ columns, overlay }: FloatingOverlayProps) {
  if (!overlay) return null;
  if (overlay.kind === 'hotkeys') return <HotkeysOverlay columns={columns} />;
  if (overlay.kind === 'model') return <ModelPickerOverlay columns={columns} overlay={overlay} />;
  return null;
}
