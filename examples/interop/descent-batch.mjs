import assert from 'node:assert/strict';
import { compileSources, planDescentQuery, descentBatchSource, verifyDescentBatch } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const graph = { nodes: ['raw', 'summary'], edges: [{ from: 'raw', to: 'summary', map: 'square' }] };
const patches = [{ name: 'a', nodes: graph.nodes }, { name: 'b', nodes: graph.nodes },
  { name: 'c', nodes: ['summary'] }, { name: 'unrelated', nodes: graph.nodes }];
const queries = [{ name: 'input', node: 'raw', left: 'a', right: 'b' },
  { name: 'output', node: 'summary', left: 'a', right: 'c' }];
const candidates = [{ node: 'raw', left: 'a', right: 'b', cost: 4 },
  { node: 'summary', left: 'b', right: 'c', cost: 1 }, { node: 'summary', left: 'a', right: 'c', cost: 3 }];
const options = { queries, candidates };
const separate = new Set(queries.flatMap(query => planDescentQuery(graph, patches, { query, candidates }).selected));
const separateCost = [...separate].reduce((sum, i) => sum + candidates[i].cost, 0);
const generated = descentBatchSource('sharedProof', graph, patches, options);
assert.equal(separateCost, 7); assert.equal(generated.plan.minimumCost, 5);
assert.deepEqual(generated.plan.frontier.minimal, [[0, 1], [0, 2]]);
assert(verifyDescentBatch(graph, patches, options, generated.plan));

const source = `fn eq = x -> y -> x==y;
  export fn values = (pieces:{a:{raw:Num,summary:Num},b:{raw:Num,summary:Num},c:{summary:Num}}) ->
    (sharedProof {square:x -> x*x}).select {raw:eq,summary:eq} pieces;`;
const runtime = await createRuntime(compileSources([generated, { name: 'app.ass', source }], { maxLoopIterations: 0 }));
const pieces = { a: { raw: 3, summary: 9 }, b: { raw: 3, summary: 9 }, c: { summary: 9 } };
const result = runtime.call('values', [pieces]);
assert.deepEqual(result, { input: 3, output: 9 });
const bad = structuredClone(pieces); bad.c.summary = 10;
assert.throws(() => runtime.call('values', [bad]), WebAssembly.RuntimeError);
console.log(JSON.stringify({
  separateCheapestUnionCost: separateCost, sharedCost: generated.plan.minimumCost,
  selected: generated.plan.selected, completeFrontier: generated.plan.frontier,
  requiredFields: generated.plan.support, localEquations: generated.plan.localEquations,
  result, incompatibleGoalRejected: true,
}, null, 2));
