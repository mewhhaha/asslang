import assert from 'node:assert/strict';
import { createEvidenceAlgebra, compileSources } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const hidden = createEvidenceAlgebra(['shared', 'leftFallback', 'rightFallback']);
const [shared, left, right] = hidden.atoms.map(n => hidden.atom(n));
const bindings = [
  { atom: 'leftReady', value: hidden.any([shared, left]) },
  { atom: 'rightReady', value: hidden.any([shared, right]) },
];
const before = hidden.stats.nodes;
const audit = hidden.auditTransport(bindings);
assert(audit.preservesImplication);
const prices = hidden.atoms.map((atom, i) => ({ atom, cost: [3, 2, 2][i] }));
const first = hidden.liftEvidence(bindings, [], ['leftReady'], prices);
const second = hidden.liftEvidence(bindings, first.facts, ['leftReady', 'rightReady'], prices);
const direct = hidden.liftEvidence(bindings, [], ['leftReady', 'rightReady'], prices);
assert.equal(first.cost + second.cost, 4);
assert.deepEqual(direct, { facts: ['shared'], added: ['shared'], cost: 3 });
assert.equal(hidden.stats.nodes, before);

// Compute the conditional requirement ONCE in the reusable public vocabulary.
// The audit's lifting theorem licenses transporting every such public residual.
const pub = createEvidenceAlgebra(['leftReady', 'rightReady']);
const p = pub.atom('leftReady'), q = pub.atom('rightReady');
const publicResidual = pub.residual(p, pub.all([p, q]));
const translated = hidden.substitute(publicResidual, bindings.filter(b => pub.inspect(publicResidual).support.includes(b.atom)));
assert.equal(translated, hidden.residual(bindings[0].value, hidden.all(bindings.map(b => b.value))));
const compiled = compileSources([pub.source('additional', publicResidual), {
  name: 'app.ass', source: `
    export fn accept = (shared:Num) -> (left:Num) -> (right:Num) -> do {
      let view={leftReady:shared>=0 || left>=0,rightReady:shared>=0 || right>=0};
      // A lift is only a proposed valuation. Recheck CURRENT facts and guarantee.
      require (view.leftReady && additional view) {sum:shared+left+right}
    };
  `,
}], { maxLoopIterations: 0 });
const runtime = await createRuntime(compiled);
assert.deepEqual(runtime.call('accept', [3, -1, -1]), { sum: 1 });
assert.throws(() => runtime.call('accept', [-3, -1, -1]), WebAssembly.RuntimeError);
assert.throws(() => runtime.call('accept', [-3, 1, -1]), WebAssembly.RuntimeError);
assert.throws(() => runtime.call('accept', [-3, -1, 1]), WebAssembly.RuntimeError);

// A redundant public flag breaks conditional transport: x and y cannot be
// enabled independently when both mean the same private fact.
const bad = hidden.auditTransport([{ atom: 'x', value: shared }, { atom: 'y', value: shared }]);
assert(!bad.preservesImplication);
assert.equal(hidden.liftEvidence([{ atom: 'x', value: shared }, { atom: 'y', value: shared }],
  bad.obstruction.current, bad.obstruction.requested), null);

const large = createEvidenceAlgebra(Array.from({ length: 128 }, (_, i) => `a${i}`));
const pairs = Array.from({ length: 64 }, (_, i) => ({ atom: `p${i}`,
  value: large.any([large.atom(`a${2*i}`), large.atom(`a${2*i+1}`)]) }));
assert(large.auditTransport(pairs).preservesImplication);
const chosen = large.liftEvidence(pairs, [], pairs.map(p => p.atom));
assert.equal(chosen.cost, 64);
console.log(JSON.stringify({
  audit,
  directMinimumLift: direct,
  sequentialMinimumLifts: { first, second, totalCost: first.cost + second.cost },
  nonTransportingInterface: bad,
  currentDataResult: runtime.call('accept', [3, -1, -1]),
  structuredCase: { privateAtoms: 128, publicAtoms: 64, possiblePrivateAssignments: '2^128',
    minimalLiftsToFullView: '2^64', selectedAddedFacts: chosen.added.length, cost: chosen.cost },
}, null, 2));
