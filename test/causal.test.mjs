import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime} from '../src/abi.mjs';
import {reference} from './reference.mjs';
const plain=v=>ArrayBuffer.isView(v)?Array.from(v):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
async function check(source,args,expected,options={}){
  const compiled=compile(source,options),runtime=await createRuntime(compiled,{pages:4});
  const actual=plain(runtime.call('main',args));
  assert.deepEqual(actual,expected??reference(source,'main',args));return compiled;
}
test('inclusive scan emits prefixes in one loop and one scalar state slot',async()=>{
  const s='export fn main(xs:[Num])=xs |> scan(0,(s,x)=>s+x);';
  for(const xs of [[],[1],[1,2,3],[-1,2,-3,4]]){
    const c=await check(s,[xs]);assert.equal(c.stats.functions[0].loops,1);assert.equal(c.stats.functions[0].stateSlots,1);
    assert.equal(c.stats.intermediateBufferBytes,0);
  }
});
test('upstream and downstream filters have different clocks',async()=>{
  await check('export fn main(xs:[Num])=xs |> filter(x=>x>0) |> scan(0,(s,x)=>s+x);',[[1,-2,3,-4,5]],[1,4,9]);
  await check('export fn main(xs:[Num])=xs |> scan(0,(s,x)=>s+x) |> filter(x=>x>0);',[[1,-2,3,-4,5]],[1,2,3]);
});
test('shared stateful branch advances once when zipped with itself or mapped views',async()=>{
  const c=await check('export fn main(xs:[Num])={let s=scan(xs,0,(s,x)=>s+x);zip(map(s,x=>x*2),s,(a,b)=>a+b)};',[[1,2,3]],[3,9,18]);
  assert.equal(c.stats.functions[0].stateMachines,1);assert.equal(c.stats.functions[0].runtimeZipChecks,0);
});
test('independent scans have independent state but preserve event alignment',async()=>{
  const c=await check('export fn main(xs:[Num])=zip(scan(xs,0,(s,x)=>s+x),scan(xs,1,(s,x)=>s*x),(a,b)=>a+b);',[[1,2,3]],[2,5,12]);
  assert.equal(c.stats.functions[0].stateMachines,2);assert.equal(c.stats.functions[0].loops,1);
});
test('two scans compose without buffers and record state updates are simultaneous',async()=>{
  await check('export fn main(xs:[Num])=xs |> scan(0,(s,x)=>s+x) |> scan(0,(s,x)=>s+x);',[[1,2,3]],[1,4,10]);
  await check('export fn main(n)=range(n) |> scan({a:0,b:1},(s,x)=>{a:s.b,b:s.a+s.b}) |> map(s=>s.a);',[8],[1,1,2,3,5,8,13,21]);
});
test('transducers can skip output without skipping state updates',async()=>{
  await check('export fn main(xs:[Num])=transduce(xs,0,(s,x)=>{state:s+x,value:s,emit:x>0});',[[1,-2,3]],[0,-1]);
  await check('export fn main(xs:[Num])=xs |> transduce(0,(s,x)=>{state:s+x,value:s+x,emit:x>0}) |> scan(0,(s,x)=>s+x);',[[1,-2,3]],[1,3]);
});
test('non-emitted transition values are not demanded',async()=>{
  await check('export fn main(n)=range(n) |> transduce(0,(s,x)=>{state:s+1,value:sum(range(-1)),emit:false});',[4],[]);
});
test('state transitions are strict when traversed even if downstream values are unused',async()=>{
  const r=await createRuntime(compile('export fn main(n)=range(n) |> scan(0,(s,x)=>sum(range(-1))) |> count;'));
  assert.equal(r.call('main',[0]),0);assert.throws(()=>r.call('main',[1]),WebAssembly.RuntimeError);
  await check('export fn main()={let unused=scan(range(4),sum(range(-1)),(s,x)=>s+x);42};',[],42);
});
test('initial state is not demanded on an empty upstream clock',async()=>{
  await check('export fn main(xs:[Num])=xs |> filter(x=>x>100) |> scan(sum(range(-1)),(s,x)=>s+x);',[[1,2]],[]);
});
test('JTE distinguishes dense from seekable and rejects forged access evidence',()=>{
  const c=compile('export fn main(xs:[Num])=scan(xs,0,(s,x)=>s+x);');
  const step=c.certificate.steps.find(s=>s.rule==='scan');assert.equal(step.dense,true);assert.equal(step.seekable,false);
  const forged=structuredClone(c.certificate.steps);forged.find(s=>s.rule==='scan').seekable=true;
  assert.throws(()=>verifyCertificate(forged),/forged/);
  for(const s of ['at(scan(xs,0,(s,x)=>s+x),0)','at(map(scan(xs,0,(s,x)=>s+x),x=>x*2),0)',
    'at(zip(xs,scan(xs,0,(s,x)=>s+x),(a,b)=>a+b),0)']){
    assert.throws(()=>compile(`export fn main(xs:[Num])=${s};`),e=>e.code==='E_CAUSAL_ACCESS');
  }
});
test('checked positional zip supports independent dense stateful streams',async()=>{
  await check('export fn main(xs:[Num],ys:[Num])=zip_checked(scan(xs,0,(s,x)=>s+x),scan(ys,0,(s,x)=>s+x),(a,b)=>a+b);',[[1,2],[3,4]],[4,10]);
});
test('nested traversals reset states and do not capture an outer cursor accidentally',async()=>{
  const programs=[
    'map(xs,x=>sum(scan(xs,0,(s,y)=>s+x+y)))',
    '{let s=scan(xs,0,(s,x)=>s+x);map(s,x=>sum(map(s,y=>x*y)))}',
    '{let s=scan(xs,0,(s,x)=>s+x);map(xs,x=>sum(s)+x)}',
    '{let s=scan(xs,0,(s,x)=>s+x);scan(s,0,(acc,x)=>acc+sum(map(s,y=>x*y)))}',
  ];
  for(const expression of programs)for(const memoizeReductions of [true,false])await check(`export fn main(xs:[Num])=${expression};`,[[1,2,3]],undefined,{memoizeReductions});
});
test('separate consumers get separate recurrence frames',async()=>{
  await check('export fn main(xs:[Num])={let s=scan(xs,0,(s,x)=>s+x);{total:sum(s),last:fold(s,0,(a,x)=>x),count:count(s)}};',[[1,2,3]],{count:3,last:6,total:10});
});
test('bounded iteration reports convergence or fuel exhaustion without unrolling',async()=>{
  await check('export fn main(n)=iterate(1,n,s=>{state:s*2,done:s>=8});',[10],{done:true,state:16,steps:4});
  await check('export fn main(n)=iterate(1,n,s=>{state:s*2,done:false});',[3],{done:false,state:8,steps:3});
  await check('export fn main(n)=iterate(1,n,s=>{state:s*2,done:true});',[0],{done:false,state:1,steps:0});
  const a=compile('export fn main()=iterate(0,10,s=>{state:s+1,done:false});');
  const b=compile('export fn main()=iterate(0,1000000,s=>{state:s+1,done:false});');
  assert.equal(a.bytes.length,b.bytes.length);assert.equal(b.stats.functions[0].loops,1);
});
test('iteration record updates and termination inspect the old state consistently',async()=>{
  await check('export fn main()=iterate({a:0,b:1},7,s=>{state:{a:s.b,b:s.a+s.b},done:s.a>4});',[],{done:true,state:{a:8,b:13},steps:6});
});
test('iteration budgets reject invalid extents and inactive iterations stay inactive',async()=>{
  const r=await createRuntime(compile('export fn main(n)=iterate(0,n,s=>{state:s+1,done:false});'));
  for(const n of [-1,NaN,Infinity,2.5,2147483648])assert.throws(()=>r.call('main',[n]),WebAssembly.RuntimeError);
  await check('export fn main()=if false then iterate(0,-1,s=>{state:s,done:false}).state else 8;',[],8);
});
test('iteration inside and around streams, with demand memoization on and off',async()=>{
  for(const memoizeReductions of [true,false]){
    await check('export fn main(xs:[Num])=map(xs,x=>iterate(x,3,s=>{state:s+x,done:false}).state);',[[1,2,3]],undefined,{memoizeReductions});
    await check('export fn main(xs:[Num])=iterate(0,3,s=>{state:s+sum(scan(xs,s,(a,x)=>a+x)),done:false});',[[1,2,3]],undefined,{memoizeReductions});
    await check('export fn main(xs:[Num])={let r=iterate(1,4,s=>{state:s*2,done:false});map(xs,x=>x+r.state+r.steps)};',[[1,2,3]],undefined,{memoizeReductions});
  }
});
test('state representation and effect restrictions remain static errors',()=>{
  for(const s of ['scan(xs,0,(s,x)=>true)','transduce(xs,0,(s,x)=>{state:s,value:x,emit:1})','iterate(0,2,s=>{state:true,done:false})'])assert.throws(()=>compile(`export fn main(xs:[Num])=${s};`),e=>e.code==='E_TYPE');
  assert.throws(()=>compile('host fn bad(n:Num):Num;export fn main(xs:[Num])=scan(xs,0,(s,x)=>bad(x));'),e=>e.code==='E_EFFECT');
  assert.throws(()=>compile('export fn main(xs:[Num],b)=if b then scan(xs,0,(s,x)=>s+x) else xs;'),e=>e.code==='E_STATE_BRANCH');
});
test('300 seeded causal differential programs, each with memoization on and off',async()=>{
  let seed=0x7363616e;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<300;i++){
    const xs=Array.from({length:next()%14},()=>next()%11-5),a=next()%5+1,cut=next()%7-3;
    const expressions=[
      `xs |> filter(x=>x>${cut}) |> scan(0,(s,x)=>s+x) |> filter(x=>x<${a*3})`,
      `xs |> transduce(0,(s,x)=>{state:s+x,value:s*${a}+x,emit:x>${cut}}) |> scan(0,(s,x)=>s+x)`,
      `{let s=scan(xs,0,(s,x)=>s+x);zip(s,map(s,x=>x*${a}),(x,y)=>x+y)}`,
      `xs |> scan({a:0,b:1},(s,x)=>{a:s.a+x,b:s.b+s.a}) |> map(s=>s.a+s.b*${a})`,
      `map(xs,x=>iterate(x,${a},s=>{state:s+x,done:s>${cut}}).state)`,
      `map(xs,x=>sum(scan(xs,x,(s,y)=>s+y)))`,
    ];
    const source=`export fn main(xs:[Num])=${expressions[i%expressions.length]};`;
    const expected=reference(source,'main',[xs]);
    for(const memoizeReductions of [true,false])await check(source,[xs],expected,{memoizeReductions});
  }
});

test('observation summaries expose access separately from density, without changing ASABI',()=>{
  const c=compile('export fn main(xs:[Num])=scan(xs,0,(s,x)=>s+x);');
  assert.equal(c.abi.version,1);assert.equal(c.observations.main.dense,true);
  assert.equal(c.observations.main.access,'sequential');assert.equal(c.observations.main.recurrenceScalars,1);
  const guarded=compile('export fn main(xs:[Num],valid:Bool)=require(valid,map(xs,x=>x+1));');
  assert.equal(guarded.stats.functions[0].runtimeZipChecks,0);assert.equal(guarded.stats.functions[0].runtimeStreamChecks,1);
});
