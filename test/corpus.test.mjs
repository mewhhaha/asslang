import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {compile} from '../src/compiler.mjs';
import {createRuntime,createCapability} from '../src/abi.mjs';
import {reference} from './reference.mjs';
import {corpus,rejectedCorpus,baselines,benchmarkArguments,expansionSource,exampleSource} from '../examples/corpus.mjs';
const read=path=>readFile(new URL('../examples/'+path,import.meta.url),'utf8');
export function plain(value){if(ArrayBuffer.isView(value))return Array.from(value);if(Array.isArray(value))return value.map(plain);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v)]));return value;}
function close(actual,expected){
  actual=plain(actual);expected=plain(expected);
  if(typeof expected==='number'){assert.ok(Object.is(actual,expected)||Number.isNaN(actual)&&Number.isNaN(expected)||Math.abs(actual-expected)<=1e-11*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);return;}
  if(expected&&typeof expected==='object'){assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());for(const k of Object.keys(expected))close(actual[k],expected[k]);return;}
  assert.equal(actual,expected);
}
for(const entry of corpus)test(`corpus: ${entry.id}`,async()=>{
  const source=await exampleSource(entry,read),compiled=compile(source),r=await createRuntime(compiled,{pages:4});
  const hosts={read_scale:()=>0.5,audit:()=>true};
  const capability=entry.host?createCapability({read_scale:{parameters:['Text'],result:'Num',call:hosts.read_scale},audit:{parameters:['Text','Num'],result:'Bool',call:hosts.audit}},{maxCalls:2}):undefined;
  const value=r.call(entry.name,entry.args,{capability});close(value,entry.expected);close(value,reference(source,entry.name,entry.args,{hosts}));
  if(entry.baseline)close(value,baselines[entry.baseline](...entry.args));
});
test('every .ass example and every accepted export is registered in the corpus',async()=>{
  async function walk(path=''){const files=[];for(const d of await readdir(new URL('../examples/'+path,import.meta.url),{withFileTypes:true})){if(d.isDirectory())files.push(...await walk(path+d.name+'/'));else if(d.name.endsWith('.ass'))files.push(path+d.name);}return files;}
  const paths=await walk(),registered=new Set([...corpus,...rejectedCorpus].map(e=>e.path));assert.deepEqual(paths.sort(),[...registered].sort());
  for(const path of new Set(corpus.map(e=>e.path))){const c=compile(await exampleSource(corpus.find(e=>e.path===path),read));for(const e of c.exports)assert.ok(corpus.some(x=>x.path===path&&x.name===e.name),`${path}:${e.name}`);}
  for(const e of rejectedCorpus)assert.throws(()=>compile(awaitRead.get(e.path)),x=>x.code===e.code);
});
const awaitRead=new Map(await Promise.all(rejectedCorpus.map(async e=>[e.path,await read(e.path)])));
test('400 seeded record/array/nested-traversal differential cases, with optimization on and off',async()=>{
  const sources=[
    'export fn main(xs)={let energy=sum(map(xs,x=>x*x));map(xs,x=>x*x+energy)};',
    'export fn main(xs)=map(xs,x=>sum(map(xs,y=>x*y)));',
    'export fn main(xs)=fold(xs,{a:0,b:1},(s,x)=>{a:s.b+x,b:s.a+s.b});',
    'export fn main(xs)={a:map(xs,x=>x>0),b:filter(xs,x=>x>0)};',
    'export fn main(xs)=map(xs,x=>sum(map(xs,y=>sum(map(xs,z=>x+y+z)))));',
  ];
  const runtimes=await Promise.all(sources.map(async s=>Promise.all([true,false].map(memoizeReductions=>createRuntime(compile(s,{memoizeReductions}))))));
  let seed=0x771239ab;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<200;i++){const index=i%sources.length,args=[Array.from({length:rand()%9},()=>rand()%11-5)],expected=reference(sources[index],'main',args);for(const r of runtimes[index])close(r.call('main',args),expected);}
});
test('memoization does not speculate a trapping reduction into an empty stream or false predicate',async()=>{
  for(const s of [
    'export fn main(n)=range(n) |> filter(x=>false) |> map(x=>sum(range(-1))) |> sum;',
    'export fn main(n)=range(n) |> map(x=>if false then sum(range(-1)) else x) |> sum;',
    'export fn main(n)=range(n) |> map(x=>sum(range(-1))) |> sum;',
  ]){const r=await createRuntime(compile(s));assert.equal(r.call('main',[0]),0);if(s.includes('false'))assert.ok(Number.isFinite(r.call('main',[5])));}
});
test('binary search and numerical algorithms cover empty and degenerate inputs',async()=>{
  for(const id of ['welford','normalize','lower-bound','regression','partition']){
    const e=corpus.find(x=>x.id===id),s=await read(e.path),r=await createRuntime(compile(s));
    const args=id==='lower-bound'?[[],5]:id==='regression'?[[],[]]:[[]];close(r.call(e.name,args),baselines[e.baseline](...args));
  }
  const e=corpus.find(x=>x.id==='lower-bound'),r=await createRuntime(compile(await read(e.path)));
  for(const n of [0,1,2,20,100])for(const key of [-1,0,1,40,201]){const args=[Array.from({length:n},(_,i)=>i*2),key];close(r.call(e.name,args),baselines.lowerBound(...args));}
});
test('bounded staging expansion is reported rather than silently falling back',()=>{
  assert.throws(()=>compile(expansionSource(18),{maxExpansion:10000}),e=>e.code==='E_LIMIT');
});
test('dense counts lower to extent observations without traversing values or dropping zip obligations',async()=>{
  const c=compile('export fn main(xs:[Num])=count(map(xs,x=>sum(range(-1))));');assert.equal(c.stats.functions[0].loops,0);
  assert.equal((await createRuntime(c)).call('main',[[1,2,3]]),3);
  const r=await createRuntime(compile('export fn main(xs:[Num],ys:[Num])=count(zip_checked(xs,ys,(a,b)=>a+b));'));
  assert.throws(()=>r.call('main',[[1],[1,2]]),WebAssembly.RuntimeError);
});
