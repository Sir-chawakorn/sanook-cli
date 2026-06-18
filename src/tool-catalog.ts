export interface ToolCatalogEntry {
  detail: string;
  group: string;
  name: string;
  summary: string;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    detail: 'Read, write, patch, list, glob, grep, and run bounded shell commands in the current workspace.',
    group: 'Files',
    name: 'workspace tools',
    summary: 'read/write/edit/list/glob/grep/bash',
  },
  {
    detail: 'Inspect diffs, status, logs, and create commits when the user explicitly wants a commit.',
    group: 'Git',
    name: 'git tools',
    summary: 'status/diff/log/commit',
  },
  {
    detail: 'Remember facts, recall local memory, discover skills, and create reusable skill workflows.',
    group: 'Memory',
    name: 'memory + skills',
    summary: 'remember/recall/find_skills/create_skill',
  },
  {
    detail: 'Schedule recurring or future tasks for the Sanook gateway service to run later.',
    group: 'Gateway',
    name: 'scheduled tasks',
    summary: 'schedule/list/cancel',
  },
  {
    detail: 'Fan work out to sub-agents, collect results, cancel background jobs, and inspect task status.',
    group: 'Agents',
    name: 'agent orchestration',
    summary: 'task/task_parallel/task_spawn/task_collect',
  },
  {
    detail: 'Ask the language server for type errors and lint-like diagnostics after code edits.',
    group: 'Quality',
    name: 'diagnostics',
    summary: 'LSP diagnostics',
  },
];

export function formatToolCatalog(tools: ToolCatalogEntry[] = TOOL_CATALOG): string {
  return tools.map((tool) => `${tool.group}: ${tool.summary}`).join('\n  ');
}
