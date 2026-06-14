import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// E2E integration — exercise ทุก tool + subsystem จริง (real FS/subprocess), ไม่ mock
// ยืนยันว่า "ใช้ได้จริง" ไม่ใช่แค่ typecheck ผ่าน
const WS = mkdtempSync(join(tmpdir(), 'sanook-ws-'));
const HOME = mkdtempSync(join(tmpdir(), 'sanook-home-'));
const REPO = process.cwd();
const opt = {} as never; // tool.execute options (ไม่ใช้ใน test)

beforeAll(() => {
  vi.stubEnv('HOME', HOME);
  vi.stubEnv('SANOOK_ALLOW_OUTSIDE_WORKSPACE', '1');
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(WS, { recursive: true, force: true });
  rmSync(HOME, { recursive: true, force: true });
});

describe('file tools (real workspace)', () => {
  it('write_file → read_file roundtrip', async () => {
    const { writeFileTool, readFileTool } = await import('./tools/index.js');
    const p = join(WS, 'hello.txt');
    await writeFileTool.execute!({ path: p, content: 'line1\nline2\n' }, opt);
    const out = (await readFileTool.execute!({ path: p }, opt)) as string;
    expect(out).toContain('line1');
    expect(out).toContain('line2');
  });

  it('edit_file แก้ตรงจุด', async () => {
    const { editFileTool, readFileTool } = await import('./tools/index.js');
    const p = join(WS, 'edit.txt');
    writeFileSync(p, 'foo bar baz');
    await editFileTool.execute!({ path: p, old_string: 'bar', new_string: 'QUX' }, opt);
    expect(await readFileTool.execute!({ path: p }, opt)).toContain('foo QUX baz');
  });

  it('list_dir / glob / grep หาไฟล์จริง', async () => {
    const { listDirTool, globTool, grepTool } = await import('./tools/index.js');
    mkdirSync(join(WS, 'sub'), { recursive: true });
    writeFileSync(join(WS, 'sub', 'a.ts'), 'const findme = 1;');
    const list = (await listDirTool.execute!({ path: WS }, opt)) as string;
    expect(list).toContain('sub');
    const g = (await globTool.execute!({ pattern: '**/*.ts', cwd: WS }, opt)) as string;
    expect(g).toContain('a.ts');
    const grep = (await grepTool.execute!({ pattern: 'findme', path: WS }, opt)) as string;
    expect(grep).toMatch(/findme|no matches/); // rg อาจไม่ติดตั้ง → no matches ก็ได้ (ไม่ throw)
  });

  it('run_bash รันคำสั่งจริง', async () => {
    const { bashTool } = await import('./tools/index.js');
    const out = (await bashTool.execute!({ cmd: 'echo sanook-ok' }, opt)) as string;
    expect(out).toContain('sanook-ok');
  });

  it('run_bash บล็อกคำสั่ง destructive', async () => {
    const { bashTool } = await import('./tools/index.js');
    const out = (await bashTool.execute!({ cmd: 'rm -rf /' }, opt)) as string;
    expect(out.toLowerCase()).toMatch(/block|ปฏิเสธ|destructive|อันตราย|ไม่อนุญาต/);
  });

  it('grep command injection ไม่รัน ($() inert)', async () => {
    const { grepTool } = await import('./tools/index.js');
    const marker = join(WS, 'INJECTED');
    await grepTool.execute!({ pattern: `$(touch ${marker})`, path: WS }, opt);
    const { existsSync } = await import('node:fs');
    expect(existsSync(marker)).toBe(false);
  });
});

describe('memory + knowledge (real, temp HOME)', () => {
  it('remember → recall ข้าม store', async () => {
    const { rememberTool } = await import('./tools/remember.js');
    const { recallTool } = await import('./tools/recall.js');
    await rememberTool.execute!({ fact: 'Pick deploys with vercel not netlify' }, opt);
    const out = (await recallTool.execute!({ query: 'vercel deploy' }, opt)) as string;
    expect(out).toContain('vercel');
  });
});

