import { Box, Text, useInput } from 'ink';
import { homedir } from 'node:os';
import { useState } from 'react';
import { BRAND } from '../brand.js';
import { TOOL_CATALOG } from '../tool-catalog.js';
import { clipToWidth } from './text-width.js';

const MIN_PANEL_COLUMNS = 48;
const COMPACT_PANEL_COLUMNS = 72;
const MAX_PANEL_COLUMNS = 100;
const PREVIEW_LIMIT = 4;

export type StartupSection = 'tools' | 'skills' | 'mcp';

export interface StartupSectionPreview {
  count: number;
  names: string[];
}

export interface SessionPanelProps {
  columns: number;
  cwd?: string;
  model: string;
  mode: 'ask' | 'auto';
  mcp?: StartupSectionPreview | 'checking';
  skills?: StartupSectionPreview | 'checking';
  tools?: StartupSectionPreview;
}

// display-width aware (Thai/emoji) so panel rows align with the border
const clip = (text: string, width: number): string => clipToWidth(text, width);

function displayDir(cwd?: string): string {
  return (cwd ?? process.cwd()).replace(homedir(), '~');
}

function sectionCount(value: StartupSectionPreview | 'checking' | undefined, fallback = 0): string {
  if (value === 'checking') return 'checking';
  if (!value) return `${fallback}`;
  return value.count ? `${value.count}` : 'none';
}

function previewNames(value: StartupSectionPreview | 'checking' | undefined, fallbackNames: string[] = []): string[] {
  if (value === 'checking') return ['checking…'];
  if (!value?.names.length) return fallbackNames.length ? fallbackNames : ['none configured'];
  return value.names.slice(0, PREVIEW_LIMIT);
}

export function sessionPanelLines({
  columns,
  cwd,
  expanded,
  mcp,
  model,
  mode,
  skills,
  tools,
}: SessionPanelProps & { expanded?: ReadonlySet<StartupSection> }): string[] {
  const width = Math.max(20, Math.floor(columns || 80));
  if (width < MIN_PANEL_COLUMNS) return [];

  const dir = displayDir(cwd);
  const toolPreview = tools ?? { count: TOOL_CATALOG.length, names: TOOL_CATALOG.map((tool) => tool.name) };
  const expandedSections = expanded ?? new Set<StartupSection>();

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

  const lines = [
    `${BRAND.bannerWide} service routes`,
    'Code     @file mentions · read/edit/run tools · git diff/undo',
    'Brain    second-brain context · remember/recall · reusable workflows /skills',
    'Connect  MCP registry search/install · doctor · gateway serve',
    'Ship     /copy handoff · cost guard · final proof · /undo safety',
    'System   ask approvals · queued follow-ups · /hotkeys',
    `Runtime ${model} · ${mode}-mode · BYOK · ${dir}`,
    'Launchpad 1 tools · 2 skills · 3 MCP',
  ];

  const sectionLine = (key: StartupSection, label: string, countLabel: string, preview: string[]): void => {
    const open = expandedSections.has(key);
    lines.push(`${open ? '▾' : '▸'} ${label} (${countLabel})`);
    if (open) {
      for (const name of preview) lines.push(`    ${name}`);
    }
  };

  sectionLine('tools', 'Tools', sectionCount(toolPreview, TOOL_CATALOG.length), previewNames(toolPreview, TOOL_CATALOG.map((tool) => tool.name)));
  sectionLine('skills', 'Skills', sectionCount(skills), previewNames(skills, ['load with /skills']));
  sectionLine('mcp', 'MCP', sectionCount(mcp), previewNames(mcp, ['sanook mcp search/install']));

  return lines;
}

/** Hermes-style startup service panel, rebranded around Sanook's local-first workflow. */
export function SessionPanel(props: SessionPanelProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<StartupSection>>(() => new Set());

  useInput((input) => {
    if (input === '1') {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has('tools')) next.delete('tools');
        else next.add('tools');
        return next;
      });
    } else if (input === '2') {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has('skills')) next.delete('skills');
        else next.add('skills');
        return next;
      });
    } else if (input === '3') {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has('mcp')) next.delete('mcp');
        else next.add('mcp');
        return next;
      });
    }
  });

  const width = Math.max(20, Math.floor(props.columns || 80));
  const lines = sessionPanelLines({ ...props, expanded });
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
