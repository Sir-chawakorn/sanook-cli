import { render } from 'ink';
import { App, type AppProps } from './app.js';
import { SetupWizard, type SetupResult } from './setup.js';
import { BrainWizard, type BrainAnswers } from './brain-wizard.js';
import { saveKey, saveGlobalConfig, saveBrainPath } from '../config.js';

export function startRepl(props: AppProps): void {
  render(<App {...props} />);
}

/** render first-run wizard → save key+config (+ optional second-brain) → resolve เมื่อเสร็จ */
export function startSetup(): Promise<SetupResult> {
  return new Promise((resolve) => {
    let unmount: () => void = () => {};
    const onComplete = (r: SetupResult): void => {
      void (async () => {
        if (r.key) await saveKey(r.envVar, r.key);
        await saveGlobalConfig({ model: r.model, provider: r.provider });
        if (r.brainPath) {
          const { scaffoldBrain, BRAIN_DEFAULTS, expandHome } = await import('../brain.js');
          const target = expandHome(r.brainPath);
          const today = new Date().toISOString().slice(0, 10);
          const res = await scaffoldBrain(target, { ...BRAIN_DEFAULTS, today });
          await saveBrainPath(target);
          process.stdout.write(`\n✅ second-brain — ${target} (สร้าง ${res.created.length}, ข้าม ${res.skipped.length})\n`);
        }
        unmount();
        resolve(r);
      })();
    };
    const instance = render(<SetupWizard onComplete={onComplete} />);
    unmount = instance.unmount;
  });
}

/** standalone: sanook brain init (interactive) → ถาม path + ตัวตน → scaffold */
export function startBrainSetup(): Promise<void> {
  return new Promise((resolve) => {
    let unmount: () => void = () => {};
    const onComplete = (a: BrainAnswers): void => {
      void (async () => {
        const { scaffoldBrain, BRAIN_DEFAULTS, expandHome } = await import('../brain.js');
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
        unmount();
        process.stdout.write(
          `\n✅ second-brain — ${target}\n   สร้าง ${res.created.length} · ข้าม ${res.skipped.length} (มีอยู่แล้ว ไม่ทับ)\n   เปิดใน Obsidian: Open folder as vault\n`,
        );
        resolve();
      })();
    };
    const instance = render(<BrainWizard onComplete={onComplete} />);
    unmount = instance.unmount;
  });
}
