import { readFile, writeFile } from 'node:fs/promises';
import type { ModelMessage } from 'ai';
import { BRAND, persistenceEnabled } from './brand.js';
import { createBrainNote } from './brain-new.js';
import { getBrainPath } from './memory.js';
import { PROVIDERS, parseSpec } from './providers/registry.js';
import { makeSummarizer } from './summarize.js';
import { distilledFactsFromMessages } from './session-distill.js';
import { autoDistillToMemory } from './auto-maintain.js';
import { saveSession, type Session } from './session.js';

export interface ReplTurn {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export interface FinalizeReplSessionOptions {
  sessionId: string;
  sessionCreated: string;
  model: string;
  cwd: string;
  messages: ModelMessage[];
  history: ReplTurn[];
}

export interface FinalizeReplSessionResult {
  sessionSaved: boolean;
  brainNoteRel?: string;
  brainNotePath?: string;
}

function transcriptFromTurns(turns: ReplTurn[]): string {
  return turns
    .filter((t) => t.role === 'user' || t.role === 'assistant')
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text.trim()}`)
    .filter((line) => line.length > 8)
    .join('\n\n');
}

function sessionTitleFromHistory(history: ReplTurn[]): string {
  const firstUser = history.find((t) => t.role === 'user')?.text.trim();
  if (!firstUser) return 'repl session';
  const cleaned = firstUser.replace(/^\/\w+\s*/, '').trim();
  return cleaned.split(/\s+/).slice(0, 8).join(' ').slice(0, 72) || 'repl session';
}

function injectSessionSummary(template: string, summary: string, facts: string[]): string {
  const summaryBlock = [summary.trim(), facts.length ? `\n### Key facts\n${facts.map((f) => `- ${f}`).join('\n')}` : '']
    .filter(Boolean)
    .join('\n');
  if (/^## Summary\s*$/m.test(template)) {
    // replacer function so `$`-sequences in the AI summary/facts aren't interpreted as replace patterns
    return template.replace(/^## Summary\s*$/m, () => `## Summary\n\n${summaryBlock}`);
  }
  return `${template.trimEnd()}\n\n## Summary\n\n${summaryBlock}\n`;
}

async function summarizeSession(model: string, transcript: string, messages: ModelMessage[]): Promise<string> {
  const provider = parseSpec(model).provider;
  if (PROVIDERS[provider]?.kind !== 'delegate' && transcript.trim().length > 40) {
    try {
      const text = await makeSummarizer(model)(transcript);
      if (text.trim()) return text.trim();
    } catch {
      // fall through to heuristic distill
    }
  }
  const facts = distilledFactsFromMessages(messages);
  if (facts.length) return facts.map((f) => `- ${f}`).join('\n');
  const lines = transcript.split('\n\n').slice(-6);
  return lines.length ? lines.join('\n\n') : 'Session ended with no durable transcript.';
}

/** Persist REPL session + write a Sessions/ note in the configured second-brain vault. */
export async function finalizeReplSession(options: FinalizeReplSessionOptions): Promise<FinalizeReplSessionResult> {
  const hasConversation =
    options.messages.length > 0 || options.history.some((t) => t.role === 'user' || t.role === 'assistant');
  if (!hasConversation || !persistenceEnabled()) {
    return { sessionSaved: false };
  }

  const now = new Date().toISOString();
  const session: Session = {
    id: options.sessionId,
    title: sessionTitleFromHistory(options.history),
    created: options.sessionCreated,
    updated: now,
    model: options.model,
    cwd: options.cwd,
    messages: options.messages,
  };
  await saveSession(session);

  // Compound durable facts even when no second-brain vault is configured.
  await autoDistillToMemory(options.messages);

  const brainPath = await getBrainPath();
  if (!brainPath) return { sessionSaved: true };

  const transcript = transcriptFromTurns(options.history);
  const summary = await summarizeSession(options.model, transcript, options.messages);
  const title = sessionTitleFromHistory(options.history);
  const slugSuffix = options.sessionId.slice(-6);
  const today = now.slice(0, 10);
  const output = `Sessions/${today}-${slugSuffix}-session.md`;

  const report = await createBrainNote({
    brainPath,
    type: 'session',
    title,
    output,
    force: true,
    today,
  });
  if (!report.ok || !report.path) return { sessionSaved: true };

  const facts = distilledFactsFromMessages(options.messages);
  const raw = await readFile(report.path, 'utf8');
  const next = injectSessionSummary(raw, summary, facts.slice(0, 8));
  await writeFile(report.path, next, 'utf8');

  return {
    sessionSaved: true,
    brainNoteRel: report.relPath,
    brainNotePath: report.path,
  };
}

export function formatFinalizeMessage(result: FinalizeReplSessionResult): string | undefined {
  if (!result.sessionSaved) return undefined;
  if (result.brainNoteRel) {
    return `${BRAND.cliName}: session saved · second-brain → [[${result.brainNoteRel.replace(/\.md$/i, '')}]]`;
  }
  return `${BRAND.cliName}: session saved`;
}
