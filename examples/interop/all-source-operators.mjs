import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile} from '../../src/compiler.mjs';
import {createRuntime} from '../../src/abi.mjs';
const source=await readFile(new URL('../case-studies/notation/source_policy.ass',import.meta.url),'utf8');
const compiled=compile(source),runtime=await createRuntime(compiled);
const value=runtime.call('source_policy',[0.25,0.5,0.125]);
assert.deepEqual(value,{allowed:true,score:0.5});
const pipeline=`export fn main = (x:Num) -> do {
  infixl (|>) = value -> transform -> {before:value,after:transform value};
  x |> (n -> n*n)
};`;
const piped=(await createRuntime(compile(pipeline))).call('main',[3]);
assert.deepEqual(piped,{before:3,after:9});
console.log(JSON.stringify({policy:value,pipeline:piped,
  operators:{binary:13,prefix:2,implementation:'lib/expression-operators.ass'},
  policyCost:{wasmBytes:compiled.bytes.length,loops:compiled.stats.functions[0].loops,
    intermediateBufferBytes:compiled.stats.intermediateBufferBytes},
  note:'All expression meanings are source factories; parsing and scalar instructions remain compiler mechanisms.'},null,2));
