import assert from 'node:assert/strict';
import { compileSources, descentQuerySource, planDescentExtension, verifyDescentQuery } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const graph = { nodes: ['raw', 'summary'], edges: [{ from: 'raw', to: 'summary', map: 'square' }] };
const patches = [
  { name: 'a', nodes: graph.nodes }, { name: 'b', nodes: graph.nodes },
  { name: 'c', nodes: ['summary'] }, { name: 'unrelated', nodes: graph.nodes },
];
const candidates = [
  { node: 'raw', left: 'a', right: 'b', cost: 1 },
  { node: 'summary', left: 'b', right: 'c', cost: 2 },
  { node: 'summary', left: 'a', right: 'c', cost: 9 },
];
const options = { query: { node: 'summary', left: 'a', right: 'c' }, candidates };
const generated = descentQuerySource('summaryProof', graph, patches, options);
assert.equal(generated.plan.minimumCost, 3);
assert(verifyDescentQuery(graph, patches, options, generated.plan.proof));
assert.equal(planDescentExtension(graph, patches, { candidates }).complete, false);
// Only proof-support fields are needed. The unrelated patch is not an input.
const source = `fn eq = x -> y -> x==y;
  export fn summary = (pieces:{a:{raw:Num,summary:Num},b:{raw:Num,summary:Num},c:{summary:Num}}) ->
    (summaryProof {square:x -> x*x}).select {raw:eq,summary:eq} pieces;`;
const runtime = await createRuntime(compileSources([generated, { name: 'app.ass', source }], { maxLoopIterations: 0 }));
const pieces = { a: { raw: 3, summary: 9 }, b: { raw: 3, summary: 9 }, c: { summary: 9 } };
assert.equal(runtime.call('summary', [pieces]), 9);
const incoherent = structuredClone(pieces); incoherent.a.summary = 10;
assert.throws(() => runtime.call('summary', [incoherent]), WebAssembly.RuntimeError);
console.log(JSON.stringify({
  goal: generated.plan.query, minimumEvidenceCost: generated.plan.minimumCost,
  proof: generated.plan.proof, requiredFields: generated.plan.support,
  localEquations: generated.plan.localEquations,
  globalCompletionPossible: false, selectedValue: runtime.call('summary', [pieces]),
}, null, 2));
