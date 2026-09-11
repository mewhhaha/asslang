import assert from 'node:assert/strict';
import { createEvidenceAlgebra, compileSources } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const hidden = createEvidenceAlgebra(['leftValid', 'rightValid', 'reviewed']);
const [left, right, reviewed] = hidden.atoms.map(n => hidden.atom(n));
const target = hidden.all([left, right]);
const publicView = createEvidenceAlgebra(['someValid', 'reviewedPair']);
const meanings = [
  { atom: 'someValid', value: hidden.any([left, right]) },
  { atom: 'reviewedPair', value: hidden.all([target, reviewed]) },
];
const coarse = publicView.abstract(target, meanings);
assert.equal(coarse.necessary, publicView.atom('someValid'));
assert.equal(coarse.sufficient, publicView.atom('reviewedPair'));
assert.equal(coarse.exact, false);

// Refining the interface exposes the actual pair predicate. Both principal
// contracts now concretize exactly, though they differ at unreachable views.
const refined = createEvidenceAlgebra(['someValid', 'reviewedPair', 'pairValid']);
const richerMeanings = [...meanings, { atom: 'pairValid', value: target }];
const precise = refined.abstract(target, richerMeanings);
assert(precise.exact); assert.equal(precise.obstruction, null);
const pull = (d, f, mapping) => hidden.substitute(f, mapping.filter(b => d.inspect(f).support.includes(b.atom)));
const conservative = pull(publicView, coarse.sufficient, meanings);
const exact = pull(refined, precise.sufficient, richerMeanings);
assert.equal(conservative, hidden.all([target, reviewed])); assert.equal(exact, target);

// The runtime receives CURRENT inputs, not trusted summary flags from a caller.
const compiled = compileSources([
  hidden.source('conservativeGate', conservative), hidden.source('preciseGate', exact),
  { name: 'app.ass', source: `
    export fn conservative = (left:Num) -> (right:Num) -> (reviewed:Bool) ->
      require (conservativeGate {leftValid:left>=0,rightValid:right>=0,reviewed}) (left+right);
    export fn precise = (left:Num) -> (right:Num) ->
      require (preciseGate {leftValid:left>=0,rightValid:right>=0}) (left+right);
  ` },
], { maxLoopIterations: 0 });
const runtime = await createRuntime(compiled);
assert.equal(runtime.call('conservative', [3, 4, true]), 7);
assert.throws(() => runtime.call('conservative', [3, 4, false]), WebAssembly.RuntimeError);
assert.equal(runtime.call('precise', [3, 4]), 7);
assert.throws(() => runtime.call('precise', [-1, 4]), WebAssembly.RuntimeError);
assert(publicView.evaluate(coarse.necessary, ['someValid'])); // Necessary alone is NOT admission.

const many = createEvidenceAlgebra(Array.from({ length: 96 }, (_, i) => `x${i}`));
const pairs = Array.from({ length: 48 }, (_, i) => many.any([many.atom(`x${2*i}`), many.atom(`x${2*i+1}`)]));
const all = many.all(pairs);
const compact = createEvidenceAlgebra(Array.from({ length: 48 }, (_, i) => `pair${i}`));
const before = many.stats.nodes;
const summary = compact.abstract(all, pairs.map((value, i) => ({ atom: `pair${i}`, value })));
assert(summary.exact); assert.equal(many.stats.nodes, before);
assert.equal(compact.inspect(summary.sufficient).decisionNodes, 48);
console.log(JSON.stringify({
  coarse: { necessary: publicView.inspect(coarse.necessary).support,
    sufficient: publicView.inspect(coarse.sufficient).support, exact: coarse.exact, obstruction: coarse.obstruction },
  refined: { exact: precise.exact, privateAdmissionSupport: hidden.inspect(exact).support },
  currentDataResult: runtime.call('precise', [3, 4]),
  structured: { privateAtoms: 96, privateMinimalSupports: '2^48', publicAtoms: 48,
    publicDecisionNodes: compact.inspect(summary.sufficient).decisionNodes, privateSessionUnchanged: true },
}, null, 2));
