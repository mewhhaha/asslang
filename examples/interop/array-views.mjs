import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile, instantiate } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const source = await readFile(new URL('../case-studies/views/section_report.ass',import.meta.url),'utf8');
const args = [[1,2,3,4],{cut:2,leftGain:10,rightGain:100}];
const c = compile(source,{maxLoopIterations:4});
const result = (await createRuntime(c)).call('section_report',args,{outputBytes:64});
assert.deepEqual([...result.values],[10,20,300,400]);
assert.deepEqual([...result.totals],[10,30,330,730]);
assert.equal(result.state.correction,720);
const separate = compile(source,{reductionFusion:false,maxLoopIterations:12});
assert.deepEqual((await createRuntime(separate)).call('section_report',args,{outputBytes:64}),result);
const short = await createRuntime(compile(source,{maxLoopIterations:3}));
assert.throws(()=>short.call('section_report',args),WebAssembly.RuntimeError);

// The range is a formula. The lookup never materializes a billion-element array.
const lookup = `export fn rotated_first = (size:Num) -> (cut:Num) -> do {
  let {left,right}=split_at (range size) cut;
  at (concat right left) 0
};`;
const virtual = compile(lookup,{maxLoopIterations:0});
const value = (await instantiate(virtual)).exports.rotated_first(1_000_000_000,600_000_000);
assert.equal(value,600_000_000);
assert.equal(virtual.stats.needsMemory,false);
assert.equal(virtual.stats.functions[0].loops,0);
const metric = artifact => ({loops:artifact.stats.functions[0].loops,
  stateMachines:artifact.stats.functions[0].stateMachines,
  runtimeZipChecks:artifact.stats.functions[0].runtimeZipChecks,
  intermediateBufferBytes:artifact.stats.intermediateBufferBytes,
  abiVersion:artifact.abi.version,wasmBytes:artifact.bytes.length});
console.log(JSON.stringify({
  sectionReport:{...metric(c),loopUnits:4,arrayOutputBytes:64,result},
  separateConsumers:{...metric(separate),loopUnits:12},
  virtualRange:{...metric(virtual),logicalLength:1_000_000_000,value,memoryImported:virtual.stats.needsMemory},
  note:'Views allocate no intermediate guest buffers. Final arrays and any existing sort scratch still require memory; these are execution/storage counts, not timing claims.',
},(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v,2));
