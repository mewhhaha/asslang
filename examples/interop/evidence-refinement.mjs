import assert from 'node:assert/strict';
import { createEvidenceAlgebra, compileSources } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const hidden = createEvidenceAlgebra(['calibrated', 'leftValid', 'rightValid']);
const [calibrated, left, right] = hidden.atoms.map(n => hidden.atom(n));
const targets = [
  { name: 'leftReady', value: hidden.all([calibrated, left]) },
  { name: 'rightReady', value: hidden.all([calibrated, right]) },
];
const retained = [{ atom: 'leftValid', value: left }, { atom: 'rightValid', value: right }];
const candidates = [
  { atom: 'calibrated', value: calibrated, cost: 3 },
  { atom: 'leftReady', value: targets[0].value, cost: 2 },
  { atom: 'rightReady', value: targets[1].value, cost: 2 },
];
const options = { retained, candidates };
const before = hidden.stats.nodes;
const separate = new Set(targets.flatMap(t => hidden.refine([t], options).selected));
const separateCost = [...separate].reduce((sum, i) => sum + candidates[i].cost, 0);
const plan = hidden.refine(targets, options);
assert(hidden.verifyRefinement(targets, options, plan));
assert.equal(hidden.stats.nodes, before);
assert.equal(separateCost, 4);
assert.equal(plan.minimumCost, 3);
assert.deepEqual(plan.selected, [0]);

// Selection is not runtime evidence. Compute every exposed flag on CURRENT data.
const bindings = [...retained, ...plan.selected.map(i => candidates[i])];
const view = createEvidenceAlgebra(bindings.map(b => b.atom));
const sources = targets.map(t => {
  const inferred = view.abstract(t.value, bindings);
  assert(inferred.exact);
  return view.source(t.name, inferred.sufficient);
});
const runtime = await createRuntime(compileSources([...sources, {
  name: 'app.ass', source: `
    export fn accept = (calibration:Num) -> (left:Num) -> (right:Num) -> do {
      let view={calibrated:calibration>=0,leftValid:left>=0,rightValid:right>=0};
      require ((leftReady view) && (rightReady view)) {left,right,total:left+right}
    };
  `,
}], { maxLoopIterations: 0 }));
assert.deepEqual(runtime.call('accept', [1, 3, 4]), { left: 3, right: 4, total: 7 });
assert.throws(() => runtime.call('accept', [-1, 3, 4]), WebAssembly.RuntimeError);
assert.throws(() => runtime.call('accept', [1, 3, -4]), WebAssembly.RuntimeError);
console.log(JSON.stringify({
  separateAdditionalCost: separateCost,
  sharedAdditionalCost: plan.minimumCost,
  addedPublicSummaries: plan.selected.map(i => candidates[i].atom),
  certificate: plan,
  publicRequirements: sources.map(s => ({ name: s.name, support: s.support })),
  currentDataResult: runtime.call('accept', [1, 3, 4]),
  privateSessionUnchanged: hidden.stats.nodes === before,
}, null, 2));
