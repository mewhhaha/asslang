import assert from 'node:assert/strict';
import { compileSources, descentSource, verifyDescent } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

// Three independently produced records share downstream observations.
const graph = {
  nodes: ['x', 'y', 'z'],
  edges: [
    { from: 'x', to: 'z', map: 'zero' },
    { from: 'y', to: 'z', map: 'zero' },
  ],
};
const patches = [
  { name: 'left', nodes: ['x', 'z'] },
  { name: 'middle', nodes: ['x', 'y', 'z'] },
  { name: 'right', nodes: ['y', 'z'] },
];
const generated = descentSource('assemble', graph, patches);
assert.equal(generated.plan.minimumComparisons, 2);
assert.equal(generated.plan.naiveComparisons, 5);
assert(verifyDescent(graph, patches, generated.plan.comparisons));
assert.equal(verifyDescent(graph, patches, generated.plan.comparisons.slice(1)), false);

const shape = '{left:{x:Num,z:Num},middle:{x:Num,y:Num,z:Num},right:{y:Num,z:Num}}';
const compiled = compileSources([generated, {
  name: 'descent-app.ass',
  source: `
    // This example uses finite numbers and constant maps. Equality must be
    // transitive and respected by maps; approximate predicates need not be.
    fn equal = x -> y -> x == y;
    export fn join = (pieces:${shape}) ->
      (assemble {zero:x -> 0}).join {x:equal,y:equal,z:equal} pieces;
    export fn agree = (pieces:${shape}) ->
      (assemble {zero:x -> 0}).agree {x:equal,y:equal} pieces;
  `,
}], { maxLoopIterations: 0 });
const runtime = await createRuntime(compiled);
const pieces = { left: { x: 3, z: 0 }, middle: { x: 3, y: 7, z: 0 }, right: { y: 7, z: 0 } };
const value = runtime.call('join', [pieces]);
assert.deepEqual(value, { x: 3, y: 7, z: 0 });

// Minimum overlap checks assume local coherence; join validates it explicitly.
const incoherent = structuredClone(pieces); incoherent.middle.z = 99;
assert.equal(runtime.call('agree', [incoherent]), true);
assert.throws(() => runtime.call('join', [incoherent]), WebAssembly.RuntimeError);
const incompatible = structuredClone(pieces); incompatible.left.x = 4;
assert.equal(runtime.call('agree', [incompatible]), false);
assert.throws(() => runtime.call('join', [incompatible]), WebAssembly.RuntimeError);
console.log(JSON.stringify({
  naiveOverlapComparisons: generated.plan.naiveComparisons,
  minimumOverlapComparisons: generated.plan.minimumComparisons,
  certificate: generated.plan.comparisons,
  joined: value,
  incompleteCertificateRejected: true,
  localIncoherenceRejectedByJoin: true,
  incompatiblePiecesRejected: true,
}, null, 2));
