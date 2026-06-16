export interface Args {
  model?: string;
  budget?: number;
  json: boolean;
  quiet: boolean; // --output-format final / -q : print แค่คำตอบสุดท้าย (ไม่มี tool/cost chatter)
  prompt: string;
  planMode: boolean;
  yes: boolean;
}

export function parseArgs(argv: string[]): Args {
  let model: string | undefined;
  let budget: number | undefined;
  let json = false;
  let quiet = false;
  let planMode = false;
  let yes = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model' || a === '-m') model = argv[++i];
    else if (a === '--budget' || a === '-b') budget = Number.parseFloat(argv[++i] ?? '');
    else if (a === '--json') json = true;
    else if (a === '-q' || a === '--quiet') quiet = true;
    else if (a === '--output-format') {
      const v = argv[++i];
      if (v === 'json') json = true;
      else if (v === 'final' || v === 'quiet') quiet = true;
      /* 'text' = default */
    } else if (a === '--plan') planMode = true;
    else if (a === '--yes' || a === '-y') yes = true;
    else if (a === '-p' || a === '--print' || a === '-c' || a === '--continue' || a === '--continue-any') {
      /* -p headless flag · -c/--continue/--continue-any resume (handled in main) */
    } else rest.push(a);
  }
  return { model, budget, json, quiet, prompt: rest.join(' ').trim(), planMode, yes };
}
