import { BRAND } from './brand.js';

/** Shell-safe double-quoted string for handoff hints (task may contain quotes/newlines). */
export function shellQuoteDouble(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

/** Hint printed after plan mode completes — stderr so stdout stays pipe-friendly. */
export function formatPlanExecuteHandoff(originalTask: string): string {
  const task = originalTask.trim();
  const quoted = task ? shellQuoteDouble(task) : '<task>';
  return [
    '---',
    'Plan complete. Execute with:',
    `  ${BRAND.cliName} --yes ${quoted}`,
    `  ${BRAND.cliName} plan ${quoted} | ${BRAND.cliName} --yes ${shellQuoteDouble('Execute this plan:')}`,
    `  (plan text on stdout → pipe into ${BRAND.cliName} --yes "Execute this plan:" with stdin)`,
  ].join('\n');
}
