export const HOTKEYS: [string, string][] = [
  ['Ctrl+C', 'clear draft / interrupt running turn / exit when input is empty'],
  ['Esc', 'stop running turn and clear queued prompts'],
  ['↑/↓', 'prompt history'],
  ['Ctrl+A/E', 'start / end of line'],
  ['Ctrl+U/K', 'delete to start / end'],
  ['Ctrl+W', 'delete previous word'],
  ['Alt+Enter', 'insert newline'],
  ['\\+Enter', 'multi-line continuation fallback'],
  ['type while busy + Enter', 'queue the next prompt'],
  ['busy ↑/↓ + Ctrl+X', 'select and delete queued prompts'],
  ['@file', 'inline a file or attach an image'],
  ['/model <spec>', 'switch model'],
  ['/diff /undo /rewind', 'inspect, stash, or rewind file changes'],
];

export function formatHotkeys(): string {
  const width = HOTKEYS.reduce((max, [key]) => Math.max(max, key.length), 0);
  return ['hotkeys:', ...HOTKEYS.map(([key, help]) => `  ${key.padEnd(width)}  ${help}`)].join('\n');
}
