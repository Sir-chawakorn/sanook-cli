// postinstall — ชี้ทางให้ผู้ใช้พิมพ์คำสั่งที่ "ใช้ได้จริง" ทันทีหลัง `npm i`
// ปัญหาที่แก้: `npm i sanook-cli` (ไม่มี -g) = ลง local ไม่เข้า PATH → พิมพ์ `sanook` แล้วไม่เจอ
// กฎเหล็ก: ห้าม postinstall ทำให้การติดตั้งล้มเหลว (ครอบ try/catch, ออก 0 เสมอ)
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const isGlobal = process.env.npm_config_global === 'true';
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const initCwd = process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : '';

  // เงียบเมื่อ: dev ในรีโปตัวเอง (INIT_CWD === pkgRoot) หรือ CI (กัน log รก)
  const selfInstall = initCwd && initCwd === pkgRoot;
  if (selfInstall || (process.env.CI && !isGlobal)) process.exit(0);

  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const cyan = (s) => paint('36', s);
  const dim = (s) => paint('2', s);
  const bold = (s) => paint('1', s);

  if (isGlobal) {
    console.log(`\n${bold('✅ sanook-cli พร้อมใช้')} — พิมพ์ ${cyan('sanook')} หรือ ${cyan('sanookai')} เพื่อเริ่ม`);
    console.log(dim('   Command installed: sanook (alias: sanookai) · ปิด-เปิด terminal ถ้ายังไม่เจอ · ') + cyan('sanook doctor') + '\n');
  } else {
    console.log(`\n${bold('sanook-cli ลงแบบ local แล้ว')} — ${cyan('sanook')} / ${cyan('sanookai')} ยัง${bold('ไม่')}อยู่ใน PATH`);
    console.log(`  ${dim('• รันเลยตอนนี้:')}            ${cyan('npx sanook')}  ${dim('(or')} ${cyan('npx sanookai')}${dim(')')}`);
    console.log(`  ${dim('• ลงให้พิมพ์ sanook ตรงๆ:')}  ${cyan('npm install -g sanook-cli')}`);
    console.log(`  ${dim('• ตรวจ/แก้ PATH:')}           ${cyan('npx sanook doctor')}\n`);
  }
} catch {
  // ห้ามทำให้ install ล้ม — เงียบไว้
}
