// ============================================================================
// src/summarize.ts — cheap-model transcript summarizer for compaction.
//
// compaction='summarize' replaces the dropped middle of a long conversation with
// a condensed brief instead of truncating it — better recall at the same token
// budget. The summary runs on a CHEAP model (the fast sibling of the main model,
// same provider/key) so the saving isn't eaten by the summarization call itself.
// resolveModel() is called lazily inside the returned fn, so a missing key throws
// at summarize-time and summarizeCompact() catches it → falls back to truncation.
// ============================================================================
import { generateText } from 'ai';
import { resolveModel, fastSibling } from './providers/registry.js';

const SUMMARY_PROMPT =
  'You are compacting a coding-session transcript so the agent can CONTINUE the work with less context. ' +
  'Write a terse factual brief (bullet points, no preamble) that preserves: the task/intent, decisions made, ' +
  'files created or changed, key findings, and unfinished TODOs. Drop chit-chat and verbose tool output.\n\nTRANSCRIPT:\n';

/**
 * Build a summarizer using a cheap model — `summaryModel` if set, else the fast
 * sibling of `mainModel` (same provider, cheaper tier). Returns a fn ready for
 * compaction.summarizeCompact().
 */
export function makeSummarizer(mainModel: string, summaryModel?: string): (transcript: string) => Promise<string> {
  const spec = summaryModel ?? fastSibling(mainModel);
  return async (transcript: string): Promise<string> => {
    const { text } = await generateText({
      model: resolveModel(spec), // lazy: throws here if no key → caller falls back to truncation
      prompt: SUMMARY_PROMPT + transcript,
      maxOutputTokens: 1024,
    });
    return text;
  };
}
