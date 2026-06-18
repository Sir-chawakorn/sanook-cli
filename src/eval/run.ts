// Eval runner (opt-in — ต้องมี API key). รันแต่ละ task ใน temp workspace
// แล้วเช็ค outcome จริง (ไฟล์ถูกสร้าง/แก้ถูก). ใช้วัด core capability + กัน regression.
//   ANTHROPIC_API_KEY=... npm run eval
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tasks } from './tasks.js';
import { runAgent } from '../loop.js';

export function evalModelFromEnv(env: { SANOOK_MODEL?: string } = process.env): string {
  const model = env.SANOOK_MODEL?.trim();
  return model || 'sonnet';
}

async function main(): Promise<void> {
  const model = evalModelFromEnv();
  const orig = process.cwd();
  let passed = 0;

  for (const task of tasks) {
    const dir = await mkdtemp(join(tmpdir(), `sanook-eval-${task.id}-`));
    try {
      await task.setup(dir);
      process.chdir(dir); // ให้ tool ทำงานใน workspace ของ task
      await runAgent({ model, prompt: task.prompt, maxSteps: 15 });
      process.chdir(orig);
      const ok = await task.check(dir);
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${task.id}`);
      if (ok) passed++;
    } catch (err) {
      process.chdir(orig);
      console.log(`ERROR ${task.id}: ${(err as Error).message}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  console.log(`\n${passed}/${tasks.length} passed`);
  process.exit(passed === tasks.length ? 0 : 1);
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isDirectRun()) void main();
