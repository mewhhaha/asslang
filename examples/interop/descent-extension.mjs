import assert from 'node:assert/strict';
import { compileSources, planDescentExtension, descentExtensionSource } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

// Alias coordinates are interchangeable for lawful identity maps. A cheap test
// of the downstream summary alone cannot establish agreement at the source.
const graph = { nodes: ['x', 'alias', 'summary'], edges: [
  { from: 'x', to: 'alias', map: 'id' }, { from: 'alias', to: 'x', map: 'id' },
  { from: 'x', to: 'summary', map: 'zero' },
] };
const patches = ['a', 'b', 'c', 'd'].map(name => ({ name, nodes: graph.nodes }));
const retained = [{ node: 'x', left: 'a', right: 'b' }];
const candidates = [
  { node: 'x', left: 'a', right: 'c', cost: 9 },
  { node: 'alias', left: 'b', right: 'c', cost: 2 },
  { node: 'x', left: 'c', right: 'd', cost: 1 },
  { node: 'alias', left: 'a', right: 'd', cost: 8 },
  { node: 'summary', left: 'b', right: 'd', cost: 0 },
];
const generated = descentExtensionSource('extend', graph, patches, { retained, candidates });
assert.equal(generated.plan.minimumCost, 3);
assert.equal(generated.plan.minimumAdditional, 2);
assert.deepEqual(generated.plan.selected, [2, 1]);
const shape = '{a:{x:Num,alias:Num,summary:Num},b:{x:Num,alias:Num,summary:Num},c:{x:Num,alias:Num,summary:Num},d:{x:Num,alias:Num,summary:Num}}';
const compiled = compileSources([generated, { name: 'app.ass', source: `
  fn eq = x -> y -> x==y;
  export fn join = (p:${shape}) -> (extend {id:x -> x,zero:x -> 0}).join {x:eq,alias:eq,summary:eq} p;
  export fn extra = (p:${shape}) -> (extend {id:x -> x,zero:x -> 0}).checkAdditional {x:eq,alias:eq} p;
`}], { maxLoopIterations: 0 });
const runtime = await createRuntime(compiled);
const pieces = Object.fromEntries(patches.map(p => [p.name, { x: 5, alias: 5, summary: 0 }]));
const joined = runtime.call('join', [pieces]);
assert.deepEqual(joined, { x: 5, alias: 5, summary: 0 });

// A caller cannot turn an old equality into a trusted runtime token. Only the
// explicitly conditional method omits it; the full join always rechecks it.
const stale = structuredClone(pieces); stale.a.x = stale.a.alias = 9;
assert.equal(runtime.call('extra', [stale]), true);
assert.throws(() => runtime.call('join', [stale]), WebAssembly.RuntimeError);
const impossible = planDescentExtension(graph, patches, { retained, candidates: [candidates[2]] });
assert.equal(impossible.complete, false);
console.log(JSON.stringify({
  rank: generated.plan.rank,
  retainedRank: generated.plan.retainedRank,
  additionalComparisons: generated.plan.additional,
  additionalCost: generated.plan.minimumCost,
  fixedStarAdditionalCost: 17,
  joined,
  staleRetainedFactRejectedByFullJoin: true,
  unavailableComparisonObstruction: impossible.obstruction,
}, null, 2));
