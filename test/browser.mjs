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
  document.body.dataset.result='pass';
  report.status='PASS';
} catch(error) {
  document.body.dataset.result='fail'; report.status='FAIL'; report.error=error.stack ?? error.message;
}
document.querySelector('#report').textContent=JSON.stringify(report,null,2);
