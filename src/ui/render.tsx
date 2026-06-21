import { useState } from 'react';
import { render } from 'ink';
import { App, type AppProps } from './app.js';
import { SetupWizard, type SetupResult } from './setup.js';
import { BrainWizard, type BrainAnswers } from './brain-wizard.js';
import { PersonaWizard, PersonaOverlay } from './persona-wizard.js';
import type { PersonaAnswers } from '../persona.js';
import { saveKey, saveGlobalConfig, saveBrainPath } from '../config.js';
import { BRAND } from '../brand.js';
import type { AppLocale } from '../i18n/index.js';

// Ink needs raw mode; mounting on a non-TTY stdin (piped/redirected/cron/CI) throws
// 'Raw mode is not supported' deep in react-reconciler and — worse — exits 0, so a
// script reads success on a fatal crash. Fail fast with a clear message + non-zero exit.
function requireInteractiveTTY(): void {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      `${BRAND.cliName}: โหมด interactive (REPL/wizard) ต้องใช้ terminal จริง (TTY).\n` +
        `รันแบบ headless แทน:  ${BRAND.cliName} "<task>"   หรือ   ${BRAND.cliName} -z "<task>"\n`,
    );
    process.exit(1);
  }
}

type Phase = 'setup' | 'brain' | 'persona' | 'app';

export interface RootProps {
  /** true = first run ยังไม่ตั้ง provider → โชว์ wizard ก่อนเข้า REPL */
  needsSetup: boolean;
  appProps: AppProps;
  /** เคลียร์ terminal (scrollback + Ink frame) ก่อนเข้า REPL — ให้ banner เด้งบนจอว่าง */
  clearScreen?: () => void;
}

/** locale → ค่า language ที่เก็บลง persona ของ second brain (ขั้นที่ 9) */
function languageForLocale(locale: AppLocale): string {
  return locale === 'en' ? 'English + tech-en' : 'ไทย + tech-en';
}

/**
 * Root — โฮสต์ setup wizard → brain wizard → REPL ใน **Ink render เดียว**
 *
 * ก่อนหน้านี้แยกเป็น render(SetupWizard) → unmount → render(App) = 2 Ink instances ต่อกัน
 * พอ instance แรก unmount, stdin raw-mode/keypress listener ไม่ reattach กับ instance ที่ 2
 * → พิมพ์ในช่องแชทไม่ได้. รวมเป็น tree เดียว (React สลับ component ภายใน) stdin ต่อเนื่องไม่หลุด.
 */
