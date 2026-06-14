import { useState } from 'react';
import { Box, Text } from 'ink';
import { TextInput, Select } from '@inkjs/ui';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BRAIN_DEFAULTS, type Autonomy } from '../brain.js';

export interface BrainAnswers {
  path: string;
  ownerName: string;
  aiName: string;
  autonomy: Autonomy;
}

type Step = 'path' | 'owner' | 'ai' | 'autonomy';

const DEFAULT_PATH = join(homedir(), 'Documents', BRAIN_DEFAULTS.vaultName);

/** standalone wizard: ถาม path + ตัวตน + autonomy แล้ว scaffold (sanook brain init) — Enter รับ default */
export function BrainWizard({ onComplete }: { onComplete: (a: BrainAnswers) => void }) {
  const [step, setStep] = useState<Step>('path');
  const [path, setPath] = useState(DEFAULT_PATH);
  const [ownerName, setOwnerName] = useState(BRAIN_DEFAULTS.ownerName);
  const [aiName, setAiName] = useState(BRAIN_DEFAULTS.aiName);

  return (
    <Box flexDirection="column" gap={1} marginY={1}>
      <Text bold color="cyan">🧠 สร้าง Second Brain workspace</Text>

      {step === 'path' && (
        <Box flexDirection="column">
          <Text>1. วางโครงสร้างไว้ที่ไหน? (Enter = default)</Text>
          <Text color="gray">   {DEFAULT_PATH}</Text>
          <TextInput
            defaultValue={DEFAULT_PATH}
            placeholder={DEFAULT_PATH}
            onSubmit={(v) => {
              setPath(v.trim() || DEFAULT_PATH);
              setStep('owner');
            }}
          />
        </Box>
      )}

      {step === 'owner' && (
        <Box flexDirection="column">
          <Text>2. เรียกคุณว่าอะไรดี? (ชื่อ/ชื่อเล่น — Enter = ข้าม)</Text>
          <TextInput
            defaultValue={BRAIN_DEFAULTS.ownerName}
            onSubmit={(v) => {
              setOwnerName(v.trim() || BRAIN_DEFAULTS.ownerName);
              setStep('ai');
            }}
          />
        </Box>
      )}

      {step === 'ai' && (
        <Box flexDirection="column">
          <Text>3. อยากให้ AI เรียกตัวเองว่าอะไร?</Text>
          <TextInput
            defaultValue={BRAIN_DEFAULTS.aiName}
            onSubmit={(v) => {
              setAiName(v.trim() || BRAIN_DEFAULTS.aiName);
              setStep('autonomy');
            }}
          />
        </Box>
      )}

      {step === 'autonomy' && (
        <Box flexDirection="column">
          <Text>4. ให้ AI ทำงานแบบไหน?</Text>
          <Select
            options={[
              { label: 'ask-on-risk — ทำเลยถ้าปลอดภัย ถามเฉพาะ destructive (แนะนำ)', value: 'ask-on-risk' },
              { label: 'act-first — ทำเลยเกือบทุกอย่าง ยกเว้น destructive', value: 'act-first' },
              { label: 'ask-first — ถามก่อนทุกงานที่ไม่ trivial', value: 'ask-first' },
            ]}
            onChange={(v) => onComplete({ path, ownerName, aiName, autonomy: v as Autonomy })}
          />
        </Box>
      )}
    </Box>
  );
}
