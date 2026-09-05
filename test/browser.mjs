import { createRuntime, createCapability } from '../src/abi.mjs';
import { corpus } from '../examples/corpus.mjs';
import { compile, instantiate } from '../src/compiler.mjs';
import { reference } from './reference.mjs';
const report = { browser: navigator.userAgent, checks: 0, cases: [] };
const assert = (condition,message) => { if (!condition) throw new Error(message); report.checks++; };
try {
  const source = `export fn main(n) = {
    let xs=range(n) |> filter(x=>x>2);
    zip(map(xs,x=>x*2),map(xs,x=>x+1),(x,y)=>x*y) |> sum
  };`;
  const c = compile(source), i = await instantiate(c);
  assert(i.exports.main(8) === reference(source,'main',[8]),'Fused range result');
  assert(c.stats.functions[0].loops === 1,'One fused loop');
  assert(c.stats.functions[0].runtimeZipChecks === 0,'No redundant zip check');
  assert(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)).length===0,'No imported runtime');
  report.cases.push({name:'fused-range',wasmBytes:c.bytes.length});
  const memory = new WebAssembly.Memory({initial:1,maximum:1});
  new Float64Array(memory.buffer).set([1,2,3,4,5,6]);
  const dot = compile('export fn dot(a,b)=zip_checked(a,b,(x,y)=>x*y) |> sum;');
  const d = await instantiate(dot,{memory});
  assert(d.exports.dot(0,3,24,3) === 32,'Borrowed dot product');
  let trapped=false;
  try { d.exports.dot(0,3,24,2); } catch(e) { trapped=e instanceof WebAssembly.RuntimeError; }
  assert(trapped,'Mismatch must trap');
  trapped=false;
  try { d.exports.dot(65528,2,0,2); } catch(e) { trapped=e instanceof WebAssembly.RuntimeError; }
  assert(trapped,'Span bound must trap');
  assert(memory.buffer.byteLength === 65536,'Memory remains fixed');
  report.cases.push({name:'borrowed-dot',wasmBytes:dot.bytes.length});
  let seed=9917;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let t=0;t<100;t++) {
    const n=random()%40, a=random()%11-5, cut=random()%13;
    const s=`export fn main(n)=range(n) |> map(x=>x*(${a})) |> filter(x=>x>${cut}) |> sum;`;
    const compiled=compile(s), instance=await instantiate(compiled);
    assert(Object.is(instance.exports.main(n),reference(s,'main',[n])),`Differential ${t}`);
  }
  report.cases.push({name:'seeded-differential',cases:100});
  // Exercise the playground's worker, including compiler modules loaded in it.
  if (!globalThis.asslangEngineOnly) {
  const worker = new Worker('../web/worker.mjs',{type:'module'});
  const workerResult = await new Promise((resolve,reject)=>{
    worker.onmessage=event=>resolve(event.data);
    worker.onerror=event=>reject(new Error(event.message));
    worker.postMessage({source:'export fn main(n)=range(n) |> sum;',n:10});
  });
  worker.terminate();
  assert(workerResult.value===45,'Worker compilation and execution');
  } else {
    report.notTested=['HTTP module loading','playground worker loading'];
  }
  function close(a,b) {
    if(typeof b==='number')return Object.is(a,b)||Math.abs(a-b)<1e-10*Math.max(1,Math.abs(b));
    if(b&&typeof b==='object') {
      if(Array.isArray(b)||ArrayBuffer.isView(b))return a.length===b.length&&Array.from(b).every((v,i)=>close(a[i],v));
      return Object.keys(b).every(k=>close(a[k],b[k]));
    }
    return a===b;
  }
  for(const entry of corpus) {
    const source=globalThis.asslangSources?.[entry.path] ?? await (await fetch('../examples/'+entry.path)).text();
    const compiled=compile(source),runtime=await createRuntime(compiled,{pages:4});
    const capability=entry.host?createCapability({read_scale:{parameters:['Text'],result:'Num',call:()=>0.5},audit:{parameters:['Text','Num'],result:'Bool',call:()=>true}},{maxCalls:2}):undefined;
    assert(close(runtime.call(entry.name,entry.args,{capability}),entry.expected),'Corpus '+entry.id);
  }
  report.cases.push({name:'asabi-algorithm-corpus',cases:corpus.length});
  const effectSource='host fn emit(n:Num):Num; export fn main(n)=effect {perform emit(n);perform emit(n+1);n};';
  const effectRuntime=await createRuntime(compile(effectSource)),seen=[];
  const grant=createCapability({emit:{parameters:['Num'],result:'Num',call:n=>(seen.push(n),n)}},{maxCalls:2});
  let denied=false;try{effectRuntime.call('main',[3]);}catch(e){denied=e.code==='E_CAPABILITY';}assert(denied,'Missing capability denied');
  assert(effectRuntime.call('main',[3],{capability:grant})===3,'Host effect result');
  assert(JSON.stringify(seen)==='[3,4]','Effects execute in order');
  assert(grant.remaining===0,'Effect quota consumed');
  denied=false;try{effectRuntime.call('main',[3],{capability:grant});}catch(e){denied=e.code==='E_EFFECT_BUDGET';}assert(denied,'Exhausted budget denied');
  const outputRuntime=await createRuntime(compile('export fn main(n)=range(n);'));
  denied=false;try{outputRuntime.call('main',[5],{outputBytes:8});}catch(e){denied=e instanceof WebAssembly.RuntimeError;}assert(denied,'Output arena bounds trap');
  assert(close(outputRuntime.call('main',[3]),[0,1,2]),'Frame recovered after trap');
  const leaseRuntime=await createRuntime(compile('export fn main(xs:[Num],scale:Num)=map(xs,x=>x*scale);'));
  const lease=leaseRuntime.prepare('main',[[1,2,3],2]);
  assert(close(lease.run(),[2,4,6]),'Prepared fixed-input result');
  assert(close(lease.run({scale:3}),[3,6,9]),'Prepared scalar override');
  lease.dispose();denied=false;try{lease.run();}catch(e){denied=e.code==='E_LEASE_EXPIRED';}assert(denied,'Expired input lease denied');
  const causalSource='export fn main(xs:[Num])=xs |> filter(x=>x>0) |> scan(0,(s,x)=>s+x) |> transduce(0,(s,x)=>{state:s+x,value:s+x,emit:x>2});';
  const causal=compile(causalSource),causalRuntime=await createRuntime(causal);
  assert(causal.stats.functions[0].loops===1,'Causal composition fuses');
  assert(causal.stats.functions[0].stateMachines===2,'Two scalar state frames');
  for(let t=0;t<100;t++) {
    const values=Array.from({length:random()%20},()=>random()%15-7);
    assert(close(causalRuntime.call('main',[values]),reference(causalSource,'main',[values])),'Causal differential '+t);
  }
  denied=false;try{compile('export fn main(xs:[Num])=at(scan(xs,0,(s,x)=>s+x),0);');}catch(e){denied=e.code==='E_CAUSAL_ACCESS';}assert(denied,'History-dependent seek denied');
  report.cases.push({name:'causal-differential',cases:100});
  // PR #1's browser checks, retained alongside the complete causal/ABI suite.
  const fusionSource=`export fn main(xs)={let ys=filter(xs,x=>x>1);
    sum(ys)+sum(map(ys,x=>x*x))+count(ys)};`;
  const fused=compile(fusionSource,{experimentalReductionFusion:true});
  const f=await instantiate(fused,{memory});
  assert(Object.is(f.exports.main(0,6),reference(fusionSource,'main',[[1,2,3,4,5,6]])),
    'Reduction cohort result');
  assert(fused.stats.functions[0].loops===1,'Three reductions share one loop');
  assert(fused.stats.functions[0].reductionFusion.eliminatedLoops===2,'Two loops eliminated');
  const lazy=compile(`export fn main(n)={let xs=range(n);
    if true then count(map(xs,x=>sum(range(-1))))+sum(xs) else sum(range(-1))};`,
    {experimentalReductionFusion:true});
  assert((await instantiate(lazy)).exports.main(5)===15,'Fusion preserves lazy demand');
  for(let t=0;t<100;t++) {
    const n=random()%40, cut=random()%13;
    const s=`export fn main(n)={let xs=filter(range(n),x=>x>${cut});
      sum(xs)+sum(map(xs,x=>x*x))+count(xs)};`;
    const compiled=compile(s,{experimentalReductionFusion:true});
    const instance=await instantiate(compiled);
    assert(Object.is(instance.exports.main(n),reference(s,'main',[n])),`Fusion differential ${t}`);
    assert(compiled.stats.functions[0].loops===1,`Fusion structure ${t}`);
  }
  report.cases.push({name:'experimental-reduction-fusion',cases:100,wasmBytes:fused.bytes.length});
  const sharedHistory=`export fn main(xs:[Num])={
    let ys=scan(xs,0,(s,x)=>s+x);
    {total:sum(ys),count:count(ys),last:fold(ys,0,(s,x)=>x)}
  };`;
  const sharedCompiled=compile(sharedHistory,{experimentalReductionFusion:true});
  const sharedRuntime=await createRuntime(sharedCompiled,{pages:4});
  assert(sharedCompiled.stats.functions[0].loops===1,'Causal sinks share one loop');
  assert(sharedCompiled.stats.functions[0].stateMachines===1,'Shared history advances once');
  for(let t=0;t<100;t++) {
    const values=Array.from({length:random()%20},()=>random()%15-7);
    assert(close(sharedRuntime.call('main',[values]),reference(sharedHistory,'main',[values])),`Causal fusion differential ${t}`);
  }
  report.cases.push({name:'causal-reduction-fusion',cases:100});
  for(const entry of corpus) {
    if(entry.host)continue;
    const source=globalThis.asslangSources?.[entry.path] ?? await (await fetch('../examples/'+entry.path)).text();
    const compiled=compile(source,{experimentalReductionFusion:true});
    const runtime=await createRuntime(compiled,{pages:4});
    assert(close(runtime.call(entry.name,entry.args),entry.expected),'Fused corpus '+entry.id);
  }
  document.body.dataset.result='pass';
  report.status='PASS';
} catch(error) {
  document.body.dataset.result='fail'; report.status='FAIL'; report.error=error.stack ?? error.message;
}
document.querySelector('#report').textContent=JSON.stringify(report,null,2);
