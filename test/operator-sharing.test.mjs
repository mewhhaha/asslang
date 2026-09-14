import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, instantiate} from '../src/compiler.mjs';
import {createRuntime, createCapability} from '../src/abi.mjs';
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));

for(const mode of modes)test(`identical-arm demand and saved-seed sharing ${JSON.stringify(mode)}`,async()=>{
  for(const [method,field] of [['linearize','pushforward'],['pullback','pullback']]) {
    const source=`export fn main = () -> do {
      let work=iterate 0 3 (s -> {state:s+1,done:false});
      let op=${method} (x -> x*2) 1;
      {steps:work.steps,value:op.${field} work.state}
    };`;
    const c=compile(source,{...mode,maxLoopIterations:3});
    assert.equal(c.stats.functions[0].loops,1);
    assert.deepEqual((await createRuntime(c)).call('main',[{}]),{steps:3,value:6});
    const short=await createRuntime(compile(source,{...mode,maxLoopIterations:2}));
    assert.throws(()=>short.call('main',[{}]),WebAssembly.RuntimeError);
    const reduction=source.replace('iterate 0 3 (s -> {state:s+1,done:false})','{state:sum (range 3),steps:3}');
    const rc=compile(reduction,{...mode,maxLoopIterations:3});
    assert.equal(rc.stats.functions[0].loops,1);
    assert.deepEqual((await createRuntime(rc)).call('main',[{}]),{steps:3,value:6});
  }
  const source='export fn main = (xs:[Num]) -> if (at xs 0)>0 then 7 else 7;';
  const r=await createRuntime(compile(source,mode));
  assert.throws(()=>r.call('main',[[]]),WebAssembly.RuntimeError);
  for(const x of [0,1,-1,NaN])assert.equal(r.call('main',[[x]]),7);
  const costly='export fn main = (n:Num) -> if (sum (range n))>0 then 7 else 7;';
  const limited=await createRuntime(compile(costly,{...mode,maxLoopIterations:3}));
  assert.equal(limited.call('main',[3]),7);
  assert.throws(()=>limited.call('main',[4]),WebAssembly.RuntimeError);
});

test('identical-arm elimination has linear emitted growth, without dropping the condition',async()=>{
  const blocks=Array.from({length:80},(_,i)=>`let v${i+1}=if flag then v${i} else v${i};`).join('\n');
  const source=`export fn main = (x:Num) -> (flag:Bool) -> do {let v0=x;${blocks}v80};`;
  const c=compile(source);
  assert(c.bytes.length<12000,`Unexpected branch expansion: ${c.bytes.length}`);
  const instance=await instantiate(c);
  for(const flag of [0,1])for(const value of [-0,0,7,Infinity,NaN])
    assert(Object.is(instance.exports.main(value,flag),value));
  assert.throws(()=>instance.exports.main(7,2),WebAssembly.RuntimeError);
});

test('different branch identities retain ordinary selected demand and output bits',async()=>{
  const source='export fn main = (flag:Bool) -> (xs:[Num]) -> if flag then at xs 0 else at xs 1;';
  for(const mode of modes){
    const r=await createRuntime(compile(source,mode));
    assert(Object.is(r.call('main',[true,[-0]]),-0));
    assert.throws(()=>r.call('main',[false,[-0]]),WebAssembly.RuntimeError);
    assert.equal(r.call('main',[false,[4,8]]),8);
  }
});

test('seed graphs remain differentiable by enclosing transforms',async()=>{
  for(const mode of modes)for(const [method,field] of [['linearize','pushforward'],['pullback','pullback']]) {
    const source=`export fn main = (x:Num) -> grad (p ->
      (${method} (y -> y*y) p).${field} (p*p)) x;`;
    const r=await createRuntime(compile(source,mode));
    for(const x of [-3,-1,0,2,3])assert.equal(r.call('main',[x]),6*x*x);
  }
});

test('record seed projections preserve one shared group, not one clone per leaf',async()=>{
  const source=`export fn main = () -> do {
    let work=iterate {x:0,y:1} 3 (s -> {state:{x:s.x+1,y:s.y*2},done:false});
    let plan=linearize (p -> {a:p.x*2,b:p.y*3}) {x:0,y:0};
    {steps:work.steps,result:plan.pushforward work.state}
  };`;
  for(const mode of modes){
    const c=compile(source,{...mode,maxLoopIterations:3});assert.equal(c.stats.functions[0].loops,1);
    assert.deepEqual((await createRuntime(c)).call('main',[{}]),{steps:3,result:{a:6,b:24}});
  }
});

test('seed reductions retain outer cursor scopes and invocation budgets',async()=>{
  for(const mode of modes)for(const [method,field] of [['linearize','pushforward'],['pullback','pullback']]){
    const source=`export fn main = (xs:[Num]) -> do {
      let plan=${method} (x -> x*x) 2;
      map xs (n -> plan.${field} (sum (range n)))
    };`;
    const r=await createRuntime(compile(source,{...mode,maxLoopIterations:9}));
    assert.deepEqual([...r.call('main',[[1,2,3]])],[0,4,12]);
    assert.throws(()=>r.call('main',[[1,2,4]]),WebAssembly.RuntimeError);
    assert.deepEqual([...r.call('main',[[2]])],[4]);
  }
});

test('captured effects retain one issued call when used by shared seeds',async()=>{
  const source=`host fn read:Num -> Num;
    export fn main = (x:Num) -> effect {
      let value=perform read x;
      let work=iterate value 3 (s -> {state:s+1,done:false});
      let plan=pullback (n -> n*2) 0;
      {steps:work.steps,result:plan.pullback work.state}
    };`;
  for(const mode of modes){
    const r=await createRuntime(compile(source,{...mode,maxLoopIterations:3}));const seen=[];
    assert.throws(()=>r.call('main',[4]),e=>e.code==='E_CAPABILITY');
    const capability=createCapability({read:{parameters:['Num'],result:'Num',call:x=>(seen.push(x),x)}},{maxCalls:1});
    assert.deepEqual(r.call('main',[4],{capability}),{steps:3,result:14});
    assert.deepEqual(seen,[4]);assert.equal(capability.remaining,0);
  }
});
