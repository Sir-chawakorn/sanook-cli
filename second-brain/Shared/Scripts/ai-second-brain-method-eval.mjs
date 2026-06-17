#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const vault = process.argv[2] ?? 'second-brain';

const files = {
  aiIndex: 'Shared/AI-Context-Index.md',
  user: 'USER.md',
  currentState: 'Shared/Operating-State/current-state.md',
  preferences: 'Shared/User-Memory/user-preferences.md',
  decisions: 'Shared/Decision-Memory/decision-log.md',
  structureMap: 'Vault Structure Map.md',
  contextPolicy: 'Shared/Rules/context-assembly-policy.md',
  noteRule: 'Shared/Rules/contextual-note-rule.md',
  formatting: 'Shared/Rules/rules-formatting.md',
  memoryWrite: 'Shared/Rules/memory-write-protocol.md',
  frontmatter: 'Shared/Rules/frontmatter-standard.md',
  ingest: 'Runbooks/ingest-quarantine.md',
  sleep: 'Runbooks/sleep-time-consolidation.md',
  evalLoop: 'Runbooks/eval-loop.md',
  retrievalEval: 'Evals/retrieval-eval.md',
  qualityLedger: 'Evals/quality-ledger.md',
  verification: 'Shared/Tech-Standards/verification-standard.md',
  coordinationNow: 'Shared/Coordination/NOW.md',
  taskBoard: 'Shared/Coordination/task-board.md',
  agentRegistry: 'Shared/Coordination/agent-registry.md',
  sessionsIndex: 'Sessions/_Index.md',
  runbooksIndex: 'Runbooks/_Index.md',
  scriptsIndex: 'Shared/Scripts/_Index.md',
};

function fileTokens(path) {
  const full = join(vault, path);
  if (!existsSync(full)) return { exists: false, tokens: 0 };
  return { exists: true, tokens: Math.ceil(readFileSync(full, 'utf8').length / 4) };
}

const scenarios = [
  {
    id: 'start-session',
    label: 'เริ่มงานกับ AI โดยไม่หลุด source of truth',
    required: [files.aiIndex, files.user, files.currentState, files.preferences, files.decisions],
    capabilities: ['retrieval', 'state', 'preference'],
  },
  {
    id: 'write-durable-note',
    label: 'สร้าง/แก้ durable note ให้ถูกที่และค้นเจอภายหลัง',
    required: [files.aiIndex, files.structureMap, files.contextPolicy, files.noteRule, files.formatting],
    capabilities: ['retrieval', 'routing', 'write-contract', 'graph-linking'],
  },
  {
    id: 'write-memory',
    label: 'บันทึก preference/decision/fact โดยไม่ append ซ้ำ',
    required: [files.aiIndex, files.memoryWrite, files.frontmatter, files.preferences, files.decisions],
    capabilities: ['memory-op', 'dedupe', 'verification'],
  },
  {
    id: 'ingest-source',
    label: 'นำข้อมูลภายนอกเข้า vault แบบปลอด prompt injection',
    required: [files.aiIndex, files.ingest, files.frontmatter, files.structureMap],
    capabilities: ['ingest-safety', 'provenance', 'routing'],
  },
  {
    id: 'consolidate',
    label: 'ทำ sleep-time consolidation และปิด loop ความจำ',
    required: [files.aiIndex, files.sleep, files.memoryWrite, files.retrievalEval, files.qualityLedger],
    capabilities: ['consolidation', 'memory-op', 'eval'],
  },
  {
    id: 'multi-agent',
    label: 'กันหลาย agent ชนกันและส่งต่องานได้',
    required: [files.aiIndex, files.coordinationNow, files.taskBoard, files.agentRegistry, files.sessionsIndex],
    capabilities: ['coordination', 'handoff', 'session-log'],
  },
  {
    id: 'technical-work',
    label: 'งานเทคนิคที่ต้อง verify ก่อนสรุป',
    required: [files.aiIndex, files.verification, files.evalLoop, files.sessionsIndex],
    capabilities: ['verification', 'eval', 'session-log'],
  },
];

