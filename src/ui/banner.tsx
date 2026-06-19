import { Box, Text, useStdout } from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { BRAND } from '../brand.js';

// gradient ของ Sanook: เขียว → ส้ม → ฟ้า (สนุก = สดใส)
const SANOOK_GRADIENT = ['#22C55E', '#F97316', '#38BDF8'];
const BANNER_TITLE = BRAND.bannerWide.toUpperCase();
const COMMAND_HINTS = ['/help', '/tools', '/mcp', '/status'];
const BRAND_LINE = 'งานหนักให้เบาลง · ไม่เบาความรับผิดชอบ · local-first memory';
const WORKFLOW = ['plan', 'patch', 'prove', 'remember'] as const;
const PROMISE = ['readable', 'recoverable', 'remembered'] as const;
const SERVICE_ROUTES = [
  ['1', 'Code', '@file · /tools · /diff'],
  ['2', 'Brain', 'brain context · /skills · /compress'],
  ['3', 'Connect', '/mcp · serve · webhooks'],
  ['4', 'Ship', '/cost · /copy · /undo'],
] as const;
const WIDE_WORDMARK_MIN_COLUMNS = 96;
const COMPACT_PANEL_COLUMNS = 76;
const TINY_PANEL_COLUMNS = 44;
const MAX_PANEL_COLUMNS = 100;

// version จาก package.json (single source of truth) — กัน default drift เหมือน bin.ts
const VERSION = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

export interface BannerProps {
  model: string;
  version?: string;
  account?: string;
  cwd?: string;
  mode?: string;
  columns?: number;
  signals?: BannerSignal[];
}

export interface BannerSignal {
  label: string;
  tone?: 'ready' | 'warn' | 'muted';
  value: string;
}

const clip = (text: string, width: number): string => {
  if (width <= 0) return '';
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
};

function signalText(signals: readonly BannerSignal[]): string {
  return signals
    .filter((signal) => signal.label.trim() && signal.value.trim())
    .map((signal) => {
      const prefix = signal.tone === 'warn' ? '!' : signal.tone === 'muted' ? '-' : '+';
      return `${prefix} ${signal.label} ${signal.value}`;
    })
    .join(' · ');
}

function bannerLines(
  {
    account,
    dir,
    model,
    mode,
    signals,
    version,
  }: { account: string; dir: string; model: string; mode: string; signals: readonly BannerSignal[]; version: string },
  columns: number,
): string[] {
  const title = `${BANNER_TITLE} v${version} · terminal AI agent · ${account}`;
  const status = `● model ${model} · mode ${mode} · cwd ${dir}`;
  const signalLine = signalText(signals);
  const flow = `Flow ${WORKFLOW.join(' -> ')} · Promise ${PROMISE.join(' · ')}`;
  const routeLine = `Routes ${SERVICE_ROUTES.map(([num, label]) => `${num} ${label}`).join(' | ')} · ${COMMAND_HINTS.join(' · ')}`;

  if (columns < TINY_PANEL_COLUMNS) {
    return [
      title,
      `● ${model} · ${mode}`,
      ...(signalLine ? [`Signals ${signalLine}`] : []),
      '› /help · /tools · /mcp',
    ];
  }

  if (columns < COMPACT_PANEL_COLUMNS) {
    return [
      title,
      status,
      ...(signalLine ? [`Signals ${signalLine}`] : []),
      `◆ ${BRAND_LINE}`,
      `Flow ${WORKFLOW.join(' -> ')}`,
      '› routes: Code · Brain · Connect · Ship',
      '› code: @file · /tools · /diff',
      '› brain: context · skills · compress',
      '› connect: /mcp · serve',
      '› ship: /copy · /cost · /undo',
    ];
  }

  return [
    title,
    status,
    ...(signalLine ? [`Signals ${signalLine}`] : []),
    `◆ ${BRAND_LINE}`,
    flow,
    routeLine,
    ...SERVICE_ROUTES.map(([num, label, hint]) => `› ${num} ${label.padEnd(7)} ${hint}`),
  ];
}

/** welcome banner — Hermes-style responsive wordmark + compact Sanook launchpad. */
export function Banner({ model, version = VERSION, account = 'BYOK', cwd, mode = 'auto', columns, signals = [] }: BannerProps) {
  const { stdout } = useStdout();
  const dir = (cwd ?? process.cwd()).replace(homedir(), '~');
  const terminalColumns = Math.max(1, Math.floor(columns ?? stdout?.columns ?? MAX_PANEL_COLUMNS));
  const showWordmark = terminalColumns >= WIDE_WORDMARK_MIN_COLUMNS;
  const panelWidth = Math.max(28, Math.min(terminalColumns, MAX_PANEL_COLUMNS));
  const innerWidth = Math.max(1, panelWidth - 4);
  const lines = bannerLines({ account, dir, model, mode, signals, version }, terminalColumns);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {showWordmark ? (
        <Gradient colors={SANOOK_GRADIENT}>
          <BigText text={BANNER_TITLE} font="block" align="left" />
        </Gradient>
      ) : null}

      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} width={panelWidth}>
        {lines.map((line, index) => (
          <Text color={index === 0 ? 'cyan' : undefined} dimColor={index > 0} key={`${index}-${line}`} wrap="truncate-end">
            {clip(line, innerWidth)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
