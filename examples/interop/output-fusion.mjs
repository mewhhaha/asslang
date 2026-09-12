import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSources } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

// The application source and ASABI schema are identical in both builds.
const source = await readFile(new URL('../case-studies/workflows/monitor.ass', import.meta.url), 'utf8');
const inputs = [[0, 8, 8, 0, 0], { seen: 0, mean: 0, alarm: false, raised: 0, cleared: 0 },
  { alpha: 0.5, low: 3, high: 6 }];
const reports = [];
let expected;
for (const reductionFusion of [false, true]) {
  const compiled = compileSources([{ name: 'monitor.ass', source }], { reductionFusion, maxLoopIterations: 4096 });
  const runtime = await createRuntime(compiled), result = runtime.call('monitor_chunk', inputs);
  if (expected) assert.deepEqual(result, expected);
  else expected = result;
  const s = compiled.stats.functions[0];
  assert.equal(s.loops, reductionFusion ? 1 : 3);
  assert.equal(s.stateMachines, reductionFusion ? 1 : 3);
  reports.push({ reductionFusion, loops: s.loops, stateMachines: s.stateMachines,
    scalarStateSlots: s.stateSlots, wasmBytes: compiled.bytes.length, wasmLocals: s.wasmLocals,
    outputFusion: s.outputFusion });
}
console.log(JSON.stringify({
  reports, sameResult: true,
  result: { ...expected, smoothed: Array.from(expected.smoothed) },
  note: 'Counts describe this emitted kernel, not measured throughput. Output layout and application code are unchanged.',
}, null, 2));
