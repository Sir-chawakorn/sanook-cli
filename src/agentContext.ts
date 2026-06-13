import { AsyncLocalStorage } from 'node:async_hooks';

// context ของ agent ปัจจุบัน — thread ผ่าน async chain (ไม่ใช่ process.env global ที่ชนกันตอน parallel)
// sub-agent (task tool) อ่านจากนี่เพื่อ inherit model/budget + เช็ค depth กัน recursion
export interface AgentContext {
  model: string;
  budgetUsd?: number;
  depth: number; // 0 = main agent, เพิ่มทีละชั้นต่อ sub-agent
}

export const agentContext = new AsyncLocalStorage<AgentContext>();
