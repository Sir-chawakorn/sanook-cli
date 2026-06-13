#!/usr/bin/env node
import { runAgent } from './loop.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

async function main(): Promise<void> {
  const prompt = process.argv.slice(2).join(' ').trim();
  if (!prompt) {
    console.error('usage: sanook "<your task>"');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ต้องตั้ง ANTHROPIC_API_KEY ก่อน (BYOK)');
    console.error('  export ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
  }
  const model = process.env.SANOOK_MODEL ?? 'claude-sonnet-4-6';

  const controller = new AbortController();
  process.on('SIGINT', () => {
    controller.abort();
    process.stdout.write('\n[ยกเลิก]\n');
    process.exit(130);
  });

  await runAgent({
    model,
    apiKey,
    prompt,
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

  process.stdout.write('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
