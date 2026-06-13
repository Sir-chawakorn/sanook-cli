import { Box, Text, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { homedir } from 'node:os';

// gradient ของ Sanook: เขียว → ส้ม → ฟ้า (สนุก = สดใส)
const SANOOK_GRADIENT = ['#22C55E', '#F97316', '#38BDF8'];

export interface BannerProps {
  model: string;
  version?: string;
  account?: string;
  cwd?: string;
}

/** welcome banner — big ASCII + gradient + info line (responsive ตามความกว้าง terminal) */
export function Banner({ model, version = '0.2.0', account = 'BYOK', cwd }: BannerProps) {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const dir = (cwd ?? process.cwd()).replace(homedir(), '~');

  // จอกว้าง = "Sanook AI" ใหญ่, แคบ = "Sanook" / เล็กลง
  const bigText = columns >= 92 ? 'Sanook AI' : 'Sanook';
  const font: 'block' | 'tiny' = columns >= 48 ? 'block' : 'tiny';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gradient colors={SANOOK_GRADIENT}>
        <BigText text={bigText} font={font} />
      </Gradient>
      <Box marginTop={-1} marginLeft={1} flexDirection="column">
        <Text>
          <Text bold color="cyan">Sanook AI CLI</Text>
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
