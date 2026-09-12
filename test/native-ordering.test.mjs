import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile, compileSources, checkSources, createCompiler, instantiate, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime, createCapability, Arena, prepareCall, readABI } from '../src/abi.mjs';
import { reference } from './reference.mjs';
import { verifyOrder } from '../examples/research/partition-order.mjs';
const modes = [false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const identity = 'export fn main = (xs:[Num]) -> sort_by xs (x -> x);';
const positions = 'export fn main = (xs:[Num]) -> range (count xs) |> sort_by (i -> at xs i);';
const countOrder = 'export fn main = (xs:[Num]) -> count (sort_by xs (x -> x));';
const expected = keys => Array.from(keys,(_,i)=>i).sort((a,b)=>keys[a]<keys[b]?-1:keys[a]>keys[b]?1:a-b);
const plain = x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
function work(n) {
  let steps=n;
  for(let width=1;width<n;width*=2)steps+=1+Math.ceil(n/(2*width))+n;
  return steps;
}

for(const mode of modes) test(`native stable permutations and exact metering ${JSON.stringify(mode)}`,async()=>{
  const c=compile(positions,mode),r=await createRuntime(c);
  assert.equal(c.abi.version,2);assert.equal(c.stats.intermediateBufferBytes,null);
  assert.equal(c.stats.scratchReservationSites,1);assert.equal(c.certificate.version,'jte-2-ordering');
  assert(verifyCertificate(c.certificate.steps));
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)).map(x=>x.kind),['memory']);
  for(const keys of [[],[1],[3,-1,3,0],[-0,0,-0,0],[-Number.MAX_VALUE,Number.MIN_VALUE,Number.MAX_VALUE]]) {
    const order=r.call('main',[keys],{scratchBytes:32*keys.length,outputBytes:8*keys.length});
    assert.deepEqual([...order],expected(keys));assert(verifyOrder(keys,[...order]));
    assert.deepEqual([...order],reference(positions,'main',[keys]));
  }
  for(const n of [0,1,2,3,5,16,33]) {
    const keys=Array.from({length:n},(_,i)=>n-i),budget=work(n);
    const runtime=await createRuntime(compile(countOrder,{...mode,maxLoopIterations:budget}));
    assert.equal(runtime.call('main',[keys],{scratchBytes:32*n}),n);
    if(budget) {
      const small=await createRuntime(compile(countOrder,{...mode,maxLoopIterations:budget-1}));
      assert.throws(()=>small.call('main',[keys]),WebAssembly.RuntimeError);
      assert.equal(small.call('main',[[]]),0);
    }
  }
});

test('all ternary words through length seven are stable native permutations',async t=>{
  const r=await createRuntime(compile(positions)),keys=[];let runs=0;
  for(let n=0;n<=7;n++)for(let word=0;word<3**n;word++) {
    let code=word;keys.length=0;
    for(let i=0;i<n;i++){keys.push(code%3-1);code=Math.floor(code/3);}
    const result=[...r.call('main',[keys])];assert.deepEqual(result,expected(keys));assert(verifyOrder(keys,result));runs++;
  }
  assert.equal(runs,3280);t.diagnostic(JSON.stringify({exhaustiveNativeRuns:runs}));
});

test('seeded and adversarial native sorts have identical index permutations',async t=>{
  let seed=32171;const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;let checks=0;
  for(const mode of modes) {
    const r=await createRuntime(compile(positions,mode),{pages:32});
    for(let i=0;i<80;i++) {
      const xs=Array.from({length:random()%100},()=>random()%31-15);
      assert.deepEqual([...r.call('main',[xs])],expected(xs));checks++;
    }
    for(const xs of [
      Array.from({length:8192},(_,i)=>i),Array.from({length:8192},(_,i)=>8192-i),
      Array(8192).fill(7),Array.from({length:8192},(_,i)=>Math.min(i,8192-i)),
    ]) {assert.deepEqual([...r.call('main',[xs])],expected(xs));checks++;}
  }
  t.diagnostic(JSON.stringify({seededAndAdversarialRuns:checks}));
});

test('record payloads, stable ties and shared projections sort once per call',async()=>{
  const s=await readFile(new URL('../examples/case-studies/ordering/ranked_readings.ass',import.meta.url),'utf8');
  for(const mode of modes) {
    const c=compile(s,{...mode,maxLoopIterations:work(5)+10}),r=await createRuntime(c);
    assert.equal(c.stats.scratchReservationSites,1);
    assert.deepEqual(plain(r.call('rank_readings',[[7,10,4,7,5],5],{scratchBytes:48*5,outputBytes:80})),
      {values:[5,4,7,7,10],positions:[4,2,0,3,1]});
    assert.throws(()=>r.call('rank_readings',[[7,10,4,7,5],5],{scratchBytes:48*5-1}),WebAssembly.RuntimeError);
  }
});

