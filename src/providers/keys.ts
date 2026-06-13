// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER AUTH POLICY (สำคัญ — compliance):
// Sanook เชื่อมกับ Claude / Gemini / ค่ายอื่น ด้วย **official API key ตรงจาก console
// ของค่ายเท่านั้น (BYOK)**. ห้าม OAuth, subscription-credential reuse (Claude.ai /
// ChatGPT plan token), หรือ third-party gateway ที่ reuse auth — ละเมิด ToS และ
// ทำให้ user โดนแบน (Anthropic แบน OpenCode/OpenClaw มาแล้วปี 2026).
// ─────────────────────────────────────────────────────────────────────────────

const ENV_VAR: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  ollama: 'OLLAMA_API_KEY',
};

export function resolveKey(provider: string): string | undefined {
  const envName = ENV_VAR[provider];
  return envName ? process.env[envName] : undefined;
}

export function envVarFor(provider: string): string | undefined {
  return ENV_VAR[provider];
}

// token ที่ดูเหมือน OAuth / subscription / Bearer — ไม่ใช่ API key ตรง
const OAUTH_LIKE = /^(ya29\.|ya29_|Bearer\s|oauth2?[-_]|sess-|sk-ant-oat|access[_-]?token)/i;

/** บังคับ policy: key ต้องเป็น API key ตรง ไม่ใช่ OAuth/subscription token */
export function assertDirectApiKey(provider: string, key: string): void {
  if (OAUTH_LIKE.test(key.trim())) {
    throw new Error(
      `${provider}: ตรวจพบ OAuth/subscription token — Sanook รองรับเฉพาะ API key ตรงจาก console ของค่าย (BYOK) ` +
        `เพื่อไม่ละเมิด ToS (การ reuse subscription credential ทำให้บัญชีโดนแบน)`,
    );
  }
}

/** ปิดบัง API key ในข้อความ log/error — เก็บแค่หัว 4 + ท้าย 2 ตัว */
export function redactKey(s: string): string {
  return s.replace(/\b(sk-[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{24,})\b/g, (m) =>
    m.length > 8 ? `${m.slice(0, 4)}…${m.slice(-2)}` : '…',
  );
}
