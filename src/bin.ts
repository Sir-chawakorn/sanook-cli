#!/usr/bin/env node
import { runAgent, type AgentEvent } from './loop.js';
import { redactKey } from './providers/keys.js';
import { loadConfig } from './config.js';

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
    else if (a === '-p' || a === '--print') {
      /* explicit headless flag — prompt ตามมาเป็น positional */
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
): Promise<void> {
  const controller = new AbortController();
  process.on('SIGINT', () => {
    controller.abort();
    process.exit(130);
  });
  try {
    const { cost } = await runAgent({
      model,
      prompt,
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
  } catch (err) {
    const msg = redactKey((err as Error).message);
    if (json) process.stdout.write(`${JSON.stringify({ type: 'error', message: msg })}\n`);
    else console.error(`\nERROR: ${msg}`);
    process.exit(1);
  }
}

const VERSION = '0.1.0';
const HELP = `Sanook — a terminal AI coding agent (BYOK)

usage:
  sanook "<task>"            run one task (headless)
  sanook                     interactive REPL
  sanook --json "<task>"     headless, JSONL output (for CI/scripts)

flags:
  -m, --model <spec>   sonnet/opus/haiku/fable · gpt/codex · gemini · grok · deepseek · mistral · groq · ollama/lmstudio
                       or "provider:model-id" (e.g. openai:gpt-5-codex, groq:fast, google:gemini-2.5-flash)
  -b, --budget <usd>   stop when estimated cost exceeds this
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

  const { model, budget, json, prompt } = parseArgs(argv);
  const config = await loadConfig({
    model,
    budgetUsd: Number.isFinite(budget) ? budget : undefined,
  });

  if (prompt) {
    await runHeadless(config.model, prompt, config.budgetUsd, config.maxSteps, json);
  } else {
    // ไม่มี prompt → interactive REPL (Ink)
    const { startRepl } = await import('./ui/render.js');
    startRepl({ initialModel: config.model, budgetUsd: config.budgetUsd });
  }
}

main().catch((err) => {
  console.error(redactKey((err as Error).message ?? String(err)));
  process.exit(1);
});
