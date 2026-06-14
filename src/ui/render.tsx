import { render } from 'ink';
import { App, type AppProps } from './app.js';
import { SetupWizard, type SetupResult } from './setup.js';
import { BrainWizard, type BrainAnswers } from './brain-wizard.js';
import { saveKey, saveGlobalConfig, saveBrainPath } from '../config.js';

export function startRepl(props: AppProps): void {
  render(<App {...props} />);
}

/** render first-run wizard → save key+config → (ถ้าเลือก) ต่อ BrainWizard สร้าง second-brain → resolve */
export function startSetup(): Promise<SetupResult> {
  return new Promise((resolve) => {
    let unmount: () => void = () => {};
    const onComplete = (r: SetupResult): void => {
      void (async () => {
        if (r.key) await saveKey(r.envVar, r.key);
        await saveGlobalConfig({ model: r.model, provider: r.provider });
        unmount();
        if (r.createBrain) await startBrainSetup(); // ถาม identity + path จริง แล้ว scaffold
        resolve(r);
      })();
    };
    const instance = render(<SetupWizard onComplete={onComplete} />);
    unmount = instance.unmount;
  });
}

/** standalone / first-run brain: ถาม path + ตัวตน → scaffold (personalized) + auto-wire filesystem MCP */
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
