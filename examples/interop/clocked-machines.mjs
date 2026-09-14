import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSources } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const libraries=await Promise.all(['reducers','machines'].map(async name=>({name:`${name}.ass`,
  source:await readFile(new URL(`../../lib/${name}.ass`,import.meta.url),'utf8')})));
const files=source=>[...libraries,{name:'example.ass',source}];
const load=name=>readFile(new URL(`../case-studies/machines/${name}.ass`,import.meta.url),'utf8');
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const metrics=c=>({loops:c.stats.functions[0].loops,stateSlots:c.stats.functions[0].stateSlots,
  wasmLocalValueBytes:c.stats.functions[0].wasmLocalValueBytes,wasmBytes:c.bytes.length,
  intermediateBufferBytes:c.stats.intermediateBufferBytes});
async function measure(source,name,args,expected,units,outputBytes){
  const c=compileSources(files(source),{maxLoopIterations:units,prelude:false});
  const r=await createRuntime(c),result=plain(r.call(name,args,{outputBytes}));
  assert.deepEqual(result,expected);assert.equal(c.stats.intermediateBufferBytes,0);
  assert.throws(()=>r.call(name,args,{outputBytes:outputBytes-1}),WebAssembly.RuntimeError);
  const short=await createRuntime(compileSources(files(source),{maxLoopIterations:units-1,prelude:false}));
  assert.throws(()=>short.call(name,args),WebAssembly.RuntimeError);
  return {result,loopUnits:units,outputBytes,...metrics(c)};
}
const examples=[];
for(const [file,name,args,expected,units,bytes] of [
  ['held_channels','held_channels',[[1,99,3,99],[true,false,true,false],[99,20,99,40],[false,true,false,true]],
    {left:[1,1,4,4],right:[0,20,20,60],state:{left:4,right:60}},4,64],
  ['resumable_pipeline','monitor_chunk',[[0,8,8,0,8,0],[false,false,false,false,true,false],{alpha:0.5,low:3,high:6},{left:0,right:false}],
    {means:[0,4,6,3,4,2],alarms:[false,false,true,false,false,false],state:{left:2,right:false}},6,72],
  ['block_cascade','block_cascade',[[1,2,3,4,5,6,7],3],[1,4,10,4,13,28,7],7,56],
])examples.push({name,...await measure(await load(file),name,args,expected,units,bytes)});

const source=await load('shared_prefix');
const duplicate=s=>s.replace('smooth_signal alpha |> machine_then observers',
  'reducer_product (smooth_signal alpha |> machine_then (sum_reducer ())) (smooth_signal alpha |> machine_then (peak_signal ()))');
const expected={totals:[0,4,10,13],peaks:[0,4,6,6],summary:{left:13,right:6}};
const factoring={
  shared:await measure(source,'shared_prefix',[[0,8,8,0],0.5],expected,4,64),
  duplicated:await measure(duplicate(source),'shared_prefix',[[0,8,8,0],0.5],expected,4,64),
};
assert.equal(factoring.shared.stateSlots,3);assert.equal(factoring.duplicated.stateSlots,4);

// Synthetic work probe: a nested reduction deliberately disables today's
// multi-output cohort. Its three consumers replay the input. Do not hide it.
const expensive=source.replace('mean+alpha*(value-mean)','mean+fold (range value) 0 (s -> x -> s+x)');
const probeExpected={totals:[1,5,9],peaks:[1,4,4],summary:{left:9,right:4}};
const workProbe={
  shared:await measure(expensive,'shared_prefix',[[2,3,1],0.5],probeExpected,27,48),
  duplicated:await measure(duplicate(expensive),'shared_prefix',[[2,3,1],0.5],probeExpected,45,48),
  explanation:'Nested reductions prevent the current output cohort: three traversals, with 9 versus 15 units in each. Not universal one-pass execution.',
};

const config={alpha:0.5,low:3,high:6};
const r=await createRuntime(compileSources(files(await load('resumable_pipeline'))));
const before=r.call('monitor_chunk',[[0,8,8,0],[false,false,false,false],config,{left:0,right:false}]);
const saved=JSON.parse(JSON.stringify({schemaVersion:1,config,state:before.state}));
const after=plain(r.call('monitor_chunk',[[8,0],[true,false],saved.config,saved.state]));
assert.deepEqual(saved.state,{left:3,right:false});assert.deepEqual(after.means,[4,2]);
console.log(JSON.stringify({examples,factoring,workProbe,resume:{saved,after},
  scope:'All transitions and observations are linked Asslang source and run in Wasm. No compiler primitive added. Storage excludes input, descriptors and host copies. Counts are not timing speedups.',
},null,2));
