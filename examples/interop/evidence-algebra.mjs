import assert from 'node:assert/strict';
import { createEvidenceAlgebra, compileSources, planDescentBatch, verifyDescentBatch } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

// A component speaks its own vocabulary. Its caller binds concrete evidence.
const component = createEvidenceAlgebra(['inputs', 'outputs']);
const contract = component.all([component.atom('inputs'), component.atom('outputs')]);
const caller = createEvidenceAlgebra(['raw', 'viaMiddle', 'direct', 'coherent']);
const raw = caller.atom('raw'), summary = caller.any([caller.atom('viaMiddle'), caller.atom('direct')]);
const instantiated = caller.substitute(contract, [
  { atom: 'inputs', value: raw }, { atom: 'outputs', value: summary },
]);
// Ask for what is missing only AFTER instantiating the component.
const missing = caller.residual(summary, instantiated);
assert.equal(missing, raw);

// Connect the symbolic component to the earlier certified descent frontier.
const graph = { nodes: ['raw', 'summary'], edges: [{ from: 'raw', to: 'summary', map: 'square' }] };
const patches = [{ name: 'a', nodes: graph.nodes }, { name: 'b', nodes: graph.nodes }, { name: 'c', nodes: ['summary'] }];
const options = {
  queries: [{ name: 'input', node: 'raw', left: 'a', right: 'b' }, { name: 'output', node: 'summary', left: 'a', right: 'c' }],
  candidates: [{ node: 'raw', left: 'a', right: 'b', cost: 4 }, { node: 'summary', left: 'b', right: 'c', cost: 1 }, { node: 'summary', left: 'a', right: 'c', cost: 3 }],
};
const plan = planDescentBatch(graph, patches, options);
assert(verifyDescentBatch(graph, patches, options, plan));
const imported = caller.fromFrontier(plan.frontier.minimal.map(s => s.map(i => caller.atoms[i])));
assert.equal(imported, instantiated);
const guarded = caller.all([caller.atom('coherent'), summary, missing]);
const generated = caller.source('acceptEvidence', guarded);
const r = await createRuntime(compileSources([generated, { name: 'app.ass', source: `
  export fn values = (p:{a:{raw:Num,summary:Num},b:{raw:Num,summary:Num},c:{summary:Num}}) -> do {
    // Recheck CURRENT facts and all local equations used in this example.
    let facts = {
      raw:p.a.raw==p.b.raw,
      viaMiddle:p.b.summary==p.c.summary,
      direct:p.a.summary==p.c.summary,
      coherent:p.a.raw*p.a.raw==p.a.summary && p.b.raw*p.b.raw==p.b.summary
    };
    require (acceptEvidence facts) {input:p.a.raw,output:p.a.summary}
  };
` }], { maxLoopIterations: 0 }));
const good = { a: { raw: 3, summary: 9 }, b: { raw: 3, summary: 9 }, c: { summary: 9 } };
assert.deepEqual(r.call('values', [good]), { input: 3, output: 9 });
const stale = structuredClone(good); stale.b.raw = -3;
assert.throws(() => r.call('values', [stale]), WebAssembly.RuntimeError);
const inconsistent = structuredClone(good); inconsistent.a.summary = 10;
assert.throws(() => r.call('values', [inconsistent]), WebAssembly.RuntimeError);
const falseGuarantee = structuredClone(good); falseGuarantee.c.summary = 10;
assert.throws(() => r.call('values', [falseGuarantee]), WebAssembly.RuntimeError);

const large = createEvidenceAlgebra(Array.from({ length: 96 }, (_, i) => `a${i}`));
const choices = large.all(Array.from({ length: 48 }, (_, i) =>
  large.any([large.atom(`a${2 * i}`), large.atom(`a${2 * i + 1}`)])));
assert.equal(large.inspect(choices).decisionNodes, 96);
console.log(JSON.stringify({
  importedCertifiedFrontier: plan.frontier.minimal,
  principalAdditionalAtoms: caller.inspect(missing).support,
  minimumEvidence: caller.minimum(instantiated, caller.atoms.slice(0, 3).map((atom, i) => ({ atom, cost: [4, 1, 3][i] }))),
  guardedResult: r.call('values', [good]),
  structuredExample: { atoms: 96, minimalSupports: '2^48', reachableDecisionNodes: large.inspect(choices).decisionNodes,
    retainedSessionNodes: large.stats.nodes, minimumUnitCost: large.minimum(choices).cost },
}, null, 2));
