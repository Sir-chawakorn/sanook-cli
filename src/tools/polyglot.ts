import { tool } from 'ai';
import { z } from 'zod';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBinary } from '../lsp/servers.js';
import { runProcess, formatProcessResult } from '../process-runner.js';
import { agentCwd } from '../agentContext.js';
import { checkReadPath } from './permission.js';
import { resolveAgentPath } from './util.js';

const MAX_TIMEOUT_MS = 300_000;

const RuntimeScriptSchema = z
  .object({
    code: z.string().optional().describe('source code to run as a temporary script'),
    path: z.string().optional().describe('existing script/source file to run instead of code'),
    args: z.array(z.string()).optional().describe('argv passed to the script/program'),
    stdin: z.string().optional().describe('stdin content for the process'),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional().describe('timeout in ms (default 120000, max 300000)'),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.path), 'provide exactly one of code or path');

type RuntimeScriptInput = z.infer<typeof RuntimeScriptSchema>;

async function existingSourcePath(path: string): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const full = resolveAgentPath(path);
  const guard = await checkReadPath(full);
  if (!guard.ok) return { ok: false, reason: guard.reason };
  return { ok: true, path: full };
}

async function tempSource(suffix: string, content: string): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'sanook-polyglot-'));
  const path = join(dir, `main${suffix}`);
  await writeFile(path, content, 'utf8');
  return { dir, path };
}

async function findRuntime(command: string): Promise<string | null> {
  const bin = await findBinary(command, agentCwd());
  return bin ?? findBinary(command, process.cwd()) ?? null;
}

async function runPython(input: RuntimeScriptInput): Promise<string> {
  const cwd = agentCwd();
  const python = (await findRuntime('python3')) ?? (await findRuntime('python'));
  if (!python) return 'PYTHON: ยังไม่พบ python3/python — ติดตั้ง Python 3.11+ แล้วลองใหม่';

  let tempDir: string | undefined;
  let scriptPath: string;
  try {
    if (input.path) {
      const source = await existingSourcePath(input.path);
      if (!source.ok) return `BLOCKED: ${source.reason}`;
      scriptPath = source.path;
    } else {
      const temp = await tempSource('.py', input.code ?? '');
      tempDir = temp.dir;
      scriptPath = temp.path;
    }
    const result = await runProcess(python, [scriptPath, ...(input.args ?? [])], {
      cwd,
      input: input.stdin,
      timeoutMs: input.timeoutMs,
    });
    return formatProcessResult(result);
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runRust(input: RuntimeScriptInput): Promise<string> {
  const cwd = agentCwd();
  const rustc = await findRuntime('rustc');
  if (!rustc) return 'RUST: ยังไม่พบ rustc — ติดตั้ง Rust ผ่าน rustup แล้วลองใหม่';

  let tempDir: string | undefined;
  try {
    const temp = await mkdtemp(join(tmpdir(), 'sanook-rust-'));
    tempDir = temp;
    const sourcePath = input.path
      ? await (async () => {
          const source = await existingSourcePath(input.path!);
          if (!source.ok) return source;
          return { ok: true as const, path: source.path };
        })()
      : { ok: true as const, path: join(temp, 'main.rs') };
    if (!sourcePath.ok) return `BLOCKED: ${sourcePath.reason}`;
    if (!input.path) await writeFile(sourcePath.path, input.code ?? '', 'utf8');

    const exe = join(temp, process.platform === 'win32' ? 'sanook-rust-helper.exe' : 'sanook-rust-helper');
    const compile = await runProcess(rustc, ['--edition=2021', sourcePath.path, '-o', exe], {
      cwd,
      timeoutMs: input.timeoutMs,
    });
    if (!compile.ok) return `RUST COMPILE ${formatProcessResult(compile)}`;

    const run = await runProcess(exe, input.args ?? [], {
      cwd,
      input: input.stdin,
      timeoutMs: input.timeoutMs,
    });
    return formatProcessResult(run);
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export const pythonTool = tool({
  description:
    'รัน Python แบบ no-shell สำหรับงานที่ Python ถนัด: data/JSON/CSV transform, document/text parsing, ML/OCR helper, research script. ' +
    'ใช้ code สำหรับ snippet สั้น หรือ path สำหรับไฟล์ .py ใน workspace. ต้องมี python3/python ใน PATH.',
  inputSchema: RuntimeScriptSchema,
  execute: runPython,
});

export const rustTool = tool({
  description:
    'compile+run Rust single-file/snippet แบบ no-shell สำหรับงานที่ Rust ถนัด: parser/checker ที่เร็ว, algorithm ที่ต้อง type-safe, native helper prototype. ' +
    'ใช้ code สำหรับ main.rs ชั่วคราว หรือ path สำหรับไฟล์ .rs เดี่ยวใน workspace. ต้องมี rustc ใน PATH; งาน Cargo project ให้ใช้ run_bash ตามปกติ.',
  inputSchema: RuntimeScriptSchema,
  execute: runRust,
});

export const runtimeScriptSchema = RuntimeScriptSchema;