export function Root({ needsSetup, appProps, clearScreen }: RootProps) {
  const [phase, setPhase] = useState<Phase>(needsSetup ? 'setup' : 'app');
  const [model, setModel] = useState(appProps.initialModel);
  const [brainNote, setBrainNote] = useState<string | undefined>(undefined);
  const [locale, setLocale] = useState<AppLocale>('th');
  // carried across the brain phase so the persona questionnaire still runs after brain creation
  const [setupPersona, setSetupPersona] = useState(false);

  // เข้า REPL: เคลียร์จอที่เต็มไปด้วย wizard ก่อน → banner "Sanook AI" เด้งบนจอว่าง
  const enterApp = (): void => {
    clearScreen?.();
    setPhase('app');
  };

  if (phase === 'setup') {
    const onComplete = (r: SetupResult): void => {
      void (async () => {
        if (r.key) await saveKey(r.envVar, r.key);
        await saveGlobalConfig({
          model: r.model,
          provider: r.provider,
          locale: r.locale,
          permissionMode: r.permissionMode,
        });
        setModel(r.model);
        setLocale(r.locale);
        setSetupPersona(r.setupPersona ?? false);
        // setup → (brain?) → (persona?) → REPL. The persona phase runs after brain creation when both
        // were requested, so a user who creates a vault AND fills the questionnaire isn't asked twice
        // (the questionnaire prefills from the brain-seeded name).
        if (r.createBrain) setPhase('brain');
        else if (r.setupPersona) setPhase('persona');
        else enterApp();
      })();
    };
    return <SetupWizard onComplete={onComplete} />;
  }

  if (phase === 'brain') {
    const onComplete = (a: BrainAnswers): void => {
      void (async () => {
        const { scaffoldBrain, BRAIN_DEFAULTS, expandHome, wireBrainMcp } = await import('../brain.js');
        const { linkBrainToProject } = await import('../brain-link.js');
        const { seedPersonaMemory } = await import('../memory.js');
        const today = new Date().toISOString().slice(0, 10);
        const target = expandHome(a.path);
        const language = languageForLocale(locale);
        try {
          const res = await scaffoldBrain(target, {
            ...BRAIN_DEFAULTS,
            // vault scaffold needs a non-empty name → apply the default when the user skipped (a.* === '')
            ownerName: a.ownerName || BRAIN_DEFAULTS.ownerName,
            aiName: a.aiName || BRAIN_DEFAULTS.aiName,
            autonomy: a.autonomy,
            language,
            today,
          });
          await saveBrainPath(target);
          const wired = await wireBrainMcp(target).catch(() => 'skip');
          const linked = await linkBrainToProject({ brainPath: target, cwd: process.cwd(), today }).catch(() => null);
          // เซฟ persona/identity ที่เก็บใน wizard ลง durable memory (owner ground-truth) → agent จำได้ทันที
          // ส่ง RAW value (a.ownerName อาจเป็น '') — seedPersonaMemory จะข้ามค่าว่างเอง ไม่ seed 'Owner' placeholder
          const seeded = await seedPersonaMemory({
            ownerName: a.ownerName,
            aiName: a.aiName,
            language,
            autonomy: a.autonomy,
          }).catch(() => 0);
          const linkNote = linked?.projectRelDir
            ? ` · project ${linked.projectRelDir} · ${linked.memoryCreated ? 'created' : 'linked'} ${BRAND.memoryFileName}`
            : '';
          const memNote = seeded ? ` · จำ persona ${seeded} ข้อ` : '';
          setBrainNote(
            `✅ second-brain — ${target} · สร้าง ${res.created.length} ไฟล์ · ` +
              `${wired === 'added' ? 'wire filesystem MCP เข้า vault แล้ว' : 'MCP เดิมอยู่แล้ว (ไม่ทับ)'}${linkNote}${memNote} · เปิดใน Obsidian: Open folder as vault`,
          );
        } catch (e) {
          setBrainNote(`⚠ สร้าง second-brain ไม่สำเร็จ: ${(e as Error).message} — ลองใหม่ด้วย ${'`'}sanook brain init${'`'}`);
        }
        if (setupPersona) setPhase('persona');
        else enterApp();
      })();
    };
    return <BrainWizard onComplete={onComplete} />;
  }

  if (phase === 'persona') {
    // full persona questionnaire (PersonaOverlay loads existing answers — incl. a brain-seeded name —
    // persists to auto-memory + vault, then reports). Its note is appended to any brain note above.
    return (
      <PersonaOverlay
        onDone={(msg) => {
          setBrainNote((n) => (n ? `${n}\n${msg}` : msg));
          enterApp();
        }}
      />
    );
  }

  // App mount สดตอน phase = 'app' → useState(initialModel) หยิบ model ที่เลือกจาก wizard ถูกต้อง
  return <App {...appProps} initialModel={model} initialNote={brainNote ?? appProps.initialNote} />;
}

/** เปิดแอป: wizard (ถ้า first-run) → REPL — Ink render ครั้งเดียว (fix: พิมพ์ในช่องแชทไม่ได้) */
export function startApp(props: RootProps): void {
  requireInteractiveTTY();
  // background, best-effort: weekly memory + vault consolidation (auto-maintain). Non-blocking so the
  // REPL opens instantly; the consolidated store is ready for the next turn. Runs only when due + enabled.
  void import('../auto-maintain.js').then((m) => m.maybeStartupMaintain()).catch(() => {});
  let instance: ReturnType<typeof render> | undefined;
  // \x1b[2J เคลียร์จอ · \x1b[3J เคลียร์ scrollback · \x1b[H cursor กลับมุมซ้ายบน
  // instance.clear() ลบ frame ล่าสุดที่ Ink จำไว้ → App วาดใหม่จากบนสุดไม่เหลือเศษ wizard
  const clearScreen = (): void => {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    instance?.clear();
  };
  instance = render(<Root {...props} clearScreen={clearScreen} />);
}

/** เปิด REPL ตรงๆ (ไม่ผ่าน wizard) — เก็บไว้เผื่อ caller อื่น */
export function startRepl(appProps: AppProps): void {
  requireInteractiveTTY();
  render(<App {...appProps} />);
}

