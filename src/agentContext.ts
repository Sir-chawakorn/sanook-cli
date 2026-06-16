import { AsyncLocalStorage } from 'node:async_hooks';
import type { SharedBudget } from './cost.js';

// context ของ agent ปัจจุบัน — thread ผ่าน async chain (ไม่ใช่ process.env global ที่ชนกันตอน parallel)
// sub-agent (task tool) อ่านจากนี่เพื่อ inherit model/budget + เช็ค depth กัน recursion
export interface AgentContext {
  model: string;
  budgetUsd?: number;
  sharedBudget?: SharedBudget;
  depth: number; // 0 = main agent, เพิ่มทีละชั้นต่อ sub-agent
  /** working dir ของ agent นี้ — sub-agent ที่รันใน git worktree แยกตั้งค่านี้เพื่อ isolate file ops
   *  (ทุก tool อ่านผ่าน agentCwd() → relative path ผูกกับ cwd นี้ ไม่ใช่ process.cwd() กลาง) */
  cwd?: string;
}

export const agentContext = new AsyncLocalStorage<AgentContext>();

/** working dir ของ agent ปัจจุบัน — threaded cwd (worktree) ถ้ามี ไม่งั้น process.cwd() */
export function agentCwd(): string {
  return agentContext.getStore()?.cwd ?? process.cwd();
}