test('causal and sparse producers become seekable only across the explicit ordering barrier',async()=>{
  const s=`export fn main = (xs:[Num]) -> do {
    let ordered=xs |> scan 0 (s -> x -> s+x) |> filter (x -> x>0) |> sort_by (x -> -x);
    {values:ordered,first:if count ordered>0 then at ordered 0 else 0}
  };`;
  for(const mode of modes) {
    const c=compile(s,mode),r=await createRuntime(c);
    for(const xs of [[],[1,-5,10,-2],[0,0,0]])
      assert.deepEqual(plain(r.call('main',[xs])),reference(s,'main',[xs]));
    assert.equal(c.observations.main.fields.values.access,'indexed');
    assert.equal(c.observations.main.fields.values.dense,true);
    // Workspace deliberately reserves the source traversal bound, not accepted length.
    assert.throws(()=>r.call('main',[[0,0,0]],{scratchBytes:0}),WebAssembly.RuntimeError);
    assert.deepEqual(plain(r.call('main',[[0,0,0]],{scratchBytes:96,outputBytes:0})),{first:0,values:[]});
  }
});

test('strict barrier evaluates all accepted keys and payload fields even for count and at',async()=>{
  for(const s of [countOrder,identity.replace('sort_by xs (x -> x)','at (sort_by xs (x -> x)) 0')]) {
    const r=await createRuntime(compile(s));
    for(const xs of [[1,NaN],[1,Infinity],[1,-Infinity]])assert.throws(()=>r.call('main',[xs]),WebAssembly.RuntimeError);
  }
  const strict=`export fn main = (xs:[Num]) -> do {
    let rows=map xs (x -> {value:x,bad:require false x});
    sort_by rows (r -> r.value) |> map (r -> r.value)
  };`;
  const r=await createRuntime(compile(strict));
  assert.throws(()=>r.call('main',[[1]]),WebAssembly.RuntimeError);
  assert.deepEqual([...r.call('main',[[]])],[]);
  const filtered=await createRuntime(compile('export fn main = (xs:[Num]) -> xs |> filter (x -> x>0) |> sort_by (x -> x);'));
  assert.deepEqual([...filtered.call('main',[[-1,NaN,2]])],[2]);
});

test('unused orders and unselected branches retain lazy whole-barrier demand',async()=>{
  const unused=compile('export fn main = (xs:[Num]) -> do {let ys=sort_by xs (x -> require false x);7};');
  assert.equal(unused.abi.version,1);assert.equal(unused.stats.intermediateBufferBytes,0);
  assert.equal((await createRuntime(unused)).call('main',[[1]]),7);
  const branch=`export fn main = (xs:[Num]) -> (flag:Bool) ->
    if flag then sort_by xs (x -> require false x) else range 2;`;
  const r=await createRuntime(compile(branch));
  assert.deepEqual([...r.call('main',[[1],false],{scratchBytes:0})],[0,1]);
  assert.throws(()=>r.call('main',[[1],true]),WebAssembly.RuntimeError);
  const countBranch=await createRuntime(compile(branch.replace('if flag then sort_by xs (x -> require false x) else range 2',
    'if flag then count (sort_by xs (x -> require false x)) else 7')));
  assert.equal(countBranch.call('main',[[1],false],{scratchBytes:0}),7);
});

test('empty orders preserve source guards and lazy causal initialization',async()=>{
  const s='export fn main = (xs:[Num]) -> sort_by (scan xs (require false 0) (s -> x -> s+x)) (x -> x);';
  const r=await createRuntime(compile(s));assert.deepEqual([...r.call('main',[[]],{scratchBytes:0,outputBytes:0})],[]);
  assert.throws(()=>r.call('main',[[1]]),WebAssembly.RuntimeError);
  const guarded=await createRuntime(compile('export fn main = (xs:[Num]) -> count (sort_by (require false xs) (x -> x));'));
  assert.throws(()=>guarded.call('main',[[]]),WebAssembly.RuntimeError);
});

