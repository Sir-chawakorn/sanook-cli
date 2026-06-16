import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select, PasswordInput } from '@inkjs/ui';
import { PROVIDERS, consoleUrl, hasUsableEnvKey } from '../providers/registry.js';
import { resolveKeyFromEnv, assertDirectApiKey } from '../providers/keys.js';
import { listRemoteModels, mergeModelOptions } from '../providers/models.js';
import { detectCodex, type CodexStatus } from '../providers/codex.js';
import { BRAND } from '../brand.js';

export interface SetupResult {
  provider: string;
  model: string; // "provider:modelId"
  envVar: string;
  key: string; // '' ถ้าเป็น local/delegate provider
  createBrain?: boolean; // เลือกสร้าง second-brain → ต่อด้วย BrainWizard (เก็บ identity จริง)
}

type Step = 'provider' | 'codex-auth' | 'key' | 'model' | 'brain-offer';

// จัดลำดับ provider ในเมนู: cloud ยอดนิยม → cloud อื่น → local → ChatGPT-plan (codex) ท้ายสุด
const PROVIDER_ORDER = ['anthropic', 'openai', 'google', 'deepseek', 'xai', 'mistral', 'groq', 'glm', 'minimax', 'ollama', 'lmstudio', 'codex'];

/** label + hint ต่อ provider: เจอ key ใน env / local / ChatGPT-login / ต้องมี key — ให้เลือกง่ายขึ้น */
export function providerOption(id: string): { label: string; value: string } {
  const p = PROVIDERS[id];
  let hint: string;
  if (p.kind === 'delegate') hint = 'login ChatGPT · ไม่ใช้ API key';
  else if (!p.requiresKey) hint = 'local · ไม่ต้อง key';
  else if (hasUsableEnvKey(id)) hint = '✓ key ใน env ใช้ได้';
  else if (resolveKeyFromEnv(p.envVar, p.envFallbacks)) hint = 'key ใน env ใช้ไม่ได้';
  else hint = 'ต้องมี API key';
  return { label: `${p.label}  —  ${hint}`, value: p.id };
}

