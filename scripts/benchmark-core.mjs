import { compile } from '../src/compiler.mjs';
import { Arena, prepareCall, createRuntime, createCapability } from '../src/abi.mjs';
import { corpus, baselines, benchmarkArguments, expansionSource, exampleSource } from '../examples/corpus.mjs';

const now=()=>performance.now();
export function quantiles(values) {
  const sorted=[...values].sort((a,b)=>a-b);
  return {p50:sorted[Math.floor(sorted.length*0.5)],p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*0.95))]};
}
let observable;
function measure(fn,{samples=15,targetMilliseconds=5,maxBatch=262144}={}) {
  for(let i=0;i<30;i++)observable=fn();
  let batch=1;
  while(batch<maxBatch) {
    const start=now();for(let i=0;i<batch;i++)observable=fn();
    if(now()-start>=targetMilliseconds)break;batch*=2;
  }
  const times=[];
  for(let sample=0;sample<samples;sample++) {
    const start=now();for(let i=0;i<batch;i++)observable=fn();
    times.push((now()-start)/batch);
  }
  return {...quantiles(times),batch,samples,unit:'ms/call'};
}
function assertClose(a,b) {
  if(typeof b==='number') {
    if(!(Object.is(a,b)||Number.isNaN(a)&&Number.isNaN(b)||Math.abs(a-b)<1e-9*Math.max(1,Math.abs(b))))throw new Error(`Benchmark correctness check failed: ${a} != ${b}`);
  } else if(b&&typeof b==='object') {
    if(Array.isArray(b)||ArrayBuffer.isView(b)){if(a.length!==b.length)throw new Error('Result length mismatch');for(let i=0;i<b.length;i++)assertClose(a[i],b[i]);}
    else {for(const k of Object.keys(b))assertClose(a[k],b[k]);}
  } else if(a!==b)throw new Error('Result mismatch');
}
async function rawKernel(compiled,name,args,pages=4) {
  const memory=new WebAssembly.Memory({initial:pages,maximum:pages}),arena=new Arena(memory);
  const contract=compiled.abi.exports.find(e=>e.name===name),frame=prepareCall(arena,contract,args);
  const start=now();
  const {instance}=await WebAssembly.instantiate(compiled.bytes,compiled.stats.needsMemory?{env:{memory}}:{});
  const instantiateMilliseconds=now()-start;
  const call=()=>instance.exports[name](...frame.slots);
  return {call,lift:()=>frame.lift(call()),memoryBytes:memory.buffer.byteLength,instantiateMilliseconds};
}

/** Shared Node/Chrome benchmark suite. Runtime paths are reported separately;
 * they are intentionally NOT presented as equivalent memory-management costs.
 */
