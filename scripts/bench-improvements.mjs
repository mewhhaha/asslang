// Before/after comparisons use an explicit checkout, never historical JSON.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { cpus, platform, arch, release } from 'node:os';
import { createHash } from 'node:crypto';
import { compile, createCompiler } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i++) {
  if(!['--baseline','--output'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))
    throw new Error('Usage: node scripts/bench-improvements.mjs --baseline CHECKOUT [--output REPORT.json]');
  options[args[i].slice(2)]=args[++i];
}
if(!options.baseline)throw new Error('--baseline must identify an unchanged baseline checkout');
const oldCompiler=await import(pathToFileURL(resolve(options.baseline,'src/compiler.mjs')));
const oldABI=await import(pathToFileURL(resolve(options.baseline,'src/abi.mjs')));
const digest=s=>createHash('sha256').update(s).digest('hex');
const samples=21;
let observable;
function batchTime(fn,n) { const t=performance.now();for(let i=0;i<n;i++)observable=fn();return (performance.now()-t)/n; }
function calibrate(fn) {
  for(let i=0;i<40;i++)observable=fn();
  let n=1;while(n<131072&&batchTime(fn,n)*n<4)n*=2;return n;
}
function summary(values,batch) {
  const sorted=[...values].sort((a,b)=>a-b);
  return {p50:sorted[Math.floor(samples/2)],p95:sorted[Math.floor(samples*.95)],batch,samples,unit:'ms/call'};
}
function paired(baseline,candidate) {
  const na=calibrate(baseline),nb=calibrate(candidate),a=[],b=[];
  for(let i=0;i<samples;i++) {
    if(i%2){b.push(batchTime(candidate,nb));a.push(batchTime(baseline,na));}
    else{a.push(batchTime(baseline,na));b.push(batchTime(candidate,nb));}
  }
  const before=summary(a,na),after=summary(b,nb);
  return {baseline:before,candidate:after,speedup:before.p50/after.p50};
}
const paths=['examples/energy.ass','examples/algorithms/welford.ass','examples/concepts/machine_composition.ass','examples/algorithms/convolution.ass'];
const sources=[];
for(const path of paths) {
  const source=await readFile(new URL('../'+path,import.meta.url),'utf8');
  assert.equal(source,await readFile(resolve(options.baseline,path),'utf8'),path+' must be identical');
  sources.push({path,source});
}
sources.push({path:'generated/300-unused-helpers',source:Array.from({length:300},(_,i)=>`fn helper_${i}(x)=x+${i};`).join('\n')+'\nexport fn main(x:Num)=helper_299(x);'});
sources.push({path:'generated/24-record-sinks',source:'export fn main(xs:[Num])={'+Array.from({length:24},(_,i)=>`s${i}:sum(map(xs,x=>x+${i}))`).join(',')+'};'});
const compilation=[];
for(const {path,source} of sources) {
  const before=oldCompiler.compile(source),after=compile(source);
  assert.deepEqual(after.abi,before.abi);assert.deepEqual(after.certificate,before.certificate);
  compilation.push({path,sourceSha256:digest(source),sourceCharacters:source.length,
    baselineWasmBytes:before.bytes.length,candidateWasmBytes:after.bytes.length,
    ...paired(()=>oldCompiler.compile(source),()=>compile(source))});
}
const cached=[];
for(const {path,source} of sources.filter(s=>!s.path.includes('unused-helpers'))) {
  const session=createCompiler();session.compile(source);
  const timing=paired(()=>compile(source),()=>session.compile(source));
  cached.push({path,baselineLabel:'uncached current compiler',candidateLabel:'exact-source LRU hit including defensive snapshot',...timing,cache:session.stats});
  session.clear();
}
const transfer=[];
const values=Float64Array.from({length:32768},(_,i)=>(i%17)-8);
for(const [name,source] of [
  ['sum','export fn main(xs:[Num])=sum(xs);'],
  ['identity-output','export fn main(xs:[Num])=map(xs,x=>x);'],
  ['prefix-output','export fn main(xs:[Num])=scan(xs,0,(s,x)=>s+x);'],
]) {
  const old=await oldABI.createRuntime(oldCompiler.compile(source),{pages:16});
  const current=await createRuntime(compile(source),{pages:16});
  assert.deepEqual(current.call('main',[values]),old.call('main',[values]));
  transfer.push({name,path:'copying runtime.call',elements:values.length,arenaBytes:16*65536,
    ...paired(()=>old.call('main',[values]),()=>current.call('main',[values]))});
  const a=old.prepare('main',[values]),b=current.prepare('main',[values]);
  assert.deepEqual(b.run(),a.run());
  transfer.push({name,path:'prepared.run (setup excluded; result copy and output scrub included)',elements:values.length,arenaBytes:16*65536,
    ...paired(()=>a.run(),()=>b.run())});
  a.dispose();b.dispose();
}
const oldSearch=`export fn main(xs:[Num],key:Num)=fold(xs,{i:0,found:-1},(s,x)=>{
  i:s.i+1,found:if s.found>=0 then s.found else if x==key then s.i else -1
}).found;`;
const newSearch=`export fn main(xs:[Num],key:Num)=fold_until(xs,{i:0,found:-1},(s,x)=>{
  state:{i:s.i+1,found:if x==key then s.i else -1},done:x==key
}).state.found;`;
const a=oldCompiler.compile(oldSearch),b=compile(newSearch);
const memory=new WebAssembly.Memory({initial:16,maximum:16}),data=new Float64Array(memory.buffer,0,65536);
const before=(await WebAssembly.instantiate(a.bytes,{env:{memory}})).instance.exports.main;
const after=(await WebAssembly.instantiate(b.bytes,{env:{memory}})).instance.exports.main;
const stopping=[];
for(const [name,index] of [['first',0],['middle',32768],['last',65535],['absent',-1]]) {
  data.fill(1);if(index>=0)data[index]=2;
  assert.equal(before(0,data.length,2),index);assert.equal(after(0,data.length,2),index);
  stopping.push({name,elements:data.length,expected:index,baselineVisited:data.length,candidateVisited:index<0?data.length:index+1,
    ...paired(()=>before(0,data.length,2),()=>after(0,data.length,2))});
}
async function compilerManifest(directory) {
  const result={};
  for(const name of (await readdir(directory)).filter(n=>n.endsWith('.mjs')).sort())
    result[name]=digest(await readFile(resolve(directory,name)));
  return result;
}
const report={
  status:'PASS',environment:{node:process.version,v8:process.versions.v8,platform:platform(),arch:arch(),release:release(),cpu:cpus()[0]?.model},
  methodology:{samples,warmups:40,targetBatchMilliseconds:4,order:'alternating baseline/candidate',quantiles:'batch averages, NOT individual-call tail latency',
    compilation:'uncached source-to-validated-Wasm; excludes native machine-code generation, I/O and process startup',
    cache:'current uncached build versus exact-source cache hit with snapshot cloning, not incremental compilation',
    transfer:'same source and values, same fixed arena; ordinary calls copy and scrub; prepared setup excluded',
    stopping:'raw reused-buffer search, old exhaustive fold versus new fold_until; no input/output copies; same finite-input answer',
    warning:'One warmed single-process host measurement, not a universal performance guarantee. Tiny early-hit timings are timer/JIT sensitive.'},
  baselineCompilerSha256:digest(await readFile(resolve(options.baseline,'src/compiler.mjs'))),
  candidateCompilerSha256:digest(await readFile(new URL('../src/compiler.mjs',import.meta.url))),
  baselineFiles:await compilerManifest(resolve(options.baseline,'src')),
  candidateFiles:await compilerManifest(fileURLToPath(new URL('../src/',import.meta.url))),
  compilation,cached,transfer,stopping,
};
// Ensure results are observably consumed without printing large typed arrays.
assert.notEqual(observable,undefined);
const json=JSON.stringify(report,null,2)+'\n';
if(options.output)await writeFile(options.output,json);
console.log(json);
