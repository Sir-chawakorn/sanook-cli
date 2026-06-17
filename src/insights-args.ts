export interface ParsedInsightsArgs {
  days: number;
  all: boolean;
}

function parsePositiveInteger(raw: string | undefined): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const days = Number(raw);
  return Number.isSafeInteger(days) ? days : null;
}

export function parseInsightsDays(args: string | readonly string[]): number | null {
  const parts = typeof args === 'string' ? args.trim().split(/\s+/).filter(Boolean) : [...args];
  if (!parts.length) return 30;
  let raw: string | undefined;
  if (parts[0] === '--days' || parts[0] === '-d') {
    if (parts.length !== 2) return null;
    raw = parts[1];
  } else if (parts[0].startsWith('--days=') || parts[0].startsWith('-d=')) {
    if (parts.length !== 1) return null;
    raw = parts[0].slice(parts[0].indexOf('=') + 1);
  } else {
    if (parts.length !== 1) return null;
    raw = parts[0];
  }
  return parsePositiveInteger(raw);
}

export function parseInsightsArgs(args: string | readonly string[]): ParsedInsightsArgs | null {
  const parts = typeof args === 'string' ? args.trim().split(/\s+/).filter(Boolean) : [...args];
  const all = parts.includes('--all') || parts.includes('-a');
  const dayParts = parts.filter((arg) => arg !== '--all' && arg !== '-a');
  const days = parseInsightsDays(dayParts);
  return days === null ? null : { days, all };
}