export async function runBenchmarks({loadSource,compileSamples=21,samples=15,includeScaling=true}={}) {
  const sources=new Map();for(const e of corpus)if(!sources.has(e.path))sources.set(e.path,await exampleSource(e,loadSource));
  const compilation=[];
  for(const [path,source] of sources) {
    const first=compile(source);
    const timing=measure(()=>compile(source),{samples:compileSamples,maxBatch:512});
    compilation.push({path,sourceCharacters:source.length,wasmBytes:first.bytes.length,abiMetadataBytes:first.stats.abiMetadataBytes,
      warmMilliseconds:{p50:timing.p50,p95:timing.p95},iterations:timing.batch*timing.samples,batch:timing.batch,samples:timing.samples,stats:first.stats.functions});
  }
  const runtime=[];
  for(const entry of corpus) {
    const source=sources.get(entry.path),compiled=compile(source);
    const args=entry.baseline?benchmarkArguments(entry):entry.args;
    const baseline=entry.baseline?()=>baselines[entry.baseline](...args):null;
    const raw=entry.host?null:await rawKernel(compiled,entry.name,args);
    const adapter=await createRuntime(compiled,{pages:4});
    const capability=entry.host?createCapability({
      read_scale:{parameters:['Text'],result:'Num',call:()=>0.5},
      audit:{parameters:['Text','Num'],result:'Bool',call:()=>true},
    },{maxCalls:10000000}):undefined;
    let prepared=null,preparedSetupMilliseconds=null;
    if(!entry.host) {
      const preparedRuntime=await createRuntime(compiled,{pages:4}),start=now();
      prepared=preparedRuntime.prepare(entry.name,args);preparedSetupMilliseconds=now()-start;
    }
    const endToEnd=()=>adapter.call(entry.name,args,{capability});
    const expected=baseline?baseline():entry.expected;
    if(raw)assertClose(raw.lift(),expected);assertClose(endToEnd(),expected);if(prepared)assertClose(prepared.run(),expected);
    // Each batch's last result escapes through observable, including allocated arrays.
    const wasmKernel=raw?measure(raw.call,{samples}):null;
    const javascript=baseline?measure(baseline,{samples}):null,jsAdapter=measure(endToEnd,{samples});
    const preparedAdapter=prepared?measure(()=>prepared.run(),{samples}):null;prepared?.dispose();
    runtime.push({id:entry.id,size:entry.size??null,memoryBytes:adapter.memoryBytes,
      instantiateMilliseconds:raw?.instantiateMilliseconds??null,
      wasmKernel,javascript,jsAdapter,preparedAdapter,preparedSetupMilliseconds,kernelRelativeToJS:javascript&&wasmKernel?javascript.p50/wasmKernel.p50:null,
      note:entry.host?'Host effects are measured through the broker only':entry.baseline?'Independent JS algorithm baseline':'Small semantic corpus case; no JS performance baseline',
      generated:compiled.stats.functions.find(f=>f.name===entry.name)});
  }
  const scaling=[];
  if(includeScaling)for(const id of ['shared-reduction','prefixes-quadratic','prefix-scan','pairwise']) {
    const entry=corpus.find(e=>e.id===id);
    for(const n of [128,512,2048]) {
      // Keep intentionally quadratic pairwise runs small enough for repeatability.
      if(id==='pairwise'&&n===2048)continue;
      const args=benchmarkArguments(entry,n),variants=[];
      for(const memoizeReductions of id==='shared-reduction'?[true,false]:[true]) {
        const c=compile(sources.get(entry.path),{memoizeReductions}),raw=await rawKernel(c,entry.name,args);
        assertClose(raw.lift(),baselines[entry.baseline](...args));
        variants.push({memoizeReductions,wasmKernel:measure(raw.call,{samples:7}),loops:c.stats.functions[0].loops});
      }
      scaling.push({id,size:n,variants});
    }
  }
  const expansion=[];
  for(const depth of [2,6,10,14,18]) {
    const start=now();try {const c=compile(expansionSource(depth),{maxExpansion:10000});expansion.push({depth,status:'compiled',milliseconds:now()-start,stagingWork:c.stats.stagingWork,wasmBytes:c.bytes.length});}
    catch(e){if(e.code!=='E_LIMIT')throw e;expansion.push({depth,status:e.code,milliseconds:now()-start});}
  }
  const hostSource='host fn tick(n:Num):Num; export fn main(n)=effect {let x=perform tick(n);x+1};';
  const hostRuntime=await createRuntime(compile(hostSource)),capability=createCapability({tick:{parameters:['Num'],result:'Num',call:n=>n}},{maxCalls:10000000});
  const hostEffect=measure(()=>hostRuntime.call('main',[1],{capability}),{samples});
  // Observe something after measurement, not just dead benchmark outputs.
  const observedType=typeof observable;
  return {status:'PASS',recordedAt:new Date().toISOString(),compilation,runtime,scaling,expansion,hostEffect,observedType,
    methodology:[
      'Single-process microbenchmarks, not production guarantees. Timings may include scheduler and GC noise.',
      'Compile includes parsing, inference, staging, binary emission and WebAssembly.validate; excludes engine machine-code compilation, file IO and process startup.',
      'Runtime kernels reuse encoded inputs and caller output buffers: excludes marshalling, result lifting and memory scrubbing.',
      'Prepared adapter copies fixed inputs once outside timing; includes guest execution, result copies and clearing only the output region. Preparation cost is reported separately.',
      'JS adapter includes input copies, guest execution, output copies and zeroing its fixed 256 KiB arena on every call.',
      'JS baselines use ordinary hand-written loops, allocate outputs where applicable, and are warmed independently.',
      'Prefix baseline is a linear scan; prefixes-quadratic remains quadratic and prefix-scan is the new one-pass version. Moments baseline is one traversal; multi-reduction still uses three.',
      'Both compile and runtime use 30 warmups, batches calibrated to at least 5 ms where the batch cap permits, and p50/p95 of batch-average call times. These are NOT individual-call tail latencies.',
      'Instantiation timing is observed in this process; engine caches mean it is not a cold-compilation measurement.',
      'Compilation is repeated without an Asslang incremental cache. The experiment still stages helper bodies.',
    ]};
}