describe('skills (bundled + create + find)', () => {
  it('โหลด bundled skills + find_skills จัดอันดับถูก', async () => {
    const { loadSkills } = await import('./skills.js');
    const { findSkillsTool } = await import('./tools/skill.js');
    expect((await loadSkills()).length).toBeGreaterThanOrEqual(13);
    const out = (await findSkillsTool.execute!({ query: 'review code before done' }, opt)) as string;
    expect(out).toContain('code-review');
  });

  it('create_skill → getSkillBody roundtrip', async () => {
    const { createSkillTool, skillTool } = await import('./tools/skill.js');
    await createSkillTool.execute!({ name: 'my-test-skill', description: 'x', body: '## Steps\n1. y' }, opt);
    expect(await skillTool.execute!({ name: 'my-test-skill' }, opt)).toContain('## Steps');
  });

  it('skill install จาก local dir', async () => {
    const { installSkill } = await import('./skill-install.js');
    const src = join(WS, 'ext-skill');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'SKILL.md'), '---\nname: ext-skill\ndescription: external\n---\n\n## Steps\n1. z');
    const res = await installSkill(WS);
    expect(res.some((r) => r.name === 'ext-skill')).toBe(true);
  });
});

describe('session store (resume)', () => {
  it('save → latest → load', async () => {
    const { saveSession, latestSession, newSessionId } = await import('./session.js');
    const id = newSessionId();
    await saveSession({
      id,
      created: '2026-06-14T00:00:00Z',
      updated: '2026-06-14T00:00:05Z',
      model: 'sonnet',
      cwd: WS,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const latest = await latestSession(WS);
    expect(latest?.id).toBe(id);
    expect(latest?.messages.length).toBe(1);
  });
});

describe('gateway (ledger + schedule_task tool)', () => {
  it('schedule_task → list_scheduled → cancel', async () => {
    const { scheduleTaskTool, listScheduledTool, cancelScheduledTool } = await import('./tools/schedule.js');
    const added = (await scheduleTaskTool.execute!({ when: 'ทุกวัน 9:00', task: 'สรุปข่าว' }, opt)) as string;
    expect(added).toContain('ตั้งงาน');
    const list = (await listScheduledTool.execute!({}, opt)) as string;
    expect(list).toContain('สรุปข่าว');
    const id = list.split(/\s/)[0];
    expect(await cancelScheduledTool.execute!({ id }, opt)).toContain('ยกเลิก');
  });
});

describe('providers (registry, no key needed)', () => {
  it('parseSpec aliases + provider:model', async () => {
    const { parseSpec, specKey } = await import('./providers/registry.js');
    expect(parseSpec('sonnet').provider).toBe('anthropic');
    expect(parseSpec('openai:gpt-5.5')).toMatchObject({ provider: 'openai', model: 'gpt-5.5' });
    expect(specKey('sonnet')).toContain('anthropic:');
  });
  it('resolveModel ไม่มี key → error ชัด (ไม่ crash เงียบ)', async () => {
    const { resolveModel } = await import('./providers/registry.js');
    expect(() => resolveModel('anthropic:claude-opus-4-8')).toThrow(/ANTHROPIC_API_KEY|key/i);
  });
});

describe('agent loop (mock model — proves loop+tool ทำงานโดยไม่ต้อง key)', () => {
  it('streamText + tools registry + mock model → tool ถูกเรียก + ได้ result', async () => {
    const { MockLanguageModelV3 } = await import('ai/test');
    const { streamText, stepCountIs } = await import('ai');
    const { tools } = await import('./tools/index.js');
    const probe = join(WS, 'agent-wrote.txt');

    let step = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        step++;
        if (step === 1) {
          // step 1: เรียก write_file
          return {
            stream: arrayStream([
              { type: 'tool-call', toolCallId: 't1', toolName: 'write_file', input: JSON.stringify({ path: probe, content: 'agent did this' }) },
              { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } },
            ]),
          };
        }
        // step 2: ตอบ text
        return {
          stream: arrayStream([
            { type: 'text-start', id: 'x' },
            { type: 'text-delta', id: 'x', delta: 'done writing' },
            { type: 'text-end', id: 'x' },
            { type: 'finish', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } },
          ]),
        };
      },
    });

    const res = streamText({ model, tools, messages: [{ role: 'user', content: 'write a file' }], stopWhen: stepCountIs(5) });
    let text = '';
    for await (const part of res.fullStream) {
      if (part.type === 'text-delta') text += part.text;
    }
    const { existsSync, readFileSync } = await import('node:fs');
    expect(existsSync(probe)).toBe(true); // tool ทำงานจริงใน loop
    expect(readFileSync(probe, 'utf8')).toBe('agent did this');
    expect(text).toContain('done writing'); // loop ดำเนินต่อหลัง tool → ได้ text
  });
});