const methods = [
  {
    id: 'session-log-only',
    label: 'Session-log only',
    filesFor: () => [files.sessionsIndex],
    capabilities: ['session-log'],
  },
  {
    id: 'folder-map-only',
    label: 'Folder map + destination indexes',
    filesFor: (scenario) => [files.structureMap, files.sessionsIndex, ...scenario.required.filter((p) => p.endsWith('_Index.md'))],
    capabilities: ['routing', 'session-log'],
  },
  {
    id: 'single-context-index',
    label: 'Single retrieval index',
    filesFor: () => [files.aiIndex, files.user, files.currentState, files.preferences, files.decisions],
    capabilities: ['retrieval', 'state', 'preference'],
  },
  {
    id: 'jit-context-policy',
    label: 'Index + JIT context policy',
    filesFor: (scenario) => [files.aiIndex, files.contextPolicy, ...scenario.required.slice(0, 3)],
    capabilities: ['retrieval', 'state', 'preference', 'routing', 'write-contract', 'graph-linking', 'verification'],
  },
  {
    id: 'scientific-loop-sequence',
    label: 'Scientific loop sequence',
    filesFor: (scenario) => [files.aiIndex, files.contextPolicy, ...scenario.required],
    capabilities: [
      'retrieval',
      'state',
      'preference',
      'routing',
      'write-contract',
      'graph-linking',
      'memory-op',
      'dedupe',
      'verification',
      'ingest-safety',
      'provenance',
      'consolidation',
      'eval',
      'coordination',
      'handoff',
      'session-log',
    ],
  },
];

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function scoreScenario(method, scenario) {
  const contextFiles = uniq(method.filesFor(scenario));
  const fileStats = contextFiles.map((path) => ({ path, ...fileTokens(path) }));
  const tokens = fileStats.reduce((sum, stat) => sum + stat.tokens, 0);
  const requiredHits = scenario.required.filter((path) => contextFiles.includes(path) && fileTokens(path).exists).length;
  const existingRequired = scenario.required.filter((path) => fileTokens(path).exists).length;
  const fileCoverage = existingRequired ? requiredHits / existingRequired : 1;
  const capabilityHits = scenario.capabilities.filter((cap) => method.capabilities.includes(cap)).length;
  const capabilityCoverage = scenario.capabilities.length ? capabilityHits / scenario.capabilities.length : 1;
  const economy = tokens <= 2200 ? 1 : Math.max(0, 1 - (tokens - 2200) / 2200);
  const score = Math.round((fileCoverage * 70 + capabilityCoverage * 20 + economy * 10) * 10) / 10;
  return { score, fileCoverage, capabilityCoverage, economy, tokens, contextFiles };
}

const rows = methods.map((method) => {
  const perScenario = scenarios.map((scenario) => scoreScenario(method, scenario));
  const avgScore = perScenario.reduce((sum, s) => sum + s.score, 0) / perScenario.length;
  const avgTokens = perScenario.reduce((sum, s) => sum + s.tokens, 0) / perScenario.length;
  const avgFileCoverage = perScenario.reduce((sum, s) => sum + s.fileCoverage, 0) / perScenario.length;
  const avgCapabilityCoverage = perScenario.reduce((sum, s) => sum + s.capabilityCoverage, 0) / perScenario.length;
  return {
    method,
    avgScore: Math.round(avgScore * 10) / 10,
    avgTokens: Math.round(avgTokens),
    avgFileCoverage: Math.round(avgFileCoverage * 100),
    avgCapabilityCoverage: Math.round(avgCapabilityCoverage * 100),
    perScenario,
  };
});

rows.sort((a, b) => b.avgScore - a.avgScore);

console.log('# AI Second-Brain Method Eval');
console.log('');
console.log(`vault: ${vault}`);
console.log(`scenarios: ${scenarios.length}`);
console.log('');
console.log('| rank | method | score | file coverage | capability coverage | avg tokens |');
console.log('|---:|---|---:|---:|---:|---:|');
rows.forEach((row, idx) => {
  console.log(
    `| ${idx + 1} | ${row.method.label} | ${row.avgScore} | ${row.avgFileCoverage}% | ${row.avgCapabilityCoverage}% | ~${row.avgTokens} |`,
  );
});
console.log('');
console.log('## Scenario Detail');
console.log('');
for (const row of rows) {
  console.log(`### ${row.method.label}`);
  console.log('| scenario | score | tokens |');
  console.log('|---|---:|---:|');
  row.perScenario.forEach((result, idx) => {
    console.log(`| ${scenarios[idx].label} | ${result.score} | ~${result.tokens} |`);
  });
  console.log('');
}

const best = rows[0];
console.log('## Winner');
console.log('');
console.log(`${best.method.label} (${best.method.id})`);
