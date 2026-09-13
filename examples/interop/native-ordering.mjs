import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';
import { verifyOrder } from '../research/partition-order.mjs';

const source=await readFile(new URL('../case-studies/ordering/ranked_readings.ass',import.meta.url),'utf8');
const readings=[7,10,4,7,5],center=5;
const compiled=compile(source,{maxLoopIterations:39});
const runtime=await createRuntime(compiled);
const result=runtime.call('rank_readings',[readings,center],{scratchBytes:240,outputBytes:80});
assert.deepEqual([...result.positions],[4,2,0,3,1]);
assert(verifyOrder(readings.map(x=>Math.abs(x-center)),[...result.positions]));
const imports=WebAssembly.Module.imports(new WebAssembly.Module(compiled.bytes));
assert(imports.every(x=>x.kind==='memory'));
const short=await createRuntime(compile(source,{maxLoopIterations:38}));
assert.throws(()=>short.call('rank_readings',[readings,center]),WebAssembly.RuntimeError);
console.log(JSON.stringify({
  backend:'Asslang/WebAssembly for keys, stable ordering and output projection',
  readings,center,result,abiVersion:compiled.abi.version,imports,
  scratchBytes:240,outputBytes:80,minimumLoopAllowance:39,
  wasmBytes:compiled.bytes.length,ordering:compiled.stats.functions[0].ordering,
  note:'Native finite ordering substrate. General partition_rec elaboration remains unimplemented.',
},(_,value)=>ArrayBuffer.isView(value)?Array.from(value):value,2));
