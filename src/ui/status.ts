export interface FooterStatusInput {
  branch?: string | null;
  columns: number;
  contextLimit?: number;
  contextTokens?: number;
  costHint?: string;
  cwd?: string;
  busy?: boolean;
  elapsedSeconds?: number;
  model: string;
  mode: 'ask' | 'auto';
  queuedCount?: number;
}

const clip = (text: string, width: number): string => {
  if (width <= 0) return '';
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
};

export interface StatusRuleWidths {
  leftWidth: number;
  rightWidth: number;
  separatorWidth: number;
}

export interface StatusSegments {
  contextBar: boolean;
  cost: boolean;
  cwd: boolean;
  elapsed: boolean;
  hints: boolean;
  hotkeys: boolean;
  queue: boolean;
}

export function statusSegments(columns: number): StatusSegments {
  const width = Math.max(20, Math.floor(columns || 80));
  return {
    contextBar: width >= 96,
    cost: width >= 78,
    cwd: width >= 64,
    elapsed: width >= 58,
    hints: width >= 46,
    hotkeys: width >= 72,
    queue: width >= 42,
  };
}

export function statusRuleWidths(columns: number, rightLabel: string, minLeftContent = 0): StatusRuleWidths {
  const width = Math.max(1, Math.floor(columns || 1));
  const separatorWidth = width >= 48 ? 3 : 1;
  const baseLeft = width >= 48 ? 20 : 8;
  const leftFloor = Math.min(width, Math.max(baseLeft, Math.floor(minLeftContent)));
  const maxRight = Math.max(0, width - separatorWidth - leftFloor);
  if (!rightLabel || maxRight <= 0) return { leftWidth: width, rightWidth: 0, separatorWidth: 0 };
  const rightWidth = Math.min(rightLabel.length, maxRight);
  return {
    leftWidth: Math.max(1, width - separatorWidth - rightWidth),
    rightWidth,
    separatorWidth,
  };
}

export function footerStatus({
  branch,
  busy = false,
  columns,
  contextLimit = 100_000,
  contextTokens,
  costHint = '',
  cwd = '',
  elapsedSeconds,
  model,
  mode,
  queuedCount = 0,
}: FooterStatusInput): string {
  const width = Math.max(20, Math.floor(columns || 80));
  const segments = statusSegments(width);
  const state = busy ? 'working' : 'ready';
  const parts = width < 40 ? [shortModel(model), mode] : ['SANOOK', state, shortModel(model), `${mode}-mode`];

  if (contextTokens != null && width >= 52) {
    parts.push(contextSegment(contextTokens, contextLimit, segments.contextBar));
  }
  if (busy && elapsedSeconds != null && segments.elapsed) parts.push(`time ${formatElapsed(elapsedSeconds)}`);
  if (queuedCount > 0 && segments.queue) parts.push(`q ${queuedCount}`);
  if (costHint && segments.cost) parts.push(`cost ${costHint}`);
  if (segments.hints) parts.push('/help', '@file');
  if (segments.hotkeys) parts.push('/hotkeys');

  const left = `  ${parts.join(' · ')}`;
  if (!segments.cwd || !cwd) return clip(left, width);

  const right = formatCwd(cwd, branch);
  const minRight = width >= 96 ? Math.min(right.length, 22) : Math.min(right.length, 12);
  const minLeft = Math.min(width, Math.max(20, Math.min(left.length, width - 3 - minRight)));
  const rule = statusRuleWidths(width, right, minLeft);
  if (!rule.rightWidth) return clip(left, width);

  const leftPart = clip(left, rule.leftWidth).padEnd(rule.leftWidth);
  const rightPart = clip(right, rule.rightWidth);
  return `${leftPart}${' '.repeat(rule.separatorWidth)}${rightPart}`;
}

function shortModel(model: string): string {
  if (model.includes(':')) {
    const [provider, name] = model.split(':', 2);
    return `${provider}:${clip(name ?? '', 18)}`;
  }
  return clip(model, 24);
}

function contextSegment(tokens: number, limit: number, showBar: boolean): string {
  const safeTokens = Math.max(0, Math.floor(tokens));
  const safeLimit = Math.max(1, Math.floor(limit));
  const pct = Math.max(0, Math.min(100, Math.round((safeTokens / safeLimit) * 100)));
  if (!showBar) return `ctx ${formatTokens(safeTokens)}`;
  return `ctx ${ctxBar(pct)} ${pct}%`;
}

function ctxBar(percent: number, width = 6): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${trimNumber(tokens / 1_000_000)}m`;
  if (tokens >= 1_000) return `${trimNumber(tokens / 1_000)}k`;
  return `${tokens}`;
}

export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  if (minutes < 60) return `${minutes}m ${secs.toString().padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins.toString().padStart(2, '0')}m`;
}

function trimNumber(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
}

export function formatCwd(cwd: string, branch?: string | null): string {
  const home = process.env.HOME;
  const label = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  const parts = label.split('/').filter(Boolean);
  const shortPath =
    label.startsWith('~/') && parts.length > 2
      ? `~/${parts.slice(-2).join('/')}`
      : label.startsWith('/') && parts.length > 2
        ? `/${parts.slice(-2).join('/')}`
        : label || cwd;
  if (!branch) return shortPath;
  return `${shortPath} (${shortBranch(branch)})`;
}

function shortBranch(branch: string): string {
  const clean = branch.trim();
  if (clean.length <= 19) return clean;
  return `…${clean.slice(-18)}`;
}