test('key loops run once per item, never during merge comparisons',async()=>{
  const s='export fn main = (xs:[Num]) -> sort_by xs (n -> sum (range n));';
  for(const mode of modes) {
    const n=5,budget=work(n)+15+n,r=await createRuntime(compile(s,{...mode,maxLoopIterations:budget}));
    assert.deepEqual([...r.call('main',[[5,2,4,1,3]])],[1,2,3,4,5]);
    const short=await createRuntime(compile(s,{...mode,maxLoopIterations:budget-1}));
    assert.throws(()=>short.call('main',[[5,2,4,1,3]]),WebAssembly.RuntimeError);
  }
});

test('chained stable ordering composes and reserves separate bounded regions',async()=>{
  const s=`export fn main = (xs:[Num]) -> do {
    let ordered=xs |> sort_by (x -> x) |> sort_by (x -> abs x);
    {values:ordered,total:sum ordered}
  };`;
  const r=await createRuntime(compile(s));
  assert.deepEqual(plain(r.call('main',[[2,-1,1,-2,0]],{scratchBytes:64*5,outputBytes:40})),
    {values:[0,-1,1,-2,2],total:0});
  assert.throws(()=>r.call('main',[[2,-1,1,-2,0]],{scratchBytes:64*5-1}),WebAssembly.RuntimeError);
});

test('orders used by key expressions cannot overlap an in-progress materialization',async()=>{
  const s=`export fn main = (xs:[Num]) -> do {
    let auxiliary=sort_by xs (x -> -x);
    let ordered=sort_by xs (x -> abs (x-at auxiliary 0));
    {values:ordered,auxiliary}
  };`;
  const r=await createRuntime(compile(s));
  assert.deepEqual(plain(r.call('main',[[1,4,2]],{scratchBytes:64*3,outputBytes:48})),
    {values:[4,2,1],auxiliary:[4,2,1]});
});

test('bind once outside a runtime callback; invocation caches are not per-iteration data',async()=>{
  for(const body of [
    'map xs (x -> count (sort_by (range x) (y -> y)))',
    'fold xs 0 (s -> x -> count (sort_by xs (y -> y)))',
    '(iterate 0 2 (s -> {state:count (sort_by xs (y -> y)),done:false})).state',
    'sort_by xs (x -> count (sort_by xs (y -> y)))',
  ])assert.throws(()=>compile(`export fn main = (xs:[Num]) -> ${body};`),e=>e.code==='E_ORDER_SCOPE');
  const s=`export fn main = (xs:[Num]) -> do {
    let ys=sort_by xs (x -> x);
    range (count xs) |> map (i -> at ys i)
  };`;
  for(const mode of modes) {
    const r=await createRuntime(compile(s,{...mode,maxLoopIterations:work(3)+3}));
    assert.deepEqual([...r.call('main',[[3,1,2]],{scratchBytes:96})],[1,2,3]);
  }
});

test('sorting has fresh JTE provenance, shared projections keep their sorted domain',async()=>{
  for(const body of [
    'zip xs (sort_by xs (x -> x)) (x -> y -> x+y)',
    'zip (sort_by xs (x -> x)) (sort_by xs (x -> x)) (x -> y -> x+y)',
  ])assert.throws(()=>compile(`export fn main = (xs:[Num]) -> ${body};`),e=>e.code==='E_DOMAIN');
  const s='export fn main = (xs:[Num]) -> do {let ys=sort_by xs (x -> x); zip ys (map ys (x -> x*2)) (x -> y -> x+y)};';
  const c=compile(s),r=await createRuntime(c);assert.deepEqual([...r.call('main',[[3,1,2]])],[3,6,9]);
  const bad=structuredClone(c.certificate.steps),order=bad.find(x=>x.rule==='order');
  order.domain=bad[order.parents[0]].domain;assert.throws(()=>verifyCertificate(bad),/forged/);
  const missing=structuredClone(c.certificate.steps);delete missing.find(x=>x.rule==='order').obligation;
  assert.throws(()=>verifyCertificate(missing),/ordering obligation/);
});

async function raw(source,args,scratchBytes,outputBytes=0) {
  const c=compile(source),memory=new WebAssembly.Memory({initial:4,maximum:4});
  new Uint8Array(memory.buffer).fill(0xa5);
  const arena=new Arena(memory),frame=prepareCall(arena,c.abi.exports[0],args,{scratchBytes,outputBytes});
  const i=await instantiate(c,{memory});
  return {c,memory,frame,call:(slots=frame.slots)=>i.exports.main(...slots)};
}

