// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER AUTH POLICY (สำคัญ — compliance):
// Sanook เชื่อมกับ Claude / Gemini / ค่ายอื่น ด้วย **official API key ตรงจาก console
// ของค่ายเท่านั้น (BYOK)**. ห้าม OAuth, subscription-credential reuse (Claude.ai /
// ChatGPT plan token), หรือ third-party gateway ที่ reuse auth — ละเมิด ToS และ
// ทำให้ user โดนแบน (Anthropic แบน OpenCode/OpenClaw, Google แบน OpenClaw ปี 2026).
// ─────────────────────────────────────────────────────────────────────────────

/** อ่าน API key จาก env (หลัก + fallbacks) — keychain เป็น enhancement ทีหลัง */
export function resolveKeyFromEnv(envVar: string, fallbacks: readonly string[] = []): string | undefined {
  for (const name of [envVar, ...fallbacks]) {
    const v = process.env[name];
    if (v) return v;
  }
  return undefined;
}

export interface KeyPolicy {
  label: string;
  /** regex ตรวจ format key — null = opaque (ข้าม format check) */
  keyFormat: RegExp | null;
  /** prefix ของ OAuth/subscription token ที่ห้าม reuse (กันโดนแบน) */
  oauthRejectPrefixes?: readonly string[];
}

/**
 * บังคับ policy: key ต้องเป็น API key ตรง ไม่ใช่ OAuth/subscription token
 *  1) reject OAuth prefix (sk-ant-oat / ya29. / AQ. / Bearer ...) → กันบัญชีโดนแบน
 *  2) format check (เฉพาะค่ายที่ keyFormat != null)
 */
export function assertDirectApiKey(policy: KeyPolicy, key: string): void {
  const k = key.trim();
  for (const prefix of policy.oauthRejectPrefixes ?? []) {
    if (k.toLowerCase().startsWith(prefix.toLowerCase())) {
      throw new Error(
        `${policy.label}: ตรวจพบ OAuth/subscription token (${prefix}…) — Sanook รองรับเฉพาะ API key ตรงจาก console ของค่าย (BYOK). ` +
          `การ reuse subscription credential ผิด ToS และทำให้บัญชีโดนแบน`,
      );
    }
  }
  if (policy.keyFormat && !policy.keyFormat.test(k)) {
    throw new Error(
      `${policy.label}: format ของ API key ไม่ถูกต้อง — เช็ก/วางใหม่ (คาดว่าขึ้นต้นตาม ${policy.keyFormat.source})`,
    );
  }
}

/** ปิดบัง API key ในข้อความ log/error — เก็บแค่หัว 4 + ท้าย 2 ตัว */
export function redactKey(s: string): string {
  return s.replace(
    /\b(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{10,}|xai-[A-Za-z0-9]{10,}|gsk_[A-Za-z0-9]{10,}|[A-Za-z0-9_-]{24,})\b/g,
    (m) => (m.length > 8 ? `${m.slice(0, 4)}…${m.slice(-2)}` : '…'),
  );
}
