import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { partitionOrder, verifyOrder } from '../examples/research/partition-order.mjs';
import { referenceOrder } from '../examples/research/partition-reference.mjs';

// Comparator work is measured separately from time. No timing assertion is a CI gate.
let seed=0x715ecafe;
const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
function time(run, keys) {
  // Warm this exact implementation outside recorded samples.
  for(let i=0;i<2;i++)run(keys);
  const samplesMs=[];
  let result;
  for(let sample=0;sample<5;sample++) {
    const start=performance.now();result=run(keys);samplesMs.push(performance.now()-start);
    if(!verifyOrder(keys,result.indices))throw new Error('Benchmark produced an invalid order');
  }
  return {medianMs:median(samplesMs),samplesMs,stats:result.stats??null};
}
function native(keys) {
  // Include the same key snapshot/finite validation as the experimental backend.
  const copy=Float64Array.from(keys);
  for(const key of copy)if(!Number.isFinite(key))throw new TypeError('Finite keys required');
  return {indices:Array.from(copy,(_,i)=>i).sort((a,b)=>copy[a]-copy[b]||a-b)};
}
const rows=[];
for(const n of [1024,2048,32768]) {
  const data={
    random:Float64Array.from({length:n},()=>random()%1_000_000),
    ascending:Float64Array.from({length:n},(_,i)=>i),
    descending:Float64Array.from({length:n},(_,i)=>n-i),
    equal:new Float64Array(n).fill(7),
    lowCardinality:Float64Array.from({length:n},()=>random()%8),
    organPipe:Float64Array.from({length:n},(_,i)=>Math.min(i,n-i)),
  };
  for(const [shape,keys] of Object.entries(data)) {
    const row={n,shape,regionMedian3:time(xs=>partitionOrder(xs),keys),
      regionFirst:time(xs=>partitionOrder(xs,{pivot:'first'}),keys),native:time(native,keys)};
    if(n<=2048) {
      row.literalTwoWay=time(xs=>referenceOrder(xs,{threeWay:false}),keys);
      row.literalThreeWay=time(xs=>referenceOrder(xs),keys);
    }
    rows.push(row);
  }
}
console.log(JSON.stringify({environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model},
  warmupRuns:2,samples:5,
  scope:'All sorting is JavaScript. NOT Haskell/GHC, Asslang/Wasm sorting or GPU measurements. Input generation and independent result checking are outside timing.',
  caveat:'Region and literal variants are instrumented; native is not. Typed output indices differ from native Array representation. Single-process timings are exploratory, not throughput promises.',
  rows},null,2));
