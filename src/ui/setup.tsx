import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Select, PasswordInput } from '@inkjs/ui';
import { PROVIDERS } from '../providers/registry.js';
import { listRemoteModels, mergeModelOptions } from '../providers/models.js';
import { BRAND } from '../brand.js';

export interface SetupResult {
  provider: string;
  model: string; // "provider:modelId"
  envVar: string;
  key: string; // '' ถ้าเป็น local provider
  createBrain?: boolean; // เลือกสร้าง second-brain → ต่อด้วย BrainWizard (เก็บ identity จริง)
}

type Step = 'provider' | 'key' | 'model' | 'brain-offer';

/** first-run setup wizard: เลือก provider → ใส่ API key → เลือก model → เสนอสร้าง second-brain */
export function SetupWizard({ onComplete }: { onComplete: (r: SetupResult) => void }) {
  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState('');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [remote, setRemote] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const cfg = provider ? PROVIDERS[provider] : undefined;
  const providerOptions = Object.values(PROVIDERS).map((p) => ({ label: p.label, value: p.id }));

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

  return (
    <Box flexDirection="column" gap={1} marginY={1}>
      <Text bold color="cyan">⚙  ตั้งค่า {BRAND.bannerTitle} (ครั้งแรก)</Text>

      {step === 'provider' && (
        <Box flexDirection="column">
          <Text>1. เลือก AI provider:</Text>
          <Select
            options={providerOptions}
            onChange={(v) => {
              setProvider(v);
              setStep(PROVIDERS[v].requiresKey ? 'key' : 'model');
            }}
          />
        </Box>
      )}

      {step === 'key' && cfg && (
        <Box flexDirection="column">
          <Text>2. วาง API key ของ {cfg.label}:</Text>
          <Text color="gray">   (key ตรงจาก console ของค่าย — ห้าม OAuth/subscription token)</Text>
          <PasswordInput
            placeholder={cfg.envVar}
            onSubmit={(v) => {
              setKey(v.trim());
              setStep('model');
            }}
          />
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
