// key resolution: อ่านจาก env per-provider (BYOK). keychain เป็น enhancement ทีหลัง.
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

/** ปิดบัง API key ในข้อความ log/error — เก็บแค่หัว 4 + ท้าย 2 ตัว */
export function redactKey(s: string): string {
  return s.replace(/\b(sk-[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{24,})\b/g, (m) =>
    m.length > 8 ? `${m.slice(0, 4)}…${m.slice(-2)}` : '…',
  );
}
