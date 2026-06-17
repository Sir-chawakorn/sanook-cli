export interface Args {
  model?: string;
  budget?: number;
  json: boolean;
  quiet: boolean; // --output-format final / -q : print แค่คำตอบสุดท้าย (ไม่มี tool/cost chatter)
  prompt: string;
  planMode: boolean;
  yes: boolean;
  resume?: string;
}

function optionArgs(argv: string[]): string[] {
  const end = argv.indexOf('--');
  return end === -1 ? argv : argv.slice(0, end);
}

export function hasResumeRequest(argv: string[]): boolean {
  return optionArgs(argv).some((arg) => arg === '--resume' || arg === '-r' || arg.startsWith('--resume='));
}

export function hasContinueRequest(argv: string[]): boolean {
  return optionArgs(argv).some((arg) => arg === '--continue' || arg === '-c' || arg === '--continue-any');
}

export function hasContinueAnyRequest(argv: string[]): boolean {
  return optionArgs(argv).includes('--continue-any');
}

export function parseArgs(argv: string[]): Args {
  let model: string | undefined;
  let budget: number | undefined;
  let json = false;
  let quiet = false;
  let planMode = false;
  let yes = false;
  let resume: string | undefined;
  const rest: string[] = [];
  let i = 0;
  const isFlagLike = (value: string): boolean => value.startsWith('--') || /^-[A-Za-z]/.test(value);
  const inlineValue = (flag: string, value: string): string | undefined => {
    const prefix = `${flag}=`;
    if (!value.startsWith(prefix)) return undefined;
    const parsed = value.slice(prefix.length);
    return parsed === '' ? undefined : parsed;
  };
  const parseBudget = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const takeValue = (index: number): string | undefined => {
    const value = argv[index + 1];
    if (value === undefined || isFlagLike(value)) return undefined;
    i = index + 1;
    return value;
  };
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--model=')) model = inlineValue('--model', a);
    else if (a === '--model' || a === '-m') model = takeValue(i);
    else if (a.startsWith('--budget=')) {
      budget = parseBudget(inlineValue('--budget', a));
    } else if (a === '--budget' || a === '-b') {
      budget = parseBudget(takeValue(i));
    }
    else if (a === '--json') json = true;
    else if (a === '-q' || a === '--quiet') quiet = true;
    else if (a.startsWith('--output-format=') || a === '--output-format') {
      const v = a.startsWith('--output-format=') ? inlineValue('--output-format', a) : takeValue(i);
      if (v === 'json') json = true;
      else if (v === 'final' || v === 'quiet') quiet = true;
      /* 'text' = default */
    } else if (a === '--plan') planMode = true;
    else if (a === '--yes' || a === '-y' || a === '--yolo' || a === '--dangerously-skip-permissions') yes = true;
    else if (a.startsWith('--resume=')) resume = inlineValue('--resume', a);
    else if (a === '--resume' || a === '-r') resume = takeValue(i);
    else if (a === '-p' || a === '--print' || a === '-c' || a === '--continue' || a === '--continue-any') {
      /* -p headless flag · -c/--continue/--continue-any resume (handled in main) */
    } else rest.push(a);
  }
  return { model, budget, json, quiet, prompt: rest.join(' ').trim(), planMode, yes, resume };
}
