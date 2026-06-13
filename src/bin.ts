#!/usr/bin/env node
import { runAgent } from './loop.js';
import { redactKey } from './providers/keys.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

interface Args {
  model: string;
  budget?: number;
  prompt: string;
}

function parseArgs(argv: string[]): Args {
  let model = process.env.SANOOK_MODEL ?? 'sonnet';
  let budget: number | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model' || a === '-m') model = argv[++i] ?? model;
    else if (a === '--budget' || a === '-b') budget = Number.parseFloat(argv[++i] ?? '');
    else rest.push(a);
  }
  return { model, budget, prompt: rest.join(' ').trim() };
}

async function main(): Promise<void> {
  const { model, budget, prompt } = parseArgs(process.argv.slice(2));
  if (!prompt) {
    console.error('usage: sanook [--model <spec>] [--budget <usd>] "<task>"');
    console.error('  model: sonnet | opus | haiku | "openai:gpt-5" | "google:gemini-2.5-pro" | "ollama:llama3"');
    process.exit(1);
  }

  const controller = new AbortController();
  process.on('SIGINT', () => {
    controller.abort();
    process.stdout.write('\n[ยกเลิก]\n');
    process.exit(130);
  });

  try {
    const { cost } = await runAgent({
      model,
      prompt,
      budgetUsd: Number.isFinite(budget) ? budget : undefined,
      signal: controller.signal,
      onEvent: (e) => {
        switch (e.type) {
          case 'text':
            process.stdout.write(e.text ?? '');
            break;
          case 'tool-call':
            process.stdout.write(`\n${DIM}→ ${e.tool}(${JSON.stringify(e.detail)})${RESET}\n`);
            break;
          case 'tool-result':
            process.stdout.write(`${DIM}✓ ${e.tool}${RESET}\n`);
            break;
          case 'error':
            process.stderr.write(`\n[error] ${JSON.stringify(e.detail)}\n`);
            break;
        }
      },
    });
    process.stdout.write(`\n${DIM}${cost.summary()}${RESET}\n`);
    if (cost.overBudget) {
      process.stderr.write(`${DIM}⚠ หยุดเพราะชน budget cap${RESET}\n`);
    }
  } catch (err) {
    // redact key เผื่อหลุดมาใน error message
    console.error(`\nERROR: ${redactKey((err as Error).message)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(redactKey((err as Error).message ?? String(err)));
  process.exit(1);
});
