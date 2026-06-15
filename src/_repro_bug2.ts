import { emptyStore, mergeFact, consolidate, renderPromptBlock } from './memory-store.js';

const NOW = 1_700_000_000_000;

let s = mergeFact(emptyStore(), { text: 'Pick uses vercel for deploy', noteType: 'decision' }, NOW).store;
s = mergeFact(s, { text: 'Pick does not use vercel for deploy', noteType: 'decision' }, NOW + 1000).store;
const r3 = mergeFact(s, { text: 'Pick uses vercel for deploy', noteType: 'decision' }, NOW + 2000);
s = r3.store;

console.log('=== edge state after collision ===');
for (const f of s.facts) {
  console.log(`id=${f.id} status=${f.status} text=${JSON.stringify(f.text)} supersededBy=${f.supersededBy} supersedes=${JSON.stringify(f.supersedes)}`);
}

// Consequence: the step-2 fact's `supersedes:['m_XsBkwD']` is now ambiguous.
// And the active fact (m_XsBkwD) has supersedes=['m_ILWzAA'] pointing to a superseded fact.
// Let's simulate a downstream "find by id" the way report consumers / future code would:
const findById = (id: string) => s.facts.filter(f => f.id === id);
console.log('\nfindById(m_XsBkwD) returns', findById('m_XsBkwD').length, 'facts (one superseded, one active) — AMBIGUOUS');

// === Can TWO ACTIVE facts collide on id? ===
// Try: re-add original BEFORE superseding (different tier path won't help). 
// Try a different-tier re-add (deriveId is text-only, tier not in hash):
let t = mergeFact(emptyStore(), { text: 'foo bar baz qux', noteType: 'fact', tier: 'durable' }, NOW).store;
// supersede it to free up the active text? No. Instead add same text to a different tier:
const t2 = mergeFact(t, { text: 'foo bar baz qux', noteType: 'fact', tier: 'protected' }, NOW + 1000);
console.log('\n=== same text, different tier ===');
console.log('op:', t2.op);
for (const f of t2.store.facts) console.log(`  id=${f.id} tier=${f.tier} status=${f.status}`);
const activeIds = t2.store.facts.filter(f=>f.status==='active').map(f=>f.id);
console.log('two ACTIVE facts share id?', activeIds.length === 2 && activeIds[0] === activeIds[1]);

// Now consolidate the collision store and see what report.merged / edges look like
console.log('\n=== consolidate on collision store ===');
const c = consolidate(s, NOW + 3000);
console.log('report:', JSON.stringify(c.report));
