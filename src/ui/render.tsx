import { useState } from 'react';
import { render } from 'ink';
import { App, type AppProps } from './app.js';
import { SetupWizard, type SetupResult } from './setup.js';
import { BrainWizard, type BrainAnswers } from './brain-wizard.js';
import { saveKey, saveGlobalConfig, saveBrainPath } from '../config.js';

type Phase = 'setup' | 'brain' | 'app';

export interface RootProps {
  /** true = first run ยังไม่ตั้ง provider → โชว์ wizard ก่อนเข้า REPL */
  needsSetup: boolean;
  appProps: AppProps;
}

/**
 * Root — โฮสต์ setup wizard → brain wizard → REPL ใน **Ink render เดียว**
 *
 * ก่อนหน้านี้แยกเป็น render(SetupWizard) → unmount → render(App) = 2 Ink instances ต่อกัน
 * พอ instance แรก unmount, stdin raw-mode/keypress listener ไม่ reattach กับ instance ที่ 2
 * → พิมพ์ในช่องแชทไม่ได้. รวมเป็น tree เดียว (React สลับ component ภายใน) stdin ต่อเนื่องไม่หลุด.
 */
export function Root({ needsSetup, appProps }: RootProps) {
  const [phase, setPhase] = useState<Phase>(needsSetup ? 'setup' : 'app');
  const [model, setModel] = useState(appProps.initialModel);
  const [brainNote, setBrainNote] = useState<string | undefined>(undefined);

  if (phase === 'setup') {
    const onComplete = (r: SetupResult): void => {
      void (async () => {
        if (r.key) await saveKey(r.envVar, r.key);
        await saveGlobalConfig({ model: r.model, provider: r.provider });
        setModel(r.model);
        setPhase(r.createBrain ? 'brain' : 'app');
      })();
    };
    return <SetupWizard onComplete={onComplete} />;
  }

  if (phase === 'brain') {
    const onComplete = (a: BrainAnswers): void => {
      void (async () => {
        const { scaffoldBrain, BRAIN_DEFAULTS, expandHome, wireBrainMcp } = await import('../brain.js');
        const today = new Date().toISOString().slice(0, 10);
        const target = expandHome(a.path);
        try {
          const res = await scaffoldBrain(target, {
            ...BRAIN_DEFAULTS,
            ownerName: a.ownerName,
            aiName: a.aiName,
            autonomy: a.autonomy,
            today,
          });
          await saveBrainPath(target);
          const wired = await wireBrainMcp(target).catch(() => 'skip');
          setBrainNote(
            `✅ second-brain — ${target} · สร้าง ${res.created.length} ไฟล์ · ` +
              `${wired === 'added' ? 'wire filesystem MCP เข้า vault แล้ว' : 'MCP เดิมอยู่แล้ว (ไม่ทับ)'} · เปิดใน Obsidian: Open folder as vault`,
          );
        } catch (e) {
          setBrainNote(`⚠ สร้าง second-brain ไม่สำเร็จ: ${(e as Error).message} — ลองใหม่ด้วย ${'`'}sanook brain init${'`'}`);
        }
        setPhase('app');
      })();
    };
    return <BrainWizard onComplete={onComplete} />;
  }

  // App mount สดตอน phase = 'app' → useState(initialModel) หยิบ model ที่เลือกจาก wizard ถูกต้อง
  return <App {...appProps} initialModel={model} initialNote={brainNote ?? appProps.initialNote} />;
}

/** เปิดแอป: wizard (ถ้า first-run) → REPL — Ink render ครั้งเดียว (fix: พิมพ์ในช่องแชทไม่ได้) */
export function startApp(props: RootProps): void {
  render(<Root {...props} />);
}

/** เปิด REPL ตรงๆ (ไม่ผ่าน wizard) — เก็บไว้เผื่อ caller อื่น */
export function startRepl(appProps: AppProps): void {
  render(<App {...appProps} />);
}

/** standalone `sanook brain init` (interactive): ถาม path + ตัวตน → scaffold + wire MCP — single render, จบแล้ว process ออก */
export function startBrainSetup(): Promise<void> {
  return new Promise((resolve) => {
    let unmount: () => void = () => {};
    const onComplete = (a: BrainAnswers): void => {
      void (async () => {
        const { scaffoldBrain, BRAIN_DEFAULTS, expandHome, wireBrainMcp } = await import('../brain.js');
        const today = new Date().toISOString().slice(0, 10);
        const target = expandHome(a.path);
        const res = await scaffoldBrain(target, {
          ...BRAIN_DEFAULTS,
          ownerName: a.ownerName,
          aiName: a.aiName,
          autonomy: a.autonomy,
          today,
        });
        await saveBrainPath(target);
        const wired = await wireBrainMcp(target).catch(() => 'skip');
        unmount();
        process.stdout.write(
          `\n✅ second-brain — ${target}\n   สร้าง ${res.created.length} · ข้าม ${res.skipped.length} (มีอยู่แล้ว ไม่ทับ)` +
            `\n   ${wired === 'added' ? 'wire filesystem MCP เข้า vault แล้ว (agent อ่าน/เขียนได้)' : 'MCP: มี server เดิมอยู่แล้ว (ไม่ทับ)'}` +
            `\n   เปิดใน Obsidian: Open folder as vault\n`,
        );
        resolve();
      })();
    };
    const instance = render(<BrainWizard onComplete={onComplete} />);
    unmount = instance.unmount;
  });
}
