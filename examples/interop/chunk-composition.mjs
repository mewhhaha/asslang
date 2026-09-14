import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile,instantiate} from '../../src/compiler.mjs';
import {createRuntime} from '../../src/abi.mjs';

const input=[1,2,3,4,5,6,7],width=3,reports=[];
const expectations={
  block_report:{local:[1,3,6,4,9,15,7],totals:[1,3,6,10,15,21,28],state:{local:7,total:28}},
  block_energy:[14,77,49],block_center:[-1,0,1,-1,0,1,0],
};
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
for(const [name,units,outputBytes] of [['block_report',7,112],['block_energy',10,24],['block_center',14,56]]) {
  const source=await readFile(new URL(`../case-studies/chunk-scans/${name}.ass`,import.meta.url),'utf8');
  const artifact=compile(source,{maxLoopIterations:units});
  const runtime=await createRuntime(artifact),result=plain(runtime.call(name,[input,width],{outputBytes}));
  assert.deepEqual(result,expectations[name]);assert.equal(artifact.stats.intermediateBufferBytes,0);
  const short=await createRuntime(compile(source,{maxLoopIterations:units-1}));
  assert.throws(()=>short.call(name,[input,width]),WebAssembly.RuntimeError);
  assert.throws(()=>runtime.call(name,[input,width],{outputBytes:outputBytes-1}),WebAssembly.RuntimeError);
  const f=artifact.stats.functions[0];
  reports.push({name,result,loopSites:f.loops,loopUnits:units,stateMachines:f.stateMachines,
    stateSlots:f.stateSlots,intermediateBufferBytes:0,outputBytes,wasmBytes:artifact.bytes.length,
    runtimeZipChecks:f.runtimeZipChecks});
}
const scalar=compile('export fn main = (n:Num) -> (w:Num) -> (i:Num) -> at (range n |> chunks w |> map (b -> count b)) i;',{maxLoopIterations:0});
assert.equal(scalar.stats.needsMemory,false);assert.equal(scalar.stats.functions[0].loops,0);
const finalBlock=(await instantiate(scalar)).exports.main(1e9,3,333333333);assert.equal(finalBlock,1);
console.log(JSON.stringify({reports,virtualBillion:{lastBlockLength:finalBlock,loops:0,linearMemory:false},
  note:'Native Wasm. Blocks and boundary flags are not stored. Final arrays still need output space; no timing claim.'},null,2));