/** first-run setup wizard: เลือก provider → (codex login | API key) → เลือก model → เสนอสร้าง second-brain */
export function SetupWizard({ onComplete }: { onComplete: (r: SetupResult) => void }) {
  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState('');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [remote, setRemote] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [recheck, setRecheck] = useState(0);
  const [keyError, setKeyError] = useState('');

  const cfg = provider ? PROVIDERS[provider] : undefined;
  const providerOptions = PROVIDER_ORDER.filter((id) => PROVIDERS[id]).map(providerOption);

  // codex-auth: เช็ก codex CLI ติดตั้ง + login ChatGPT (re-run เมื่อกด "เช็กใหม่")
  useEffect(() => {
    if (step !== 'codex-auth') return;
    let alive = true;
    setCodexStatus(null);
    void detectCodex().then((s) => {
      if (!alive) return;
      setCodexStatus(s);
      if (s.installed && s.loggedIn) {
        // login แล้ว → ใช้ default model ของ codex (ChatGPT-plan เลือก model เอง) ข้ามขั้นเลือก key/model
        setModel(`codex:${PROVIDERS.codex.models.default}`);
        setStep('brain-offer');
      }
    });
    return () => {
      alive = false;
    };
  }, [step, recheck]);

  // ดึงรายชื่อ model จริงจาก provider (เฉพาะ provider แบบ SDK ที่ต้อง/ไม่ต้อง key)
  useEffect(() => {
    if (step !== 'model' || !cfg) return;
    let alive = true;
    setLoadingModels(true);
    listRemoteModels(cfg, key || cfg.localPlaceholderKey)
      .then((ids) => alive && setRemote(ids))
      .finally(() => alive && setLoadingModels(false));
    return () => {
      alive = false;
    };
  }, [step, cfg, key]);

  const modelOptions = cfg ? mergeModelOptions(cfg, remote) : [];
  const finish = (createBrain?: boolean): void =>
    onComplete({ provider, model, envVar: cfg?.envVar ?? '', key, createBrain });

  const backToProvider = (): void => {
    setProvider('');
    setCodexStatus(null);
    setKeyError('');
    setKey('');
    setStep('provider');
  };

  // Esc บนทุก step (ยกเว้น provider) = ย้อนกลับไปเลือก provider — กัน dead-end ตอนเลือกผิด
  // หรือ codex detect ค้าง (step codex-auth ตอน pending ไม่มีปุ่มอื่น แต่ Esc ออกได้เสมอ)
  useInput((_input, key) => {
    if (key.escape && step !== 'provider') backToProvider();
  });

  // ตรวจ API key ในขั้นใส่ key — ว่าง = ไม่ผ่าน, OAuth/format ผิด = บอก error (กัน setup จบทั้งที่ key ใช้ไม่ได้)
  const submitKey = (raw: string): void => {
    const k = raw.trim();
    if (!k) {
      setKeyError('วาง API key ก่อนค่ะ (กด Enter ทั้งที่ว่างไม่ได้) · Esc = กลับไปเลือก provider');
      return;
    }
    if (cfg) {
      try {
        assertDirectApiKey(cfg, k); // reject OAuth/subscription token + format ผิด (เหมือน runtime)
      } catch (e) {
        setKeyError((e as Error).message.split('\n')[0]);
        return;
      }
    }
    setKeyError('');
    setKey(k);
    setStep('model');
  };

  return (
    <Box flexDirection="column" gap={1} marginY={1}>
      <Text bold color="cyan">⚙  ตั้งค่า {BRAND.bannerTitle} (ครั้งแรก)</Text>

      {step === 'provider' && (
        <Box flexDirection="column">
          <Text>1. เลือก AI provider (↑↓ เลือก · Enter ยืนยัน):</Text>
          <Text color="gray">   cloud = ใส่ API key · local = ฟรีบนเครื่อง · Codex = login ด้วย ChatGPT</Text>
          <Select
            options={providerOptions}
            onChange={(v) => {
              setProvider(v);
              const p = PROVIDERS[v];
              if (p.kind === 'delegate') setStep('codex-auth');
              else if (p.requiresKey) setStep('key');
              else setStep('model');
            }}
          />
        </Box>
      )}

      {step === 'codex-auth' && (
        <Box flexDirection="column">
          <Text>2. เชื่อม OpenAI Codex (ใช้โควต้า ChatGPT plan — ไม่ต้องมี API key):</Text>
          {codexStatus === null ? (
            <Text color="gray">   กำลังเช็ก codex CLI + สถานะ login…</Text>
          ) : !codexStatus.installed ? (
            <Box flexDirection="column">
              <Text color="yellow">   ❌ ยังไม่ได้ติดตั้ง codex CLI</Text>
              <Text>
                {'   '}ติดตั้งใน terminal อีกหน้าต่าง: <Text color="cyan">npm i -g @openai/codex</Text>
              </Text>
              <Select
                options={[
                  { label: 'เช็กใหม่ (ติดตั้งเสร็จแล้ว)', value: 'recheck' },
                  { label: '← กลับไปเลือก provider อื่น', value: 'back' },
                ]}
                onChange={(v) => (v === 'recheck' ? setRecheck((n) => n + 1) : backToProvider())}
              />
            </Box>
          ) : !codexStatus.loggedIn ? (
            <Box flexDirection="column">
              <Text color="yellow">   ⚠ ติดตั้งแล้ว แต่ยังไม่ได้ login ChatGPT</Text>
              <Text>
                {'   '}รันใน terminal อีกหน้าต่าง: <Text color="cyan">codex login</Text> <Text color="gray">(เปิด browser ให้ยืนยันด้วยบัญชี ChatGPT)</Text>
              </Text>
              <Select
                options={[
                  { label: 'เช็กใหม่ (login เสร็จแล้ว)', value: 'recheck' },
                  { label: '← กลับไปเลือก provider อื่น', value: 'back' },
                ]}
                onChange={(v) => (v === 'recheck' ? setRecheck((n) => n + 1) : backToProvider())}
              />
            </Box>
          ) : (
            <Text color="green">   ✅ login ChatGPT แล้ว — กำลังไปต่อ…</Text>
          )}
        </Box>
      )}

      {step === 'key' && cfg && (
        <Box flexDirection="column">
          <Text>2. วาง API key ของ {cfg.label}: <Text color="gray">(Esc = กลับ)</Text></Text>
          {consoleUrl(provider) ? <Text color="cyan">   → เอา key ที่: {consoleUrl(provider)}</Text> : null}
          {cfg.keyExample ? <Text color="gray">   รูปแบบ key: {cfg.keyExample}</Text> : null}
          <Text color="gray">   (API key ตรงจาก console — ห้าม OAuth/subscription token · key จะเก็บแบบเข้ารหัสในเครื่อง)</Text>
          <PasswordInput placeholder={cfg.envVar} onSubmit={submitKey} />
          {keyError ? <Text color="red">   ✗ {keyError}</Text> : null}
        </Box>
      )}

      {step === 'model' &&
        cfg &&
        (loadingModels ? (
          <Text color="gray">   กำลังดึงรายชื่อ model จาก {cfg.label}…</Text>
        ) : (
          <Box flexDirection="column">
            <Text>
              3. เลือก model เริ่มต้น
              {remote.length ? <Text color="gray"> ({modelOptions.length} ตัวจาก provider + alias)</Text> : null}:
            </Text>
            <Select
              options={modelOptions}
              onChange={(v) => {
                setModel(`${provider}:${v}`);
                setStep('brain-offer');
              }}
            />
          </Box>
        ))}

      {step === 'brain-offer' && (
        <Box flexDirection="column">
          <Text>4. สร้าง &quot;second brain&quot; workspace (Obsidian) สำหรับจัดเก็บงาน + ความจำ AI?</Text>
          <Select
            options={[
              { label: 'สร้างเลย — ตอบไม่กี่ข้อ (ชื่อ + ที่เก็บ)', value: 'yes' },
              { label: `ข้ามไปก่อน (สั่ง ${BRAND.cliName} brain init ทีหลังได้)`, value: 'no' },
            ]}
            onChange={(v) => finish(v === 'yes')}
          />
        </Box>
      )}
    </Box>
  );
}
