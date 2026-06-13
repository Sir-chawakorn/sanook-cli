import { useState } from 'react';
import { Box, Text } from 'ink';
import { Select, PasswordInput } from '@inkjs/ui';
import { PROVIDERS } from '../providers/registry.js';

export interface SetupResult {
  provider: string;
  model: string; // "provider:modelId"
  envVar: string;
  key: string; // '' ถ้าเป็น local provider
}

type Step = 'provider' | 'key' | 'model';

/** first-run setup wizard: เลือก provider → ใส่ API key → เลือก model */
export function SetupWizard({ onComplete }: { onComplete: (r: SetupResult) => void }) {
  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState('');
  const [key, setKey] = useState('');

  const cfg = provider ? PROVIDERS[provider] : undefined;
  const providerOptions = Object.values(PROVIDERS).map((p) => ({ label: p.label, value: p.id }));
  const modelOptions = cfg
    ? Object.entries(cfg.models)
        .filter(([alias]) => alias !== 'default')
        .map(([alias, id]) => ({ label: `${alias} — ${id}`, value: id }))
    : [];

  return (
    <Box flexDirection="column" gap={1} marginY={1}>
      <Text bold color="cyan">⚙  ตั้งค่า Sanook AI CLI (ครั้งแรก)</Text>

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

      {step === 'model' && cfg && (
        <Box flexDirection="column">
          <Text>3. เลือก model เริ่มต้น:</Text>
          <Select
            options={modelOptions}
            onChange={(v) => onComplete({ provider, model: `${provider}:${v}`, envVar: cfg.envVar, key })}
          />
        </Box>
      )}
    </Box>
  );
}
