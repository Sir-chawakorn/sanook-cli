import { Box, Text } from 'ink';
import { memo, useRef } from 'react';

export interface MarkdownTextProps {
  columns: number;
  text: string;
}

type InlineSegment = { kind: 'bold' | 'code' | 'text'; text: string };

const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;

function clip(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length > width ? `${text.slice(0, Math.max(0, width - 3))}...` : text;
}

function bodyWidth(columns: number): number {
  return Math.max(24, Math.min(Math.max(30, columns - 4), 100));
}

function lineStartsFence(line: string): boolean {
  return FENCE_RE.test(line);
}

export function findStableMarkdownBoundary(text: string): number {
  let inFence = false;
  let last = -1;
  for (let i = 0; i < text.length; ) {
    const nl = text.indexOf('\n', i);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(i, end);
    if (lineStartsFence(line)) inFence = !inFence;
    if (!inFence && text.slice(end, end + 2) === '\n\n') last = end + 2;
    if (nl === -1) break;
    i = nl + 1;
  }
  return last;
}

function inlineSegments(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) });
    const token = match[0];
    out.push(
      token.startsWith('`')
        ? { kind: 'code', text: token.slice(1, -1) }
        : { kind: 'bold', text: token.slice(2, -2) },
    );
    last = index + token.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

function InlineMarkdown({ text }: { text: string }) {
  return (
    <Text>
      {inlineSegments(text).map((segment, index) => {
        if (segment.kind === 'code') {
          return (
            <Text key={index} color="yellow">
              {segment.text}
            </Text>
          );
        }
        if (segment.kind === 'bold') {
          return (
            <Text key={index} bold>
              {segment.text}
            </Text>
          );
        }
        return <Text key={index}>{segment.text}</Text>;
      })}
    </Text>
  );
}

export function MarkdownText({ columns, text }: MarkdownTextProps) {
  const width = bodyWidth(columns);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes = [];
  let inFence = false;
  let fenceLang = '';

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    const fence = FENCE_RE.exec(raw);
    if (fence) {
      inFence = !inFence;
      fenceLang = inFence ? fence[2]?.trim() ?? '' : '';
      nodes.push(
        <Text key={`f-${index}`} color="cyan" dimColor>
          {inFence ? `code${fenceLang ? ` ${clip(fenceLang, 24)}` : ''}` : 'end code'}
        </Text>,
      );
      continue;
    }

    if (inFence) {
      nodes.push(
        <Text key={`c-${index}`} color="gray" wrap="truncate-end">
          {'  '}
          {clip(raw || ' ', width - 2)}
        </Text>,
      );
      continue;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      nodes.push(<Text key={`b-${index}`}> </Text>);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      nodes.push(
        <Text key={`h-${index}`} color="cyan" bold wrap="truncate-end">
          {clip(heading[2] ?? '', width)}
        </Text>,
      );
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      nodes.push(
        <Text key={`q-${index}`} dimColor wrap="truncate-end">
          {'> '}
          {clip(quote[1] ?? '', width - 2)}
        </Text>,
      );
      continue;
    }

    const bullet = /^([-*])\s+(.+)$/.exec(trimmed);
    if (bullet) {
      nodes.push(
        <Text key={`li-${index}`} wrap="truncate-end">
          {'- '}
          <InlineMarkdown text={clip(bullet[2] ?? '', width - 2)} />
        </Text>,
      );
      continue;
    }

    const ordered = /^(\d+[.)])\s+(.+)$/.exec(trimmed);
    if (ordered) {
      const marker = `${ordered[1]} `;
      nodes.push(
        <Text key={`ol-${index}`} wrap="truncate-end">
          {marker}
          <InlineMarkdown text={clip(ordered[2] ?? '', width - marker.length)} />
        </Text>,
      );
      continue;
    }

    nodes.push(
      <Text key={`p-${index}`} wrap="truncate-end">
        <InlineMarkdown text={clip(trimmed, width)} />
      </Text>,
    );
  }

  return <Box flexDirection="column">{nodes}</Box>;
}

const MemoMarkdownText = memo(MarkdownText);

export const StreamingMarkdownText = memo(function StreamingMarkdownText({ columns, text }: MarkdownTextProps) {
  const stableRef = useRef('');
  if (!text.startsWith(stableRef.current)) stableRef.current = '';
  const boundary = findStableMarkdownBoundary(text);
  if (boundary > stableRef.current.length) stableRef.current = text.slice(0, boundary);
  const stable = stableRef.current;
  const tail = text.slice(stable.length);
  return (
    <Box flexDirection="column">
      {stable ? <MemoMarkdownText columns={columns} text={stable} /> : null}
      {tail ? <MarkdownText columns={columns} text={tail} /> : null}
    </Box>
  );
});
