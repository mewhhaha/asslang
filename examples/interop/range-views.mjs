import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSources } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const views={name:'lib/views.ass',source:await readFile(new URL('../../lib/views.ass',import.meta.url),'utf8')};
const source=`
export fn calibrate = (samples:[Num]) -> (start:Num) -> (length:Num) -> (offset:Num) ->
  map_range samples start length (x -> x+offset);

export fn corrections = (samples:[Num]) -> (start:Num) -> (length:Num) -> (offset:Num) ->
  zip samples (map_range samples start length (x -> x+offset))
    (original -> adjusted -> adjusted-original);
`;
const artifact=compileSources([views,{name:'range-view-example.ass',source}],{maxLoopIterations:4});
const runtime=await createRuntime(artifact);
const samples=[10,20,30,40];
const calibrated=runtime.call('calibrate',[samples,1,2,5]);
const corrections=runtime.call('corrections',[samples,1,2,5]);
assert.deepEqual([...calibrated],[10,25,35,40]);
assert.deepEqual([...corrections],[0,5,5,0]);
assert.equal(artifact.abi.version,1);
assert.equal(artifact.stats.intermediateBufferBytes,0);
assert.equal(artifact.stats.arrayViews.restoredDomains,4);
assert.equal(artifact.stats.functions[1].runtimeZipChecks,0);
console.log(JSON.stringify({
  calibrated:[...calibrated],corrections:[...corrections],
  abi:artifact.abi.version,wasmBytes:artifact.bytes.length,
  loops:artifact.stats.functions.map(f=>f.loops),
  restoredDomains:artifact.stats.arrayViews.restoredDomains,
  runtimeZipChecks:artifact.stats.functions.map(f=>f.runtimeZipChecks),
  intermediateBufferBytes:artifact.stats.intermediateBufferBytes,
  note:'map_range is source-defined from split_at/map/concat. Rejoining nested cut covers restores ordinary zip alignment without an intermediate guest array.'
},null,2));
