import assert from 'node:assert/strict';
import { compile } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';
import { partitionOrder, verifyOrder } from '../research/partition-order.mjs';
import { referenceOrder } from '../research/partition-reference.mjs';
import { partitionKeySource } from '../research/partition-keys.mjs';

// A useful bridge using the EXISTING language: calculate a score in Wasm,
// then arrange original positions with the experimental host backend.
const readings = [7, 10, 4, 7, 5];
const compiled = compile(partitionKeySource, { maxLoopIterations: readings.length });
const runtime = await createRuntime(compiled);
const keys = runtime.call('distance_keys', [readings, 5]);
const ranked = partitionOrder(keys);
assert(verifyOrder(keys, ranked.indices));
assert.deepEqual([...ranked.indices], [4, 2, 0, 3, 1]);

const equal = Array(2048).fill(7), ascending = Array.from({ length: 2048 }, (_, i) => i);
const literal = referenceOrder(equal, { threeWay: false });
const region = partitionOrder(equal), protectedFirst = partitionOrder(ascending, { pivot: 'first' });
assert(verifyOrder(equal, region.indices));
assert(verifyOrder(ascending, protectedFirst.indices));
assert(protectedFirst.stats.fallbacks > 0);
console.log(JSON.stringify({
  status: 'Experimental host lowering target; proposed recursive syntax is NOT implemented',
  ranking: { readings, keys: [...keys], originalPositions: [...ranked.indices],
    values: Array.from(ranked.indices, i => readings[i]), keyKernelLoops: compiled.stats.functions[0].loops },
  allEqual: { items: equal.length, literalTwoWay: literal.stats, region: region.stats },
  adversarialFirstPivot: protectedFirst.stats,
  note: 'JS comparator counts are not Haskell or Wasm sorting timings. The original input is unchanged.',
}, null, 2));
