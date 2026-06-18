export interface FooterStatusInput {
  columns: number;
  costHint?: string;
  model: string;
  mode: 'ask' | 'auto';
}

const clip = (text: string, width: number): string => {
  if (width <= 0) return '';
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
};

export function footerStatus({ columns, costHint = '', model, mode }: FooterStatusInput): string {
  const width = Math.max(20, Math.floor(columns || 80));
  const parts =
    width < 44
      ? [model, mode]
      : width < 70
        ? [model, `${mode}-mode`, '/help', '@file']
        : [model, `${mode}-mode`, '/help', '/hotkeys', '@file', '↑ history'];
  if (costHint && width >= 70) parts.push(costHint);
  return clip(`  ${parts.join(' · ')}`, width);
}
