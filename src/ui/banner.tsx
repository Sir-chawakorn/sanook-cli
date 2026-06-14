import { Box, Text, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
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

/** welcome banner — big ASCII + gradient + info line (responsive ตามความกว้าง terminal) */
export function Banner({ model, version = VERSION, account = 'BYOK', cwd }: BannerProps) {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const dir = (cwd ?? process.cwd()).replace(homedir(), '~');

  const bigText = columns >= 92 ? BRAND.bannerWide : BRAND.bannerNarrow;
  const font: 'block' | 'tiny' = columns >= 48 ? 'block' : 'tiny';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gradient colors={SANOOK_GRADIENT}>
        <BigText text={bigText} font={font} />
      </Gradient>
      <Box marginTop={-1} marginLeft={1} flexDirection="column">
        <Text>
          <Text bold color="cyan">{BRAND.bannerTitle}</Text>
          <Text color="gray"> v{version} · terminal coding agent · BYOK</Text>
        </Text>
        <Text color="gray">
          <Text color="green">●</Text> {model}
          {'   '}account: {account}
          {'   '}cwd: {dir}
        </Text>
      </Box>
    </Box>
  );
}
