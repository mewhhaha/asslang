import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compile} from '../src/compiler.mjs';
import {createRuntime,createCapability} from '../src/abi.mjs';
import {corpus,exampleSource} from '../examples/corpus.mjs';
import {reference} from './reference.mjs';
const plain=v=>ArrayBuffer.isView(v)?Array.from(v):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
async function verify(source,args,{expected,run}={}) {
  const results=[];
  for(const memoizeReductions of [false,true])for(const experimentalReductionFusion of [false,true]) {
    const c=compile(source,{memoizeReductions,experimentalReductionFusion});
    const r=await createRuntime(c,{pages:4});
    const result=run?run(r):r.call('main',args);
    assert.deepEqual(plain(result),expected??reference(source,'main',args));results.push(c);
  }
  assert.deepEqual(results[0].certificate,results[1].certificate);
  assert.deepEqual(results[0].abi,results[1].abi);
  return results;
}
test('fusion shares a causal frame once across scalar and record observations',async()=>{
  const source=`export fn main(xs:[Num])={
    let history=scan(xs,{total:0,n:0},(s,x)=>{total:s.total+x,n:s.n+1});
    let totals=map(history,s=>s.total);
    let pair=fold(totals,{last:0,sum:0},(s,x)=>{last:x,sum:s.sum+x});
    {count:count(history),sum:sum(totals),pair:pair}
  };`;
  for(const xs of [[],[1],[1,2,-3,4]]){
    const c=await verify(source,[xs]);
    assert.equal(c[0].stats.functions[0].loops,3);
    assert.equal(c[1].stats.functions[0].loops,1);
    assert.equal(c[1].stats.functions[0].stateMachines,1);
    assert.equal(c[1].stats.functions[0].reductionFusion.eliminatedLoops,2);
  }
});
test('selective transitions retain their upstream clock through co-demanded sinks',async()=>{
  for(const expression of [
    'filter(scan(xs,0,(s,x)=>s+x),x=>x>0)',
    'scan(filter(xs,x=>x>0),0,(s,x)=>s+x)',
    'transduce(xs,0,(s,x)=>{state:s+x,value:s,emit:x>0})',
  ]){
    const c=await verify(`export fn main(xs:[Num])={let ys=${expression};{sum:sum(ys),last:fold(ys,0,(s,x)=>x),count:count(ys)}};`,[[1,-2,3,-4,5]]);
    assert.equal(c[1].stats.functions[0].loops,1);assert.equal(c[1].stats.functions[0].stateMachines,1);
  }
});
test('distinct recurrence frames cannot be merged on domain equality alone',async()=>{
  const c=await verify(`export fn main(xs:[Num])={let a=scan(xs,0,(s,x)=>s+x);let b=scan(xs,1,(s,x)=>s*x);sum(a)+sum(b)};`,[[1,2,3]]);
  assert.equal(c[1].stats.functions[0].loops,2);assert.equal(c[1].stats.functions[0].reductionFusion.eliminatedLoops,0);
});
test('cached record-group fields and scalar peers never return stale state',async()=>{
  const source=`export fn main(xs:[Num],flag:Bool)={
    let pair=fold(xs,{a:0,b:1},(s,x)=>{a:s.b,b:s.a+x});let total=sum(xs);
    {first:if flag then pair.a+total else 0,second:pair.b+total,third:pair.a}
  };`;
  for(const flag of [false,true])await verify(source,[[1,2,3],flag]);
});
test('fusion never enters iteration bodies or hoists a memoized captured reduction',async()=>{
  const programs=[
    '{let ys=scan(xs,0,(s,x)=>s+x);map(xs,x=>sum(map(ys,y=>x+y))+count(ys))}',
    '{let ys=scan(xs,0,(s,x)=>s+x);let a=sum(ys);{array:map(xs,x=>x+a),total:a+sum(map(ys,x=>x*x))}}',
    'iterate(0,3,s=>{state:s+sum(scan(xs,s,(a,x)=>a+x))+sum(xs),done:false})',
    '{let ys=scan(xs,0,(s,x)=>s+sum(xs)+x);sum(ys)+count(ys)}',
  ];
  for(const expr of programs)await verify(`export fn main(xs:[Num])=${expr};`,[[1,2,3]]);
});
test('strict state boundaries, guards and inactive branches retain trapping behavior',async()=>{
  const programs=[
    ['{let ys=scan(xs,0,(s,x)=>require(x>0,s+x));count(ys)+sum(ys)}',[[1,-2]],true],
    ['{let ys=scan(xs,sum(range(-1)),(s,x)=>s+x);count(ys)+sum(ys)}',[[]],false],
    ['{let ys=transduce(xs,0,(s,x)=>{state:s+1,value:sum(range(-1)),emit:false});count(ys)+sum(ys)}',[[1,2]],false],
    ['if false then {let ys=scan(xs,0,(s,x)=>sum(range(-1)));sum(ys)+count(ys)} else 8',[[1]],false],
    ['require(false,{a:sum(xs),b:sum(xs)})',[[1,2]],true],
  ];
  for(const [expr,args,traps] of programs)for(const fusion of [false,true]){
    const r=await createRuntime(compile(`export fn main(xs:[Num])=${expr};`,{experimentalReductionFusion:fusion}));
    if(traps)assert.throws(()=>r.call('main',args),WebAssembly.RuntimeError);
    else r.call('main',args);
  }
});
test('host order and quotas survive fused results without granting recurrence authority',async()=>{
  const source=`host fn tick(n:Num):Num;
  export fn main(xs:[Num])=effect{
    let a=perform tick(sum(xs));
    let b=perform tick(a+1);
    {a:a,b:b,moments:sum(xs)+sum(map(xs,x=>x*x))}
  };`;
  await verify(source,[[1,2,3]],{expected:{a:6,b:7,moments:20},run:r=>{
    const seen=[],cap=createCapability({tick:{parameters:['Num'],result:'Num',call:x=>(seen.push(x),x)}},{maxCalls:2});
    const result=r.call('main',[[1,2,3]],{capability:cap});
    assert.deepEqual(seen,[6,7]);assert.equal(cap.remaining,0);
    assert.throws(()=>r.call('main',[[1,2]],{capability:cap}),e=>e.code==='E_EFFECT_BUDGET');return result;
  }});
});
test('prepared input leases execute fused causal sinks and reject expired handles',async()=>{
  const source='export fn main(xs:[Num],scale:Num)={let ys=scan(xs,0,(s,x)=>s+x*scale);{sum:sum(ys),last:fold(ys,0,(s,x)=>x)}};';
  const c=compile(source,{experimentalReductionFusion:true}),r=await createRuntime(c),l=r.prepare('main',[[1,2,3],2]);
  assert.deepEqual(plain(l.run()),{sum:20,last:12});assert.deepEqual(plain(l.run({scale:3})),{sum:30,last:18});
  l.dispose();assert.throws(()=>l.run(),e=>e.code==='E_LEASE_EXPIRED');
});
test('every pure corpus export agrees across all fusion/memoization combinations',async()=>{
  for(const e of corpus.filter(e=>!e.host)){
    const source=await exampleSource(e,path=>readFileSync(new URL('../examples/'+path,import.meta.url),'utf8'));
    for(const memoizeReductions of [true,false]){
      let baseline;
      for(const experimentalReductionFusion of [false,true]){
        const c=compile(source,{memoizeReductions,experimentalReductionFusion}),r=await createRuntime(c,{pages:4});
        const result=plain(r.call(e.name,e.args));
        if(!experimentalReductionFusion)baseline=result;else assert.deepEqual(result,baseline,e.id);
      }
    }
  }
});
test('300 generated causal/record programs agree for all four compiler modes',async()=>{
  let seed=0x27182818;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<300;i++){
    const xs=Array.from({length:next()%18},()=>next()%11-5),cut=next()%9-4;
    const ys=[
      'scan(xs,0,(s,x)=>s+x)',
      `scan(filter(xs,x=>x>${cut}),0,(s,x)=>s+x)`,
      `filter(scan(xs,0,(s,x)=>s+x),x=>x>${cut})`,
      `transduce(xs,0,(s,x)=>{state:s+x,value:s+x,emit:x>${cut}})`,
      'map(scan(xs,{a:0,b:1},(s,x)=>{a:s.b,b:s.a+x}),s=>s.a+s.b)',
    ][i%5];
    const body=[
      '{sum:sum(ys),count:count(ys),last:fold(ys,0,(s,x)=>x)}',
      '{a:fold(ys,{a:0,b:1},(s,x)=>{a:s.b,b:s.a+x}),sum:sum(ys)}',
      'if count(ys)>2 then sum(ys)+sum(map(ys,x=>x*x)) else sum(ys)',
      '{let s=sum(ys);{first:if s>0 then s+fold(ys,0,(a,x)=>a-x) else 0,total:s}}',
    ][i%4];
    await verify(`export fn main(xs:[Num])={let ys=${ys};${body}};`,[xs]);
  }
});
