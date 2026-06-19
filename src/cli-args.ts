import { inlineValue, takeValue } from './cli-option-values.js';

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

export interface ParsedServeArgs {
  port: number;
  model?: string;
  portError?: string;
  modelError?: string;
}

const DECIMAL_BUDGET_RE = /^\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const POSITIVE_INTEGER_RE = /^\d+$/;

export function parseBudgetUsd(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!DECIMAL_BUDGET_RE.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseThinkingConfigValue(value: string): boolean | number | undefined {
  const normalized = value.trim();
  const flag = normalized.toLowerCase();
  if (flag === 'on' || flag === 'true' || flag === 'yes') return true;
  if (flag === 'off' || flag === 'false' || flag === 'no') return false;
  if (!POSITIVE_INTEGER_RE.test(normalized)) return undefined;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
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

export function hasServeCommandRequest(argv: string[]): boolean {
  if (argv[0] !== 'serve') return false;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') return false;
    if (arg === '--port' || arg === '--model' || arg === '-m') {
      i = takeValue(argv, i).nextIndex;
      continue;
    }
    if (arg.startsWith('--port=') || arg.startsWith('--model=')) continue;
    return false;
  }

  return true;
}

function parsePortValue(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

function portErrorValue(raw: string | undefined): string {
  return raw === undefined || raw === '' ? 'ต้องระบุค่า' : raw;
}

function modelErrorValue(raw: string | undefined): string | undefined {
  return cleanModelValue(raw) ? undefined : 'ต้องระบุค่า';
}

function cleanModelValue(raw: string | undefined): string | undefined {
  const clean = raw?.trim();
  return clean ? clean : undefined;
}

export function parseServeArgs(argv: string[]): ParsedServeArgs {
  let port = 8787;
  let model: string | undefined;
  let portError: string | undefined;
  let modelError: string | undefined;
  let portSet = false;
  let modelSet = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a.startsWith('--port=')) {
      const next = a === '--port' ? takeValue(argv, i) : undefined;
      const raw = next ? next.value : inlineValue('--port', a);
      if (next) i = next.nextIndex;
      const parsed = parsePortValue(raw);
      if (parsed === undefined) portError = portErrorValue(raw);
      else if (portSet) portError = 'ใช้ --port เพียงครั้งเดียว';
      else {
        port = parsed;
        portSet = true;
      }
    } else if (a === '--model' || a === '-m' || a.startsWith('--model=')) {
      if (a.startsWith('--model=')) {
        const raw = inlineValue('--model', a);
        const clean = cleanModelValue(raw);
        const error = modelErrorValue(raw);
        if (error) modelError = error;
        else if (modelSet) modelError = 'ใช้ --model เพียงครั้งเดียว';
        else {
          model = clean;
          modelSet = true;
        }
      } else {
        const next = takeValue(argv, i);
        const clean = cleanModelValue(next.value);
        const error = modelErrorValue(next.value);
        if (error) modelError = error;
        else if (modelSet) modelError = 'ใช้ --model เพียงครั้งเดียว';
        else {
          model = clean;
          modelSet = true;
        }
        i = next.nextIndex;
      }
    }
  }

  return { port, model, portError, modelError };
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
  const takeArgValue = (index: number): string | undefined => {
    const next = takeValue(argv, index);
    i = next.nextIndex;
    return next.value;
  };
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--model=')) model = cleanModelValue(inlineValue('--model', a));
    else if (a === '--model' || a === '-m') model = cleanModelValue(takeArgValue(i));
    else if (a.startsWith('--budget=')) {
      budget = parseBudgetUsd(inlineValue('--budget', a));
    } else if (a === '--budget' || a === '-b') {
      budget = parseBudgetUsd(takeArgValue(i));
    }
    else if (a === '--json') json = true;
    else if (a === '-q' || a === '--quiet') quiet = true;
    else if (a.startsWith('--output-format=') || a === '--output-format') {
      const v = a.startsWith('--output-format=') ? inlineValue('--output-format', a) : takeArgValue(i);
      if (v === 'json') json = true;
      else if (v === 'final' || v === 'quiet') quiet = true;
      /* 'text' = default */
    } else if (a === '--plan') planMode = true;
    else if (a === '--yes' || a === '-y' || a === '--yolo' || a === '--dangerously-skip-permissions') yes = true;
    else if (a.startsWith('--resume=')) resume = inlineValue('--resume', a);
    else if (a === '--resume' || a === '-r') resume = takeArgValue(i);
    else if (a === '-p' || a === '--print' || a === '-c' || a === '--continue' || a === '--continue-any') {
      /* -p headless flag · -c/--continue/--continue-any resume (handled in main) */
    } else rest.push(a);
  }
  return { model, budget, json, quiet, prompt: rest.join(' ').trim(), planMode, yes, resume };
}