describe('cost + compaction + git + hooks', () => {
  it('CostMeter นับ token → summary', async () => {
    const { CostMeter } = await import('./cost.js');
    const m = new CostMeter('anthropic:claude-sonnet-4-6');
    m.add({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 } as never, 0);
    expect(m.summary()).toMatch(/tok|\$|1500|1[,.]?000/i);
  });

  it('gitContext ใน repo จริง → branch', async () => {
    const { gitContext } = await import('./git.js');
    const ctx = await gitContext(REPO);
    expect(ctx).toContain('branch:');
  });

  it('hooks no-config → passthrough (zero overhead)', async () => {
    const { maybeWrapHooks } = await import('./hooks.js');
    const fake = { x: { execute: async () => 'ok' } } as never;
    expect(await maybeWrapHooks(fake)).toBe(fake);
  });

  it('project hooks fail closed until the project is trusted', async () => {
    mkdirSync(join(WS, '.sanook'), { recursive: true });
    writeFileSync(
      join(WS, '.sanook', 'hooks.json'),
      JSON.stringify({ PreToolUse: [{ matcher: 'x', command: 'node -e "process.exit(7)"' }] }),
    );

    const { maybeWrapHooks } = await import('./hooks.js');
    const fake = { x: { execute: async () => 'ok' } } as never;
    expect(await maybeWrapHooks(fake, WS)).toBe(fake);

    const { trustProject } = await import('./trust.js');
    await trustProject(WS);
    const wrapped = (await maybeWrapHooks(fake, WS)) as unknown as { x: { execute: (input: unknown, opts: unknown) => Promise<string> } };
    expect(await wrapped.x.execute({}, opt)).toMatch(/block|hook/i);
  });

  it('project MCP config is ignored until that project is trusted', async () => {
    const project = join(WS, 'mcp-project');
    mkdirSync(join(project, '.sanook'), { recursive: true });
    writeFileSync(join(project, 'package.json'), '{}');
    writeFileSync(
      join(project, '.sanook', 'mcp.json'),
      JSON.stringify({ mcpServers: { local: { command: 'node', args: ['server.js'] } } }),
    );

    const logs: string[] = [];
    const { loadMcpConfig } = await import('./mcp.js');
    expect(await loadMcpConfig((m) => logs.push(m), project)).toEqual({});
    expect(logs.join('\n')).toMatch(/ข้าม|trust/);

    const { trustProject } = await import('./trust.js');
    await trustProject(project);
    expect(await loadMcpConfig(undefined, project)).toHaveProperty('local.command', 'node');
  });
});

describe('gateway HTTP (spawn server จริง)', () => {
  it('startGateway → /health public + /tasks 401 + token-gated', async () => {
    const { startGateway } = await import('./gateway/serve.js');
    const { readFileSync } = await import('node:fs');
    const stop = await startGateway({ port: 8911, model: 'sonnet', onLog: () => {} });
    try {
      await new Promise((r) => setTimeout(r, 250));
      const health = (await fetch('http://127.0.0.1:8911/health').then((r) => r.json())) as { ok: boolean };
      expect(health.ok).toBe(true);
      const noToken = await fetch('http://127.0.0.1:8911/tasks');
      expect(noToken.status).toBe(401);
      const token = readFileSync(join(HOME, '.sanook', 'gateway', 'token'), 'utf8').trim();
      const withToken = await fetch('http://127.0.0.1:8911/tasks', { headers: { authorization: `Bearer ${token}` } });
      expect(withToken.status).toBe(200);
    } finally {
      stop();
    }
  });
});

// helper: array → readable stream (สำหรับ mock doStream)
function arrayStream(parts: unknown[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
}
