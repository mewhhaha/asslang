import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileSources} from '../../src/compiler.mjs';
import {createRuntime} from '../../src/abi.mjs';
const library={name:'windows.ass',source:await readFile(new URL('../../lib/windows.ass',import.meta.url),'utf8')};
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const reports=[];
for(const [name,args,expected,units,outputBytes] of [
  ['smooth',[[2,4,8,4,2]],[4.5,6,4.5],3,24],
  ['correlate',[[1,2,3,4,5],[1,0,-1],1],[-2,-2,-2],12,24],
  ['neighborhood_report',[[2,4,8,4,2]],{slopes:[3,0,-3],totals:[3,3,0],state:{slope:-3,total:0}},3,48],
]) {
  const source=await readFile(new URL(`../case-studies/windows/${name}.ass`,import.meta.url),'utf8');
  const files=[library,{name:name+'.ass',source}],c=compileSources(files,{maxLoopIterations:units});
  const runtime=await createRuntime(c),result=plain(runtime.call(name,args,{outputBytes}));
  assert.deepEqual(result,expected);assert.equal(c.stats.intermediateBufferBytes,0);
  assert.throws(()=>runtime.call(name,args,{outputBytes:outputBytes-1}),WebAssembly.RuntimeError);
  const short=await createRuntime(compileSources(files,{maxLoopIterations:units-1}));
  assert.throws(()=>short.call(name,args),WebAssembly.RuntimeError);
  reports.push({name,result,loops:c.stats.functions[0].loops,loopUnits:units,outputBytes,
    intermediateBufferBytes:c.stats.intermediateBufferBytes,wasmBytes:c.bytes.length});
}
console.log(JSON.stringify({reports,note:'All kernels execute in Wasm; the source library stages away. Full-window reductions remain O(M*W), not automatically linear-time.'},null,2));
