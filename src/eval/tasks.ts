import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface EvalTask {
  id: string;
  prompt: string;
  /** เตรียมไฟล์ใน workspace dir ก่อนรัน agent */
  setup: (dir: string) => Promise<void>;
  /** เช็คผลลัพธ์จริงหลัง agent รัน (รัน build/test/ตรวจไฟล์) */
  check: (dir: string) => Promise<boolean>;
}

/** ชุด task มาตรฐานวัด core capability — file create / edit / search */
export const tasks: EvalTask[] = [
  {
    id: 'create-file',
    prompt: 'สร้างไฟล์ชื่อ greeting.txt ที่มีข้อความว่า hello-sanook',
    setup: async () => {},
    check: async (dir) => {
      try {
        return (await readFile(join(dir, 'greeting.txt'), 'utf8')).includes('hello-sanook');
      } catch {
        return false;
      }
    },
  },
  {
    id: 'edit-file',
    prompt: 'แก้ไฟล์ ver.txt เปลี่ยนเลขเวอร์ชันจาก v1 เป็น v2',
    setup: async (dir) => {
      await writeFile(join(dir, 'ver.txt'), 'app version: v1\n');
    },
    check: async (dir) => {
      try {
        const c = await readFile(join(dir, 'ver.txt'), 'utf8');
        return c.includes('v2') && !c.includes('v1');
      } catch {
        return false;
      }
    },
  },
  {
    id: 'search-and-report',
    prompt: 'ในโฟลเดอร์นี้ หาว่าฟังก์ชันชื่อ secretFn อยู่ไฟล์ไหน แล้วสร้างไฟล์ found.txt เขียนชื่อไฟล์นั้นลงไป',
    setup: async (dir) => {
      await writeFile(join(dir, 'a.ts'), 'export const x = 1;\n');
      await writeFile(join(dir, 'b.ts'), 'export function secretFn() { return 42; }\n');
    },
    check: async (dir) => {
      try {
        return (await readFile(join(dir, 'found.txt'), 'utf8')).includes('b.ts');
      } catch {
        return false;
      }
    },
  },
];
