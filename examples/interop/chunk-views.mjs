import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile, instantiate } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const reports = [];
for (const [name, args, expected, units, bytes] of [
  ['block_report', [[10,13,20,18,30],2],
    {relative:[0,3,0,-2,0],totals:[0,3,3,1,1],state:{value:0,total:1,original:91}}, 5, 80],
  ['block_exposure', [[10,13,20,18,30],2], [33,58,30], 8, 24],
  ['paired_blocks', [[1,2,3,4,5],[2,3,4,5,6],2], [8,32,30], 8, 24],
]) {
  const source=await readFile(new URL(`../case-studies/chunks/${name}.ass`,import.meta.url),'utf8');
  const c=compile(source,{maxLoopIterations:units}),r=await createRuntime(c);
  const normalize=x=>ArrayBuffer.isView(x)?Array.from(x):x;
  const result=JSON.parse(JSON.stringify(r.call(name,args,{outputBytes:bytes}),(_,x)=>normalize(x)));
  assert.deepEqual(result,expected);
  assert.equal(c.abi.version,1);assert.equal(c.stats.intermediateBufferBytes,0);
  assert(!c.stats.scratchReservationSites);
  const short=await createRuntime(compile(source,{maxLoopIterations:units-1}));
  assert.throws(()=>short.call(name,args),WebAssembly.RuntimeError);
  reports.push({name,result,loopSites:c.stats.functions[0].loops,loopUnits:units,
    intermediateBytes:c.stats.intermediateBufferBytes,outputBytes:bytes,
    runtimeZipChecks:c.stats.functions[0].runtimeZipChecks,wasmBytes:c.bytes.length});
}
const c=compile('export fn main = (n:Num) -> (width:Num) -> count (chunks (range n) width);',{maxLoopIterations:0});
const f=(await instantiate(c)).exports.main;
assert.equal(f(1_000_000_000,3),333_333_334);assert.equal(c.stats.needsMemory,false);
console.log(JSON.stringify({reports,virtual:{elements:1_000_000_000,width:3,blocks:f(1_000_000_000,3),
  loopSites:c.stats.functions[0].loops,memoryImport:false},
  note:'Chunk views allocate no guest data or descriptor buffers. Final output, compiler/host memory and existing sort scratch are separate costs. No timing claim.'},null,2));
