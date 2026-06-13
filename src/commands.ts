export interface CommandResult {
  /** true = เป็น slash command (ไม่ส่งเข้า agent) */
  handled: boolean;
  action?: 'clear' | 'compact' | 'quit' | 'help';
  /** ข้อความแสดงกลับ (help / cost / model / unknown) */
  message?: string;
  /** /model <spec> — เปลี่ยน model */
  modelChange?: string;
}

const HELP_TEXT = `คำสั่ง:
  /help            แสดงคำสั่งทั้งหมด
  /model [spec]    ดู/เปลี่ยน model (เช่น /model opus, /model openai:gpt-5)
  /cost            ดู token + cost รอบล่าสุด
  /clear           ล้าง conversation (เริ่มใหม่)
  /compact         บีบ context
  /quit            ออก`;

export interface CommandContext {
  model: string;
  costSummary?: string;
}

/** parse input — ถ้าขึ้นต้น / = slash command, ไม่งั้น handled=false (ส่งเข้า agent) */
export function parseCommand(input: string, ctx: CommandContext): CommandResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { handled: false };

  const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
  switch (cmd) {
    case 'help':
    case '?':
      return { handled: true, action: 'help', message: HELP_TEXT };
    case 'clear':
      return { handled: true, action: 'clear', message: 'ล้าง conversation แล้ว' };
    case 'compact':
      return { handled: true, action: 'compact', message: 'บีบ context แล้ว' };
    case 'quit':
    case 'exit':
      return { handled: true, action: 'quit' };
    case 'model':
      if (!args[0]) return { handled: true, message: `model ปัจจุบัน: ${ctx.model}` };
      return { handled: true, modelChange: args[0], message: `เปลี่ยน model → ${args[0]}` };
    case 'cost':
      return { handled: true, message: ctx.costSummary ?? '(ยังไม่มี usage รอบนี้)' };
    default:
      return { handled: true, message: `ไม่รู้จักคำสั่ง /${cmd} — พิมพ์ /help` };
  }
}