test('raw scratch, descriptors, output and input ranges are disjoint and checked before stores',async()=>{
  const a=await raw(identity,[[3,1,2]],96,24),before=new Uint8Array(a.memory.buffer).slice();
  const [sp,sc]=a.c.abi.exports[0].scratch.slots,[ret,out]=a.c.abi.exports[0].result.slots;
  for(const change of [
    slots=>slots[sp]=slots[0],slots=>slots[sp]=slots[ret],slots=>slots[sp]=slots[out],
    slots=>slots[sp]++,slots=>slots[sc]=-1,slots=>slots[sc]=0x7fffffff,
    slots=>slots[sp]=0xfffffff8,slots=>slots[1]=0x7fffffff,
  ]) {
    const slots=[...a.frame.slots];change(slots);assert.throws(()=>a.call(slots),WebAssembly.RuntimeError);
    assert.deepEqual(new Uint8Array(a.memory.buffer),before);
  }
  assert.deepEqual([...a.frame.lift(a.call())],[1,2,3]);
  assert.deepEqual(new Uint8Array(a.memory.buffer,0,24),before.subarray(0,24));
  const end=a.frame.outputStart+24;
  assert(new Uint8Array(a.memory.buffer,end,64).every(x=>x===0xa5));
  const short=await raw(identity,[[3,1,2]],95,24),snapshot=new Uint8Array(short.memory.buffer).slice();
  assert.throws(()=>short.call(),WebAssembly.RuntimeError);assert.deepEqual(new Uint8Array(short.memory.buffer),snapshot);
});

test('raw payload copying preserves NaN payload bits, signed zero and Bool validation',async()=>{
  const a=await raw('export fn main = (xs:[Num]) -> sort_by xs (x -> 0);',[[0,0,0,0]],128,32);
  const bits=[0x7ff8000000000042n,0x8000000000000000n,0x7ff0000000000000n,0n],v=new DataView(a.memory.buffer);
  bits.forEach((b,i)=>v.setBigUint64(a.frame.slots[0]+8*i,b,true));
  a.call();bits.forEach((b,i)=>assert.equal(v.getBigUint64(a.frame.outputStart+8*i,true),b));
  const b=await raw('export fn main = (xs:[Bool]) -> sort_by xs (x -> if x then 0 else 1);',[[false,true,true]],96,12);
  assert.deepEqual(b.frame.lift(b.call()),[true,true,false]);
  new DataView(b.memory.buffer).setUint32(b.frame.slots[0],2,true);
  assert.throws(()=>b.call(),WebAssembly.RuntimeError);
});

test('huge range reservations reject overflow before any source loop or store',async()=>{
  const a=await raw('export fn main = (n:Num) -> count (sort_by (range n) (x -> x));',[2147483647],16);
  const before=new Uint8Array(a.memory.buffer).slice();assert.throws(()=>a.call(),WebAssembly.RuntimeError);
  assert.deepEqual(new Uint8Array(a.memory.buffer),before);
});

test('prepared calls pin inputs, reset ordering flags with overrides and recover after traps',async()=>{
  const s='export fn main = (xs:[Num]) -> (center:Num) -> sort_by xs (x -> abs (x-center));';
  const r=await createRuntime(compile(s)),xs=[1,5,10],lease=r.prepare('main',[xs,0],{scratchBytes:96,outputBytes:24});
  try {
    xs[0]=99;const first=lease.run();assert.deepEqual([...first],[1,5,10]);
    assert.deepEqual([...lease.run({center:10})],[10,5,1]);
    assert.throws(()=>lease.run({center:NaN}),WebAssembly.RuntimeError);
    assert.deepEqual([...lease.run()],[1,5,10]);assert.deepEqual([...first],[1,5,10]);
  } finally {lease.dispose();}
  assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
  assert.deepEqual([...r.call('main',[[4,2],0])],[2,4]);
  const scalar=await createRuntime(compile(countOrder)),p=scalar.prepare('main',[[3,1,2]],{scratchBytes:96});
  try{assert.equal(p.run(),3);assert.equal(p.run(),3);}finally{p.dispose();}
});

