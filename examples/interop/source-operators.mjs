import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileSources} from '../../src/compiler.mjs';
import {createRuntime} from '../../src/abi.mjs';
import {operatorCalibrationSource} from '../case-studies/operators/calibration-kernel.mjs';

const libraries=await Promise.all(['operators','krylov'].map(async name=>({
  name:`${name}.ass`,source:await readFile(new URL(`../../lib/${name}.ass`,import.meta.url),'utf8'),
})));
const reports=[];
for(const [file,name,args,loopUnits,outputBytes] of [
  ['product_solve','product_solve',[{left:4,right:18}],2,0],
  ['operator_blocks','operator_blocks',[[1,2,3,4,5,6,7],3],7,112],
  [null,'calibration_step',[[0,1,2],[1,3,5],{gain:0,bias:0},1],2,0],
]){
  const source=file?await readFile(new URL(`../case-studies/operators/${file}.ass`,import.meta.url),'utf8'):operatorCalibrationSource;
  const files=[...libraries,{name:`${name}.ass`,source}];
  const compiled=compileSources(files,{prelude:false,maxLoopIterations:loopUnits});
  const runtime=await createRuntime(compiled);
  const result=runtime.call(name,args,{outputBytes});
  assert.equal(compiled.stats.intermediateBufferBytes,0);
  assert.equal(compiled.stats.functions[0].loops,1);
  assert(WebAssembly.Module.imports(new WebAssembly.Module(compiled.bytes)).every(x=>x.kind==='memory'));
  const small=await createRuntime(compileSources(files,{maxLoopIterations:loopUnits-1}));
  assert.throws(()=>small.call(name,args),WebAssembly.RuntimeError);
  if(file==='operator_blocks'){
    assert.deepEqual([...result.local],[4,12,24,16,36,60,28]);
    assert.deepEqual([...result.correction],[3,10,21,12,31,54,21]);
    assert.throws(()=>runtime.call(name,args,{outputBytes:outputBytes-1}),WebAssembly.RuntimeError);
  }else{
    assert(result.converged&&!result.breakdown);assert.equal(result.iterations,2);
    if(!file){assert(Math.abs(result.solution.gain-5/3)<1e-12);assert(Math.abs(result.solution.bias-1)<1e-12);}
    else{assert(Math.abs(result.solution.left-1)<1e-12);assert(Math.abs(result.solution.right-2)<1e-12);}
  }
  const stats=compiled.stats;
  reports.push({name,result,loopUnits,loopSites:stats.functions[0].loops,outputArrayBytes:outputBytes,
    intermediateBufferBytes:stats.intermediateBufferBytes,wasmBytes:compiled.bytes.length,
    scalarGraphNodes:stats.scalarNodes,wasmLocalValueBytes:stats.functions[0].wasmLocalValueBytes});
}
console.log(JSON.stringify({reports,
  note:'Source libraries on the existing core; all computation is Wasm. No Jacobian, iteration-history array, or new primitive. Final descriptors and scalar locals are not zero memory; these are work/storage counts, not throughput claims.'},
  (_,v)=>ArrayBuffer.isView(v)?[...v]:v,2));
