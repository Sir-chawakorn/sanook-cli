export interface OptionValueResult {
  value?: string;
  nextIndex: number;
}

export function isFlagLike(value: string): boolean {
  return value.startsWith('--') || /^-[A-Za-z]/.test(value);
}

export function inlineValue(flag: string, value: string): string | undefined {
  const prefix = `${flag}=`;
  if (!value.startsWith(prefix)) return undefined;
  const parsed = value.slice(prefix.length);
  return parsed === '' ? undefined : parsed;
}

export function takeValue(argv: readonly string[], index: number): OptionValueResult {
  const value = argv[index + 1];
  if (value === undefined || value === '' || isFlagLike(value)) return { nextIndex: index };
  return { value, nextIndex: index + 1 };
}