test('scratch capacity options, default allocation and metadata are explicit',async()=>{
  const c=compile(identity),r=await createRuntime(c),abi=readABI(c.bytes);
  assert.deepEqual(abi.exports[0].scratch,{version:1,slots:[5,6]});
  assert.deepEqual([...r.call('main',[[3,1,2]])],[1,2,3]);
  for(const scratchBytes of [-1,NaN,Infinity,1.5,null,'96'])
    assert.throws(()=>r.call('main',[[1]],{scratchBytes}));
  assert.throws(()=>r.call('main',[[3,1,2]],{scratchBytes:95}),WebAssembly.RuntimeError);
  assert.throws(()=>r.call('main',[[3,1,2]],{scratchBytes:96,outputBytes:23}),WebAssembly.RuntimeError);
  assert.deepEqual([...r.call('main',[[]],{scratchBytes:0,outputBytes:0})],[]);
  const old=await createRuntime(compile('export fn main = (n:Num) -> n;'));
  assert.throws(()=>old.call('main',[1],{scratchBytes:0}),/scratchBytes/);
  const bytes=c.bytes.slice(),from=Buffer.from('"slots":[5,6]'),at=Buffer.from(bytes).indexOf(from);
  assert(at>=0);bytes[at+from.length-2]=55;
  assert.throws(()=>readABI(bytes),e=>e.code==='E_ABI_SCHEMA');
});

test('effects still require capabilities, retain order and use the same sort loop budget',async()=>{
  const s=`host fn audit:Num -> Bool;
    export fn main = (xs:[Num]) -> effect {
      let first=perform audit 1;
      let second=perform audit (count (sort_by xs (x -> x)));
      {first,second}
    };`;
  const c=compile(s,{maxLoopIterations:work(3)}),r=await createRuntime(c),seen=[];
  assert.throws(()=>r.call('main',[[3,1,2]]),e=>e.code==='E_CAPABILITY');
  const cap=createCapability({audit:{parameters:['Num'],result:'Bool',call:x=>(seen.push(x),true)}},{maxCalls:2});
  assert.deepEqual(r.call('main',[[3,1,2]],{capability:cap,scratchBytes:96}),{first:true,second:true});
  assert.deepEqual(seen,[1,3]);
  const failing=await createRuntime(compile(s,{maxLoopIterations:0})),trace=[];
  const grant=createCapability({audit:{parameters:['Num'],result:'Bool',call:x=>(trace.push(x),true)}},{maxCalls:2});
  assert.throws(()=>failing.call('main',[[3,1,2]],{capability:grant}),WebAssembly.RuntimeError);
  assert.deepEqual(trace,[1]);
});

test('shape, type, differentiation and named-source diagnostics remain checked',()=>{
  for(const s of [
    'export fn main = (xs:[Num]) -> sort_by xs (x -> true);',
    'export fn main = (xs:[Num]) -> sort_by xs (x -> {x});',
  ])assert.throws(()=>compile(s),e=>e.code==='E_TYPE');
  assert.throws(()=>compile('export fn main = (xs:[Num]) -> count (sort_by (map xs (x -> {})) (x -> 0));'),e=>e.code==='E_ORDER_TYPE');
  assert.throws(()=>compile('export fn main = (xs:[Num]) -> sort_by (map xs (x -> {x})) (r -> r.x);'),e=>e.code==='E_ABI');
  assert.throws(()=>compile('host fn score:Num -> Num;export fn main = (xs:[Num]) -> sort_by xs (x -> score x);'),e=>e.code==='E_EFFECT');
  assert.throws(()=>compile('export fn main = (n:Num) -> grad (x -> at (sort_by (range 3) (y -> x*y)) 0) n;'),e=>e.code==='E_DIFF_UNSUPPORTED');
  const bad='export fn main = (xs:[Num]) -> sort_by xs (x -> missing x);';
  const report=checkSources([{name:'ranking.ass',source:bad}]);
  assert.equal(report.diagnostics[0].code,'E_NAME');assert.equal(report.diagnostics[0].sourceName,'ranking.ass');
  assert.equal(report.diagnostics[0].range.start.offset,bad.indexOf('missing'));
  const scoped='export fn main = (xs:[Num]) -> map xs (x -> count (sort_by xs (y -> y)));';
  assert.throws(()=>compileSources([{name:'nested.ass',source:scoped}]),e=>e.code==='E_ORDER_SCOPE'&&e.sourceName==='nested.ass');
});

test('payload width and number of sites have explicit resource bounds',async()=>{
  const fields=n=>Array.from({length:n},(_,i)=>`f${i}:x`).join(',');
  const source=n=>`export fn main = (xs:[Num]) -> sort_by (map xs (x -> {${fields(n)}})) (r -> r.f0) |> map (r -> r.f0);`;
  const c=compile(source(32));assert.equal(c.stats.functions[0].ordering.sites[0].rowBytes,264);
  assert.deepEqual([...(await createRuntime(c)).call('main',[[2,1]],{scratchBytes:1056})],[1,2]);
  assert.throws(()=>compile(source(33)),e=>e.code==='E_ORDER_TYPE');
  const sites=n=>'export fn main = (xs:[Num]) -> {'+Array.from({length:n},(_,i)=>`v${i}:sort_by xs (x -> x)`).join(',')+'};';
  assert.equal(compile(sites(32)).stats.scratchReservationSites,32);
  assert.throws(()=>compile(sites(33)),e=>e.code==='E_LIMIT');
});

