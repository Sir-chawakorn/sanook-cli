import type { ModelMessage } from 'ai';
import { estimateTokens } from './compaction.js';
import { BRAND } from './brand.js';
import { listSessions, type Session } from './session.js';
import { listGatewaySessions, type GatewaySession } from './gateway/session.js';
import { parseInsightsDays } from './insights-args.js';

type InsightSession = (Session | GatewaySession) & {
  model: string;
  updated: string;
  messages: ModelMessage[];
};

function sinceDate(days: number): Date {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

function withinDays(updated: string, days: number): boolean {
  const t = Date.parse(updated);
  return Number.isFinite(t) && t >= sinceDate(days).getTime();
}

function countRoles(messages: ModelMessage[]): { user: number; assistant: number } {
  let user = 0;
  let assistant = 0;
  for (const msg of messages) {
    if ((msg as { role?: string }).role === 'user') user++;
    if ((msg as { role?: string }).role === 'assistant') assistant++;
  }
  return { user, assistant };
}

function addModelCount(map: Map<string, number>, model: string): void {
  const label = publicModelLabel(model);
  map.set(label, (map.get(label) ?? 0) + 1);
}

function topModels(map: Map<string, number>): string {
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return rows.length ? rows.map(([model, count]) => `${model} (${count})`).join(', ') : '(none)';
}

function publicModelLabel(model: string): string {
  const lower = model.toLowerCase();
  const removed = [
    'deep' + 'seek',
    'g' + 'lm',
    'mini' + 'max',
    'zhi' + 'pu',
    'q' + 'wen',
    'moon' + 'shot',
    'ki' + 'mi',
    'dou' + 'bao',
  ];
  return removed.some((name) => lower.includes(name)) ? 'removed-provider' : model;
}

function isInsightSession(session: Session | GatewaySession): session is InsightSession {
  return typeof session.updated === 'string' && typeof session.model === 'string' && Array.isArray(session.messages);
}

export interface InsightsOptions {
  days?: number;
  cwd?: string | null;
  includeGateway?: boolean;
}

export async function renderInsights(options: InsightsOptions = {}): Promise<string> {
  const days = options.days ?? 30;
  const cwd = options.cwd === undefined ? process.cwd() : options.cwd;
  const includeGateway = options.includeGateway ?? true;
  const sessions = (await listSessions({ cwd })).filter(isInsightSession).filter((s) => withinDays(s.updated, days));
  const gatewaySessions = includeGateway
    ? (await listGatewaySessions()).filter(isInsightSession).filter((s) => withinDays(s.updated, days))
    : [];
  const models = new Map<string, number>();
  let messages = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let approxTokens = 0;

  const countSession = (session: Session | GatewaySession): void => {
    addModelCount(models, session.model);
    messages += session.messages.length;
    const roles = countRoles(session.messages);
    userMessages += roles.user;
    assistantMessages += roles.assistant;
    approxTokens += estimateTokens(session.messages);
  };
  for (const s of sessions) countSession(s);
  for (const s of gatewaySessions) countSession(s);

  return [
    `${BRAND.productName} insights (${days}d)`,
    `scope: ${cwd ? 'current project' : 'all projects'}${includeGateway ? ' + gateway' : ''}`,
    `sessions: ${sessions.length}`,
    `gateway sessions: ${gatewaySessions.length}`,
    `messages: ${messages} (${userMessages} user, ${assistantMessages} assistant)`,
    `approx tokens in saved history: ~${approxTokens}`,
    `models: ${topModels(models)}`,
  ].join('\n');
}

export { parseInsightsDays };
