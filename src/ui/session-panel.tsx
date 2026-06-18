import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import { BRAND } from '../brand.js';

const MIN_PANEL_COLUMNS = 48;
const COMPACT_PANEL_COLUMNS = 72;
const MAX_PANEL_COLUMNS = 100;

export interface SessionPanelProps {
  columns: number;
  cwd?: string;
  model: string;
  mode: 'ask' | 'auto';
}

const clip = (text: string, width: number): string => {
  if (width <= 0) return '';
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
};

function displayDir(cwd?: string): string {
  return (cwd ?? process.cwd()).replace(homedir(), '~');
}

export function sessionPanelLines({ columns, cwd, model, mode }: SessionPanelProps): string[] {
  const width = Math.max(20, Math.floor(columns || 80));
  if (width < MIN_PANEL_COLUMNS) return [];

  const dir = displayDir(cwd);
  if (width < COMPACT_PANEL_COLUMNS) {
    return [
      'Routes: Code · Brain · Connect · Ship',
      'Code    @file · /tools · git diff/undo',
      'Brain   context · remember · /skills',
      'Connect /mcp search/install · doctor',
      'Ship    /copy · cost guard · final proof',
      `System ${model} · ${mode}-mode`,
    ];
  }

  return [
    `${BRAND.bannerWide} service routes`,
    'Code     @file mentions · read/edit/run tools · git diff/undo',
    'Brain    second-brain context · remember/recall · reusable workflows /skills',
    'Connect  MCP registry search/install · doctor · gateway serve',
    'Ship     /copy handoff · cost guard · final proof · /undo safety',
    'System   ask approvals · queued follow-ups · /hotkeys',
    `Runtime ${model} · ${mode}-mode · BYOK · ${dir}`,
  ];
}

/** Hermes-style startup service panel, rebranded around Sanook's local-first workflow. */
export function SessionPanel(props: SessionPanelProps) {
  const width = Math.max(20, Math.floor(props.columns || 80));
  const lines = sessionPanelLines(props);
  if (!lines.length) return null;

  const panelWidth = Math.max(36, Math.min(width, MAX_PANEL_COLUMNS));
  const innerWidth = Math.max(1, panelWidth - 4);

  return (
    <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1} width={panelWidth} marginBottom={1}>
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} color={index === 0 ? 'green' : undefined} dimColor={index > 0} wrap="truncate-end">
          {clip(line, innerWidth)}
        </Text>
      ))}
    </Box>
  );
}
