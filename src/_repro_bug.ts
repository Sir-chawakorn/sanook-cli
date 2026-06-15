import { emptyStore, mergeFact, deriveId } from './memory-store.js';

const NOW = 1_700_000_000_000;

let r1 = mergeFact(emptyStore(), { text: 'Pick uses vercel for deploy', noteType: 'decision' }, NOW);
console.log('step1 op:', r1.op, 'id:', r1.fact?.id);
const origId = r1.fact!.id;
console.log('deriveId(orig):', deriveId('Pick uses vercel for deploy'));

let r2 = mergeFact(r1.store, { text: 'Pick does not use vercel for deploy', noteType: 'decision' }, NOW + 1000);
console.log('step2 op:', r2.op, 'new fact id:', r2.fact?.id);
console.log('facts after step2:');
for (const f of r2.store.facts) console.log('  ', f.id, f.status, JSON.stringify(f.text));

let r3 = mergeFact(r2.store, { text: 'Pick uses vercel for deploy', noteType: 'decision' }, NOW + 2000);
console.log('step3 op:', r3.op, 'new fact id:', r3.fact?.id);
console.log('facts after step3:');
for (const f of r3.store.facts) console.log('  ', f.id, f.status, JSON.stringify(f.text));

const ids = r3.store.facts.map(f => f.id);
const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
console.log('DUPLICATE IDS:', JSON.stringify([...new Set(dupIds)]));
console.log('total facts:', r3.store.facts.length, 'active:', r3.store.facts.filter(f=>f.status==='active').length);
console.log('orig id == step3 id?', origId === r3.fact?.id);
