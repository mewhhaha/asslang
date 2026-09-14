import { sourceBasis } from '../case-studies/core/source-basis.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile, compileSources } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const source = sourceBasis;
const prelude = await readFile(new URL('../../lib/prelude.ass',import.meta.url),'utf8');
const options = {maxLoopIterations:10};
const automatic = compile(source,options);
const explicit = compileSources([{name:'prelude.ass',source:prelude},{name:'app.ass',source}],
  {...options,prelude:false});
assert.deepEqual(automatic.bytes,explicit.bytes);
assert.deepEqual(automatic.abi,explicit.abi);
assert.deepEqual(automatic.certificate,explicit.certificate);
const runtime = await createRuntime(automatic);
const value = runtime.call('source_basis',[[1,2,3,4,5,6,7],3,{x:3,y:4}],{outputBytes:24});
assert.deepEqual([...value.blocks],[14,77,49]);
assert.deepEqual(value.gradient,{x:6,y:8});
assert.equal(value.along_x,6);assert.deepEqual(value.weighted,{x:8,y:2});
const short = await createRuntime(compile(source,{maxLoopIterations:9}));
assert.throws(()=>short.call('source_basis',[[1,2,3,4,5,6,7],3,{x:3,y:4}]),WebAssembly.RuntimeError);
console.log(JSON.stringify({value,sameWasmBytes:true,sourcePrelude:automatic.stats.sourcePrelude,
  loops:automatic.stats.functions[0].loops,loopUnits:10,finalArrayBytes:24,
  intermediateBufferBytes:automatic.stats.intermediateBufferBytes,
  note:'Identical implicit/explicit-source Wasm; final outputs and host storage still use memory. No timing claim.'},
  (_,v)=>ArrayBuffer.isView(v)?Array.from(v):v,2));