test('partial applications, symbol fields and vertical layout retain ordinary composition',async()=>{
  const s=`symbol value;
    fn ascending = xs -> sort_by xs (x -> x[value]);
    export fn main = (xs:[Num]) ->
      xs
      |> map (x -> {[value]:x,flag:x>0})
      |> ascending
      |> map (r -> r[value]);`;
  const c=compile(s);assert.deepEqual(c.bytes,compile(s.replace(/\s+/g,' ')).bytes);
  assert.deepEqual(c.bytes,compile(s.replaceAll('\n','\r\n')).bytes);
  assert.deepEqual([...(await createRuntime(c)).call('main',[[3,-1,2]])],[-1,2,3]);
  const partial='fn sorter = xs -> sort_by xs;export fn main = (xs:[Num]) -> (sorter xs) (x -> -x);';
  assert.deepEqual([...(await createRuntime(compile(partial))).call('main',[[3,1,2]])],[3,2,1]);
});

test('compiler snapshots, old modules and mixed-module raw slots remain compatible',async()=>{
  const session=createCompiler(),c=session.compile(identity);c.bytes.fill(0);c.abi.version=999;
  const cached=session.compile(identity);assert(cached.cache.hit);assert.equal(readABI(cached.bytes).version,2);
  assert.deepEqual([...(await createRuntime(cached)).call('main',[[2,1]])],[1,2]);
  const mixed=compile(identity+' export fn scalar = (n:Num) -> n+1;');
  assert.equal(mixed.abi.version,2);assert(!mixed.abi.exports[1].scratch);
  assert.equal((await createRuntime(mixed)).call('scalar',[3]),4);
  const golden=Buffer.from(await readFile(new URL('./fixtures/asabi1-snapshot.wasm.base64',import.meta.url),'utf8'),'base64');
  assert.equal(readABI(golden).version,1);
  assert.equal((await createRuntime(golden)).call('snapshot',[{label:'old',values:[1,2,3]}]).total,6);
});

test('transduced events and conditional reuse retain their upstream clocks',async()=>{
  const source=`export fn main = (xs:[Num]) -> do {
    let emitted=transduce xs 0 (s -> x -> {state:s+x,value:s+x,emit:x>0});
    let ordered=sort_by emitted (x -> -x);
    {values:ordered,total:sum ordered}
  };`;
  const r=await createRuntime(compile(source));
  assert.deepEqual(plain(r.call('main',[[2,-5,6,-1,2]])),{values:[4,3,2],total:9});
  const lazy=`export fn main = (xs:[Num]) -> do {
    let bad=sort_by xs (x -> require false x);
    let good=sort_by (filter xs (x -> x>0)) (x -> x+count bad);
    count good
  };`;
  const guarded=await createRuntime(compile(lazy));
  assert.equal(guarded.call('main',[[-1,-2]],{scratchBytes:64}),0);
  assert.throws(()=>guarded.call('main',[[1]]),WebAssembly.RuntimeError);
});

test('published sources, example driver and CLI are executable as documented',async()=>{
  const doc=await readFile(new URL('../docs/NATIVE-ORDERING.md',import.meta.url),'utf8');
  const snippets=[...doc.matchAll(/<!-- native-example: (\w+) -->\n```ass\n([\s\S]*?)\n```/g)];
  assert.equal(snippets.length,2);
  for(const [,name,body] of snippets)assert.equal(body+'\n',await readFile(new URL(`../examples/case-studies/ordering/${name}.ass`,import.meta.url),'utf8'));
  const {spawnSync}=await import('node:child_process');
  const run=spawnSync(process.execPath,['examples/interop/native-ordering.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  assert.equal(result.minimumLoopAllowance,39);assert.deepEqual(result.result.positions,[4,2,0,3,1]);
  const cli=spawnSync(process.execPath,['src/cli.mjs','examples/case-studies/ordering/nearest.ass','--run','nearest','--args','[[7,10,4,7,5],5]'],
    {cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),[5,4,7,7,10]);
});
