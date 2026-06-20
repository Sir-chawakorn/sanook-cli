import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput, Select } from '@inkjs/ui';
import { PERSONA_QUESTIONS, PERSONA_OTHER, type PersonaAnswers } from '../persona.js';

/**
 * Interactive persona questionnaire (`sanook persona`). Walks PERSONA_QUESTIONS one at a
 * time — A/B/C/D Selects and free-text inputs. A select "อื่นๆ (พิมพ์เอง)" drops into a
 * free-text follow-up for that same question. Esc goes back one step. Calls onComplete with
 * the full answers map when finished.
 */
export function PersonaWizard({ onComplete }: { onComplete: (a: PersonaAnswers) => void }) {
  const total = PERSONA_QUESTIONS.length;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<PersonaAnswers>({});
  const [otherMode, setOtherMode] = useState(false);

  const q = PERSONA_QUESTIONS[index];

  const goBack = (): void => {
    if (otherMode) {
      setOtherMode(false);
      return;
    }
    if (index > 0) setIndex(index - 1);
  };

  useInput((_input, key) => {
    if (key.escape) goBack();
  });

  const advance = (value: string): void => {
    const next = { ...answers, [q.id]: value };
    setAnswers(next);
    setOtherMode(false);
    if (index + 1 >= total) {
      onComplete(next);
    } else {
      setIndex(index + 1);
    }
  };

  const showTextInput = q.type === 'text' || otherMode;

  // On Esc-back, surface the previously-chosen option FIRST so the highlight lands on it. @inkjs/ui
  // Select always focuses the first option on (re)mount and ignores defaultValue for the highlight, so
  // with no defaultValue pressing Enter selects the focused (first) option — making that the prior
  // answer keeps "Esc-back then Enter to re-confirm" from silently overwriting it with the first option.
  const selectOptions = (() => {
    const opts = (q.options ?? []).map((o) => ({ label: o.label, value: o.value }));
    const prior = answers[q.id];
    const i = prior ? opts.findIndex((o) => o.value === prior) : -1;
    return i > 0 ? [opts[i], ...opts.slice(0, i), ...opts.slice(i + 1)] : opts;
  })();

  return (
    <Box flexDirection="column" gap={1} marginY={1}>
      <Text bold color="cyan">
        🪪 ตั้งค่า Persona <Text color="gray">— บอก AI ว่าคุณเป็นใคร + อยากให้ทำงานยังไง</Text>
      </Text>
      <Text color="gray">
        ข้อ {index + 1}/{total} · Esc = ย้อนกลับ · Ctrl+C = ออก
      </Text>

      <Box flexDirection="column">
        <Text>{q.prompt}</Text>
        {showTextInput ? (
          // key forces a fresh TextInput per question/other-mode — @inkjs/ui keeps the typed value in
          // internal state with no reset-on-prop-change (so without a changing key the previous answer
          // carries into the next question). defaultValue restores a prior answer on Esc-back so pressing
          // Enter doesn't overwrite it with '' (empty otherMode follow-up starts blank).
          <TextInput
            key={`text-${index}-${otherMode ? 'other' : 'main'}`}
            defaultValue={otherMode ? '' : answers[q.id]}
            placeholder={otherMode ? 'พิมพ์คำตอบของคุณ…' : (q.placeholder ?? '')}
            onSubmit={(v) => advance(v.trim())}
          />
        ) : (
          // selectOptions puts the prior answer first (see above) so Esc-back + Enter re-confirms it
          <Select
            key={`select-${index}`}
            options={selectOptions}
            onChange={(v) => {
              if (v === PERSONA_OTHER) setOtherMode(true);
              else advance(v);
            }}
          />
        )}
      </Box>
    </Box>
  );
}
