import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { compile } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';
import { partitionOrder } from '../examples/research/partition-order.mjs';

// End-to-end calls include each implementation's input snapshot and owned output.
// Compilation/instantiation, input generation and checking are outside timing.
// No timing threshold is a test. The algorithms and instrumentation differ.
const source='export fn main = (xs:[Num]) -> sort_by xs (x -> x);';
const compiled=compile(source);
let seed=0x7721ee01;
const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
function native(keys, comparator = true) {
  const values=Float64Array.from(keys);
  for(const key of values)if(!Number.isFinite(key))throw new TypeError('Finite keys required');
  return comparator ? values.sort((a,b)=>a-b) : values.sort();
}
function time(run,keys,expected) {
  for(let i=0;i<2;i++)run(keys);
  const samplesMs=[];
  for(let i=0;i<5;i++) {
    const start=performance.now(),result=run(keys);samplesMs.push(performance.now()-start);
    if(result.length!==expected.length||result.some((x,j)=>!Object.is(x,expected[j])))
      throw new Error('Invalid benchmark output');
  }
  return {samplesMs,medianMs:[...samplesMs].sort((a,b)=>a-b)[2]};
}
const results=[];
for(const n of [1024,8192,32768]) {
  const runtime=await createRuntime(compiled,{pages:Math.ceil((48*n+16)/65536)});
  const inputs={
    random:Float64Array.from({length:n},()=>random()%1000000),
    ascending:Float64Array.from({length:n},(_,i)=>i),
    descending:Float64Array.from({length:n},(_,i)=>n-i),
    equal:new Float64Array(n).fill(7),
    lowCardinality:Float64Array.from({length:n},()=>random()%8),
    organPipe:Float64Array.from({length:n},(_,i)=>Math.min(i,n-i)),
  };
  for(const [shape,keys] of Object.entries(inputs)) {
    const expected=Array.from(keys).sort((a,b)=>a-b);
    results.push({n,shape,
      wasm:time(xs=>runtime.call('main',[xs],{scratchBytes:32*n,outputBytes:8*n}),keys,expected),
      hostPartition:time(xs=>Float64Array.from(partitionOrder(xs).indices,i=>xs[i]),keys,expected),
      nativeTyped:time(native,keys,expected),
      nativeNumeric:time(xs=>native(xs,false),keys,expected),scratchBytes:32*n,outputBytes:8*n,
    });
  }
}
console.log(JSON.stringify({environment:{node:process.version,cpu:cpus()[0]?.model,platform:process.platform,arch:process.arch},
  source,wasmBytes:compiled.bytes.length,warmups:2,samples:5,
  caveats:'Single-process exploratory timings. Wasm uses stable mergesort, ASABI copying and whole-arena scrubbing; the JS partitioner retains instrumentation and gathers payloads; nativeTyped uses a JS comparator and nativeNumeric uses the numeric builtin. Inputs have no negative zero or NaN, so the latter is a valid value baseline here, not an identical general tie contract. No GHC/GPU or universal speedup claim.',
  results},null,2));
