import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileSources} from '../../src/compiler.mjs';
import {createRuntime} from '../../src/abi.mjs';
import {feedbackSensitivitySource} from '../case-studies/feedback/sensitivity-kernel.mjs';

const libraries=await Promise.all(['reducers','machines','machine-feedback'].map(async name=>({name:name+'.ass',
  source:await readFile(new URL('../../lib/'+name+'.ass',import.meta.url),'utf8')})));
const load=async name=>({name:name+'.ass',source:await readFile(new URL('../case-studies/feedback/'+name+'.ass',import.meta.url),'utf8')});
const q=await load('quantize'),xs=Array(8).fill(0.25),saved={left:0,right:0};
const source=[...libraries,q],compiled=compileSources(source,{maxLoopIterations:8});
const runtime=await createRuntime(compiled),quantized=runtime.call('quantize',[xs,1,saved],{outputBytes:64});
assert.deepEqual([...quantized.values],[0,1,0,0,0,1,0,0]);
const checkpoint=runtime.call('quantize',[xs.slice(0,3),1,saved]).state;
const resumed=runtime.call('quantize',[xs.slice(3),1,JSON.parse(JSON.stringify(checkpoint))]);
assert.deepEqual([...resumed.values],[0,0,1,0,0]);
const blocks=runtime.call('quantize_blocks',[xs,1,3],{outputBytes:64});
assert.deepEqual([...blocks],[0,1,0,0,1,0,0,1]);
const expanded=q.source.replace('machine_feedback circuit (state -> state.left-state.right)',
  '{initial:circuit.initial,step:state -> input -> circuit.step state {input,feedback:state.left-state.right},finish:circuit.finish}');
assert.deepEqual(compiled.bytes,compileSources([...libraries,{...q,source:expanded}],{maxLoopIterations:8}).bytes);
const short=await createRuntime(compileSources(source,{maxLoopIterations:7}));
assert.throws(()=>short.call('quantize',[xs,1,saved]),WebAssembly.RuntimeError);
assert.throws(()=>runtime.call('quantize',[xs,1,saved],{outputBytes:63}),WebAssembly.RuntimeError);
const final=compileSources([...libraries,{...q,source:q.source.replace('values:history |> map machine.finish,','')}],{maxLoopIterations:8});
assert.deepEqual((await createRuntime(final)).call('quantize',[xs,1,saved],{outputBytes:0}),{state:quantized.state});

const tracker=await load('tracking'),differential={name:'machine-differentials.ass',
  source:await readFile(new URL('../../lib/machine-differentials.ass',import.meta.url),'utf8')};
const sensitivity=compileSources([...libraries,differential,tracker,{name:'sensitivity.ass',source:feedbackSensitivitySource}],{maxLoopIterations:4});
const sr=await createRuntime(sensitivity),result=sr.call('tracking_sensitivity',[[1,1,1,1],[1,0,0,0],0.5,{value:saved,tangent:saved}],{outputBytes:64});
assert.deepEqual([...result.values],[0.5,0.75,0.875,0.9375]);
assert.deepEqual([...result.tangents],[0.5,0.25,0.125,0.0625]);
const measure=(artifact,name,units,outputBytes)=>{
  const f=artifact.stats.functions.find(f=>f.name===name),e=artifact.abi.exports.find(e=>e.name===name);
  return {name,loops:f.loops,stateSlots:f.stateSlots,localValueBytes:f.wasmLocalValueBytes,
    loopUnits:units,outputBytes,descriptorBytes:e.result.layout.size,
    intermediateBufferBytes:artifact.stats.intermediateBufferBytes,moduleBytes:artifact.bytes.length};
};
console.log(JSON.stringify({quantized,independentRounding:xs.map(x=>Math.floor(x+0.5)),checkpoint,resumed,blocks,
  sensitivity:result,sameBytesAsExplicitWiring:true,
  measurements:[measure(compiled,'quantize',8,64),measure(final,'quantize',8,0),measure(compiled,'quantize_blocks',8,64),measure(sensitivity,'tracking_sensitivity',4,64)],
  note:'No extra recurrence slots or intermediate buffers. Final output, descriptors, inputs and host copies still occupy memory; module sizes include all exports. No timing claim.'},
  (_,x)=>ArrayBuffer.isView(x)?Array.from(x):x,2));
