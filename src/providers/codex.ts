import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Codex delegate provider — spawn official `codex exec` (ChatGPT plan quota)
// ToS-safe: ปิ๊ก `codex login` ผ่าน official binary เอง, Sanook แค่เรียก binary นั้น
// (ไม่ reuse/impersonate OAuth token, ไม่ reverse-engineer — เป็น official client จริง)
// ─────────────────────────────────────────────────────────────────────────────

export interface CodexStatus {
  installed: boolean;
  loggedIn: boolean;
  reason?: string;
}

/** เช็กว่า codex CLI ติดตั้ง + login ChatGPT แล้ว */
export async function detectCodex(): Promise<CodexStatus> {
  const hasBinary = await new Promise<boolean>((resolve) => {
    const p = spawn('codex', ['--version']);
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
  if (!hasBinary) {
    return { installed: false, loggedIn: false, reason: 'ไม่พบ codex CLI — ติดตั้ง: npm i -g @openai/codex' };
  }
  try {
    const auth = JSON.parse(await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8')) as {
      auth_mode?: string;
      tokens?: { access_token?: string };
    };
    const loggedIn = auth?.auth_mode === 'chatgpt' || Boolean(auth?.tokens?.access_token);
    return { installed: true, loggedIn, reason: loggedIn ? undefined : 'ยังไม่ได้ login — รัน: codex login' };
  } catch {
    return { installed: true, loggedIn: false, reason: 'ยังไม่ได้ login — รัน: codex login' };
  }
}

export interface CodexEvent {
  type: 'text' | 'usage' | 'thread';
  text?: string;
  threadId?: string;
  usage?: unknown;
}

export interface RunCodexOptions {
  prompt: string;
  model?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  resumeThreadId?: string;
  onEvent?: (e: CodexEvent) => void;
  signal?: AbortSignal;
}

/**
 * รัน `codex exec` แบบ non-interactive — ส่ง prompt ทาง stdin, parse JSONL events
 * tolerant ต่อ malformed JSONL (codex bug #15451: --json ถูก ignore เมื่อมี tools active)
 */
export async function runCodex(opts: RunCodexOptions): Promise<{ text: string; threadId?: string }> {
  const args = ['exec', '--skip-git-repo-check', '--sandbox', opts.sandbox ?? 'read-only', '--json'];
  if (opts.model) args.push('-m', opts.model);
  if (opts.resumeThreadId) args.push('resume', opts.resumeThreadId);
  args.push('-'); // prompt via stdin

  return new Promise((resolve, reject) => {
    // OPENAI_API_KEY='' กัน BYOK key ของ Sanook ไป override ChatGPT login ของ codex
    const env = { ...process.env, OPENAI_API_KEY: '' };
    const p = spawn('codex', args, { env });

    let finalText = '';
    let threadId: string | undefined;
    let buf = '';

    opts.signal?.addEventListener('abort', () => p.kill());
    p.stdin.write(opts.prompt);
    p.stdin.end();

    p.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        if (!t.startsWith('{')) {
          // plain stdout fallback (JSONL ถูก ignore) — เก็บเป็น final text
          finalText += (finalText ? '\n' : '') + t;
          opts.onEvent?.({ type: 'text', text: finalText });
          continue;
        }
        try {
          const ev = JSON.parse(t) as { type?: string; thread_id?: string; item?: { type?: string; text?: string }; usage?: unknown };
          if (ev.type === 'thread.started' && ev.thread_id) {
            threadId = ev.thread_id;
            opts.onEvent?.({ type: 'thread', threadId });
          } else if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
            finalText = ev.item.text ?? finalText;
            opts.onEvent?.({ type: 'text', text: finalText });
          } else if (ev.type === 'turn.completed') {
            opts.onEvent?.({ type: 'usage', usage: ev.usage });
          }
        } catch {
          // malformed JSON line — ข้าม
        }
      }
    });

    p.on('error', (err) => reject(new Error(`เรียก codex ไม่ได้: ${err.message}`)));
    p.on('close', (code) => {
      if (code === 0) resolve({ text: finalText.trim(), threadId });
      else reject(new Error(`codex exec จบด้วย exit code ${code}`));
    });
  });
}
