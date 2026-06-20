import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'dashboard', 'static');
const dest = join(root, 'dist', 'dashboard', 'static');

mkdirSync(dirname(dest), { recursive: true });
if (!existsSync(src)) {
  console.warn('dashboard static source missing:', src);
  process.exit(0);
}
cpSync(src, dest, { recursive: true });
console.log('copied dashboard static →', dest);
