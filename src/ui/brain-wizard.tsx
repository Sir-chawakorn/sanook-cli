import { useState } from 'react';
import { Box, Text } from 'ink';
import { TextInput, Select } from '@inkjs/ui';
import { BRAIN_DEFAULTS, type Autonomy } from '../brain.js';
import { defaultBrainPath } from '../brand.js';

export interface BrainAnswers {
  path: string;
  /** RAW typed value — '' when the user pressed Enter to skip. Callers apply BRAIN_DEFAULTS for the
   * vault scaffold but pass this raw value to seedPersonaMemory, so a skipped name is never remembered
   * as the literal placeholder 'Owner'. */
  ownerName: string;
  aiName: string;
  autonomy: Autonomy;
}

type Step = 'path' | 'owner' | 'ai' | 'autonomy';

const DEFAULT_PATH = defaultBrainPath();

/** standalone wizard: ถาม path + ตัวตน + autonomy แล้ว scaffold (sanook brain init) — Enter รับ default */
export function BrainWizard({ onComplete }: { onComplete: (a: BrainAnswers) => void }) {
  const [step, setStep] = useState<Step>('path');
  const [path, setPath] = useState(DEFAULT_PATH);
  // raw typed values — '' means "skipped" (so it isn't seeded as a name); the placeholder still shows
  // the default so the user knows what Enter-to-skip yields in the scaffolded vault.
  const [ownerName, setOwnerName] = useState('');
  const [aiName, setAiName] = useState('');

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
          <Text>2. เรียกคุณว่าอะไรดี? (ชื่อ/ชื่อเล่น — Enter เปล่า = ใช้ &quot;{BRAIN_DEFAULTS.ownerName}&quot;)</Text>
          <TextInput
            placeholder={BRAIN_DEFAULTS.ownerName}
            onSubmit={(v) => {
              setOwnerName(v.trim());
              setStep('ai');
            }}
          />
        </Box>
      )}

      {step === 'ai' && (
        <Box flexDirection="column">
          <Text>3. อยากให้ AI เรียกตัวเองว่าอะไร? <Text color="gray">(Enter เปล่า = &quot;{BRAIN_DEFAULTS.aiName}&quot;)</Text></Text>
          <TextInput
            placeholder={BRAIN_DEFAULTS.aiName}
            onSubmit={(v) => {
              setAiName(v.trim());
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
