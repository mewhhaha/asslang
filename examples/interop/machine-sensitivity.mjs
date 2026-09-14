import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileSources} from '../../src/compiler.mjs';
import {createRuntime} from '../../src/abi.mjs';
import {sensitivitySource} from '../case-studies/machines/sensitivity-kernel.mjs';
const libraries=await Promise.all(['reducers','machines','machine-differentials'].map(async name=>({
  name:`${name}.ass`,source:await readFile(new URL(`../../lib/${name}.ass`,import.meta.url),'utf8'),
})));
const source=[...libraries,{name:'sensitivity.ass',source:sensitivitySource}];
const compiled=compileSources(source,{maxLoopIterations:4}),runtime=await createRuntime(compiled);
const saved={value:{left:0,right:0},tangent:{left:0,right:0}};
const args=[[0,8,8,0],[1,0,0,0],0.5,saved];
const result=runtime.call('sensitivity',args,{outputBytes:64});
assert.deepEqual([...result.values],[0,4,10,13]);
assert.deepEqual([...result.sensitivities],[0.5,0.75,0.875,0.9375]);
assert.equal(result.state.tangent.right,1-(1-args[2])**args[0].length);
assert.throws(()=>runtime.call('sensitivity',args,{outputBytes:63}),WebAssembly.RuntimeError);
const small=await createRuntime(compileSources(source,{maxLoopIterations:3}));
assert.throws(()=>small.call('sensitivity',args),WebAssembly.RuntimeError);
const first=runtime.call('sensitivity',[[0,8],[1,0],0.5,saved]);
const resumed=runtime.call('sensitivity',[[8,0],[0,0],0.5,JSON.parse(JSON.stringify(first.state))]);
assert.deepEqual(resumed.state,result.state);
// Ordinary demand: make the report helper private and export only its state.
const finalSource=sensitivitySource.replace('export fn sensitivity','fn sensitivity')+`
  export fn final = (xs:[Num]) -> (ds:[Num]) -> (alpha:Num) ->
    (saved:{value:{left:Num,right:Num},tangent:{left:Num,right:Num}}) ->
    (sensitivity xs ds alpha saved).state;
`;
const finalCompiled=compileSources([...libraries,{name:'final.ass',source:finalSource}],{maxLoopIterations:4});
const finalRuntime=await createRuntime(finalCompiled);
const finalOnly=finalRuntime.call('final',args,{outputBytes:0});
assert.deepEqual(finalOnly,result.state);
const finalStats=finalCompiled.stats.functions[0];
const f=compiled.stats.functions[0];
console.log(JSON.stringify({result,metrics:{loops:f.loops,stateSlots:f.stateSlots,loopUnits:4,
  outputArrayBytes:64,intermediateBufferBytes:compiled.stats.intermediateBufferBytes,
  wasmBytes:compiled.bytes.length,wasmLocalValueBytes:f.wasmLocalValueBytes},
  checkpoint:first.state,resumed,
  finalOnly,finalMetrics:{loops:finalStats.loops,stateSlots:finalStats.stateSlots,outputArrayBytes:0,resultDescriptorBytes:32,wasmBytes:finalCompiled.bytes.length},
  note:'One input direction per pass; alpha is held constant. Ordinary source JVP inside scan, not a compiler derivative of scan. No reverse tape or timing claim.'
},(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v,2));
