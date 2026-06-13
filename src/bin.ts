#!/usr/bin/env node
import { runAgent, type AgentEvent } from './loop.js';
import { redactKey } from './providers/keys.js';
import type { ModelMessage } from 'ai';
import { loadConfig, isFirstRun, loadKeysIntoEnv } from './config.js';
import { saveSession, latestSession, newSessionId } from './session.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

interface Args {
  model?: string;
  budget?: number;
  json: boolean;
  prompt: string;
}

function parseArgs(argv: string[]): Args {
  let model: string | undefined;
  let budget: number | undefined;
  let json = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model' || a === '-m') model = argv[++i];
    else if (a === '--budget' || a === '-b') budget = Number.parseFloat(argv[++i] ?? '');
    else if (a === '--json') json = true;
    else if (a === '-p' || a === '--print' || a === '-c' || a === '--continue') {
      /* -p headless flag · -c/--continue resume (handled in main) */
    } else rest.push(a);
  }
  return { model, budget, json, prompt: rest.join(' ').trim() };
}

async function runHeadless(
  model: string,
  prompt: string,
  budgetUsd: number | undefined,
  maxSteps: number,
  json: boolean,
  history?: ModelMessage[],
): Promise<void> {
  const controller = new AbortController();
  process.on('SIGINT', () => {
    controller.abort();
    process.exit(130);
  });
  try {
    const { cost, messages } = await runAgent({
      model,
      prompt,
      history,
      budgetUsd,
      maxSteps,
      signal: controller.signal,
      onEvent: (e: AgentEvent) => {
        if (json) {
          process.stdout.write(`${JSON.stringify(e)}\n`);
          return;
        }
        if (e.type === 'text') process.stdout.write(e.text ?? '');
        else if (e.type === 'tool-call') process.stdout.write(`\n${DIM}→ ${e.tool}${RESET}\n`);
      },
    });
    if (!json) process.stdout.write(`\n${DIM}${cost.summary()}${RESET}\n`);
    // จำ session ไว้ทำงานต่อได้ (sanook --continue "...") — แก้ concern AI ลืมว่าทำถึงไหน
    const now = new Date().toISOString();
    await saveSession({ id: newSessionId(), created: now, updated: now, model, cwd: process.cwd(), messages });
  } catch (err) {
    const msg = redactKey((err as Error).message);
    if (json) process.stdout.write(`${JSON.stringify({ type: 'error', message: msg })}\n`);
    else console.error(`\nERROR: ${msg}`);
    process.exit(1);
  }
}

const VERSION = '0.2.0';
const HELP = `Sanook — a terminal AI coding agent (BYOK)

usage:
  sanook "<task>"            run one task (headless)
  sanook                     interactive REPL
  sanook --json "<task>"     headless, JSONL output (for CI/scripts)

flags:
  -m, --model <spec>   sonnet/opus/haiku/fable · gpt/codex · gemini · grok · deepseek · mistral · groq · ollama/lmstudio
                       or "provider:model-id" (e.g. openai:gpt-5-codex, groq:fast, google:gemini-2.5-flash)
  -b, --budget <usd>   stop when estimated cost exceeds this
  -c, --continue       resume the latest session (จำว่าทำถึงไหน → ทำต่อ)
      --json           machine-readable JSONL output
  -v, --version
  -h, --help

env (BYOK — direct API key only):
  ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / OPENAI_API_KEY`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('-v') || argv.includes('--version')) {
    console.log(VERSION);
    return;
  }
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP);
    return;
  }

  // โหลด API key จาก ~/.sanook/auth.json เข้า env (ไม่ override env ที่ตั้งไว้แล้ว)
  await loadKeysIntoEnv();

  const { model, budget, json, prompt } = parseArgs(argv);
  const budgetUsd = Number.isFinite(budget) ? budget : undefined;

  if (prompt) {
    const config = await loadConfig({ model, budgetUsd });
    // --continue / -c → โหลด session ล่าสุดมาต่อ (จำว่าทำถึงไหน)
    const history =
      argv.includes('--continue') || argv.includes('-c') ? (await latestSession())?.messages : undefined;
    await runHeadless(config.model, prompt, config.budgetUsd, config.maxSteps, json, history);
    return;
  }

  // interactive — ครั้งแรก (ยังไม่มี config) → setup wizard ก่อนเข้า REPL
  if (await isFirstRun()) {
    const { startSetup } = await import('./ui/render.js');
    await startSetup();
  }
  const config = await loadConfig({ model, budgetUsd });
  const { startRepl } = await import('./ui/render.js');
  startRepl({ initialModel: config.model, budgetUsd: config.budgetUsd });
}

main().catch((err) => {
  console.error(redactKey((err as Error).message ?? String(err)));
  process.exit(1);
});
