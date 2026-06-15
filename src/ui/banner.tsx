import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { BRAND } from '../brand.js';

// gradient ของ Sanook: เขียว → ส้ม → ฟ้า (สนุก = สดใส)
const SANOOK_GRADIENT = ['#22C55E', '#F97316', '#38BDF8'];

// version จาก package.json (single source of truth) — กัน default drift เหมือน bin.ts
const VERSION = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

export interface BannerProps {
  model: string;
  version?: string;
  account?: string;
  cwd?: string;
}

/** welcome banner — minimal: gradient wordmark + meta บรรทัดเดียว (terminal-first, ไม่รก) */
export function Banner({ model, version = VERSION, account = 'BYOK', cwd }: BannerProps) {
  const dir = (cwd ?? process.cwd()).replace(homedir(), '~');
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Gradient colors={SANOOK_GRADIENT}>
          <Text bold>{BRAND.cliName}</Text>
        </Gradient>
        <Text dimColor> v{version} · terminal coding agent · {account}</Text>
      </Box>
      <Text dimColor>
        <Text color="green">●</Text> {model} · {dir}
      </Text>
    </Box>
  );
}
