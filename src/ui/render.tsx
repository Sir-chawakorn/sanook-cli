import { render } from 'ink';
import { App, type AppProps } from './app.js';
import { SetupWizard, type SetupResult } from './setup.js';
import { saveKey, saveGlobalConfig } from '../config.js';

export function startRepl(props: AppProps): void {
  render(<App {...props} />);
}

/** render first-run wizard → save key+config → resolve เมื่อเสร็จ */
export function startSetup(): Promise<SetupResult> {
  return new Promise((resolve) => {
    let unmount: () => void = () => {};
    const onComplete = (r: SetupResult): void => {
      void (async () => {
        if (r.key) await saveKey(r.envVar, r.key);
        await saveGlobalConfig({ model: r.model, provider: r.provider });
        unmount();
        resolve(r);
      })();
    };
    const instance = render(<SetupWizard onComplete={onComplete} />);
    unmount = instance.unmount;
  });
}
