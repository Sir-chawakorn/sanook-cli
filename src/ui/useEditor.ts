import { useState, useRef } from 'react';
import type { Key } from 'ink';

// line editor เล็กๆ สำหรับ REPL — cursor, multiline, history nav, readline shortcut
// (เลียน shell/readline) คืน action ให้ app ตัดสินใจ submit/interrupt
export type EditorAction = 'submit' | 'handled' | 'interrupt' | 'none';

export interface Editor {
  value: string;
  cursor: number;
  setValue: (v: string) => void;
  reset: () => void;
  handleKey: (input: string, key: Key) => EditorAction;
}

export function useEditor(history: string[]): Editor {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const histIndex = useRef<number | null>(null); // null = กำลังแก้ draft (ไม่ได้อยู่ในประวัติ)
  const draft = useRef('');

  const set = (v: string, c = v.length): void => {
    setValue(v);
    setCursor(Math.max(0, Math.min(c, v.length)));
  };
  const reset = (): void => {
    histIndex.current = null;
    set('');
  };

  const insert = (s: string): void => set(value.slice(0, cursor) + s + value.slice(cursor), cursor + s.length);

  const historyPrev = (): void => {
    if (!history.length) return;
    if (histIndex.current === null) {
      draft.current = value;
      histIndex.current = history.length - 1;
    } else {
      histIndex.current = Math.max(0, histIndex.current - 1);
    }
    set(history[histIndex.current]);
  };
  const historyNext = (): void => {
    if (histIndex.current === null) return;
    if (histIndex.current >= history.length - 1) {
      histIndex.current = null;
      set(draft.current);
    } else {
      histIndex.current += 1;
      set(history[histIndex.current]);
    }
  };

  const handleKey = (input: string, key: Key): EditorAction => {
    if (key.return) {
      // Alt/Option+Enter หรือบรรทัดลงท้าย "\" → ขึ้นบรรทัดใหม่ (multiline) ไม่ submit
      if (key.meta) return insert('\n'), 'handled';
      if (value.slice(0, cursor).endsWith('\\')) return set(value.slice(0, cursor - 1) + '\n' + value.slice(cursor), cursor), 'handled';
      return 'submit';
    }
    if (key.upArrow) return historyPrev(), 'handled';
    if (key.downArrow) return historyNext(), 'handled';
    if (key.leftArrow) return setCursor(Math.max(0, cursor - 1)), 'handled';
    if (key.rightArrow) return setCursor(Math.min(value.length, cursor + 1)), 'handled';

    if (key.ctrl) {
      switch (input) {
        case 'a': return setCursor(0), 'handled';
        case 'e': return setCursor(value.length), 'handled';
        case 'u': return set(value.slice(cursor), 0), 'handled'; // ลบจากต้นบรรทัดถึง cursor
        case 'k': return set(value.slice(0, cursor), cursor), 'handled'; // ลบจาก cursor ถึงท้าย
        case 'w': { // ลบ word ก่อน cursor (รวมกรณีเหลือแต่ whitespace)
          const left = value.slice(0, cursor).replace(/\s+$|\s*\S+\s*$/, '');
          return set(left + value.slice(cursor), left.length), 'handled';
        }
        case 'c': return 'interrupt';
        default: return 'handled';
      }
    }
    if (key.backspace || key.delete) {
      if (cursor === 0) return 'handled';
      return set(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1), 'handled';
    }
    if (input && !key.meta) {
      histIndex.current = null; // เริ่มพิมพ์ = ออกจากโหมดดูประวัติ
      return insert(input), 'handled';
    }
    return 'none';
  };

  return { value, cursor, setValue: (v) => set(v), reset, handleKey };
}
