import assert from 'node:assert/strict';
import { compileSources, planReconstruction, reconstructionSource } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

// Two cyclic source components feed a shared sink. Only a1 and b2 are retained.
const graph = {
  nodes: ['a0', 'a1', 'b0', 'b1', 'b2', 'sink'],
  edges: [
    { from: 'a0', to: 'a1', map: 'flip' },
    { from: 'a1', to: 'a0', map: 'flip' },
    { from: 'b0', to: 'b1', map: 'identity' },
    { from: 'b1', to: 'b2', map: 'identity' },
    { from: 'b2', to: 'b0', map: 'identity' },
    { from: 'a0', to: 'sink', map: 'zero' },
    { from: 'b0', to: 'sink', map: 'zero' },
  ],
};
const generated = reconstructionSource('observations', graph, { observed: ['a1', 'b2'] });
const compiled = compileSources([generated, {
  name: 'restore.ass',
  source: `
    fn equal = x -> y -> x == y;
    export fn restore = (seed:{a1:Num,b2:Num}) -> do {
      let protocol = observations {flip:x -> -x,identity:x -> x,zero:x -> 0};
      let value = protocol.restore seed;
      let same = {a0:equal,a1:equal,b0:equal,b1:equal,b2:equal,sink:equal};
      require (protocol.check same value) value
    };
  `,
}]);
const runtime = await createRuntime(compiled);
const value = runtime.call('restore', [{ a1: 3, b2: 7 }]);
assert.deepEqual(value, { a0: -3, a1: 3, b0: 7, b1: 7, b2: 7, sink: 0 });
assert.deepEqual(generated.plan.basis, ['a1', 'b2']);
assert.equal(generated.plan.minimumDistance, 2);
const lostComponent = planReconstruction(graph, { observed: ['a1', 'sink'] });
assert.equal(lostComponent.complete, false);
assert.deepEqual(lostComponent.missingComponents, [['b0', 'b1', 'b2']]);
console.log(JSON.stringify({
  basis: generated.plan.basis,
  sourceComponents: generated.plan.sourceComponents,
  universalMinimumDistance: generated.plan.minimumDistance,
  restored: value,
  missingWhenOnlyAAndSinkSurvive: lostComponent.missingComponents,
}, null, 2));