/** standalone `sanook brain init` (interactive): ถาม path + ตัวตน → scaffold + wire MCP — single render, จบแล้ว process ออก */
export function startBrainSetup(): Promise<void> {
  requireInteractiveTTY();
  return new Promise((resolve) => {
    let unmount: () => void = () => {};
    const onComplete = (a: BrainAnswers): void => {
      void (async () => {
        const { scaffoldBrain, BRAIN_DEFAULTS, expandHome, wireBrainMcp } = await import('../brain.js');
        const { linkBrainToProject } = await import('../brain-link.js');
        const { seedPersonaMemory } = await import('../memory.js');
        const today = new Date().toISOString().slice(0, 10);
        const target = expandHome(a.path);
        const res = await scaffoldBrain(target, {
          ...BRAIN_DEFAULTS,
          ownerName: a.ownerName || BRAIN_DEFAULTS.ownerName,
          aiName: a.aiName || BRAIN_DEFAULTS.aiName,
          autonomy: a.autonomy,
          today,
        });
        await saveBrainPath(target);
        const wired = await wireBrainMcp(target).catch(() => 'skip');
        const linked = await linkBrainToProject({ brainPath: target, cwd: process.cwd(), today }).catch(() => null);
        await seedPersonaMemory({
          ownerName: a.ownerName,
          aiName: a.aiName,
          autonomy: a.autonomy,
        }).catch(() => 0);
        unmount();
        const linkLine = linked?.projectRelDir ? `\n   linked repo → ${linked.projectRelDir} · ${BRAND.memoryFileName} in cwd` : '';
        process.stdout.write(
          `\n✅ second-brain — ${target}\n   สร้าง ${res.created.length} · ข้าม ${res.skipped.length} (มีอยู่แล้ว ไม่ทับ)` +
            `\n   ${wired === 'added' ? 'wire filesystem MCP เข้า vault แล้ว (agent อ่าน/เขียนได้)' : 'MCP: มี server เดิมอยู่แล้ว (ไม่ทับ)'}` +
            `${linkLine}` +
            `\n   เปิดใน Obsidian: Open folder as vault\n`,
        );
        resolve();
      })();
    };
    const instance = render(<BrainWizard onComplete={onComplete} />);
    unmount = instance.unmount;
  });
}

/** standalone `sanook persona` (interactive): ถามชุดคำถาม persona → seed auto-memory + เขียนโปรไฟล์ลง vault */
export function startPersonaSetup(): Promise<void> {
  requireInteractiveTTY();
  return new Promise((resolve) => {
    let unmount: () => void = () => {};
    void (async () => {
      const { loadPersonaAnswers, persistPersonaAnswers } = await import('../memory.js');
      const initialAnswers = await loadPersonaAnswers().catch(() => ({}));
      const onComplete = (answers: PersonaAnswers): void => {
        void (async () => {
          const { memoryWritten, vaultWritten, brainPath } = await persistPersonaAnswers(answers);
          unmount();
          const memLine =
            memoryWritten > 0
              ? `   จำเข้า memory แล้ว ${memoryWritten} ข้อ (protected — agent อ่านทุก session)`
              : `   ไม่มีข้อมูลใหม่ที่ต้องจำ (ข้ามหมด/ตรงกับของเดิม)`;
          const vaultLine = vaultWritten
            ? `\n   เขียนโปรไฟล์ลง vault → ${brainPath}/Shared/User-Persona/persona.md`
            : brainPath
              ? `\n   ⚠ ข้ามการเขียนโปรไฟล์ลง vault (ไม่พบโฟลเดอร์ Shared/User-Persona — รัน \`${BRAND.cliName} brain init\` เพื่อ scaffold ใหม่)`
              : `\n   (ยังไม่มี second-brain — รัน \`${BRAND.cliName} brain init\` เพื่อเก็บโปรไฟล์ลง vault ด้วย)`;
          process.stdout.write(`\n✅ บันทึก Persona เรียบร้อย\n${memLine}${vaultLine}\n`);
          resolve();
        })();
      };
      const instance = render(<PersonaWizard onComplete={onComplete} initialAnswers={initialAnswers} />);
      unmount = instance.unmount;
    })();
  });
}
