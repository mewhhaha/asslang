import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compileSources,checkSources,instantiate,createCompiler,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime,createCapability,Arena,prepareCall} from '../src/abi.mjs';
import {reference} from './reference.mjs';
const library={name:'windows.ass',source:await readFile(new URL('../lib/windows.ass',import.meta.url),'utf8')};
const files=s=>[library,{name:'client.ass',source:s}];
const program=body=>`export fn main = (xs:[Num]) -> (w:Num) -> (s:Num) -> ${body};`;
const sumSource=program('window_map xs w s sum');
const taps=program('window_map xs w s (b -> at b 0 + at b (count b-1))');
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>[false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const windows=(xs,w,s)=>{const out=[];for(let i=0;i+w<=xs.length;i+=s)out.push(xs.slice(i,i+w));return out;};
const sum=xs=>xs.reduce((s,x)=>s+x,0);
const reject=(s,code)=>assert.equal(checkSources(files(s)).diagnostics[0].code,code);

for(const mode of modes)test(`window maps: independent slices and exact work ${JSON.stringify(mode)}`,async()=>{
  const sums=compileSources(files(sumSource),mode),pointwise=compileSources(files(taps),mode);
  for(const c of [sums,pointwise]){assert.equal(c.abi.version,1);assert.equal(c.stats.intermediateBufferBytes,0);
    assert.equal(c.stats.kernelHeapAllocationSites,0);assert(!c.stats.scratchReservationSites);assert(verifyCertificate(c.certificate.steps));}
  const r=await createRuntime(sums),p=await createRuntime(pointwise);
  for(const xs of [[],[2],[1,2,3,4,5],[-0,0,3,-2,7]])for(const w of [1,2,3,7])for(const s of [1,2,4]){
    const blocks=windows(xs,w,s);
    assert.deepEqual([...r.call('main',[xs,w,s])],blocks.map(sum));
    assert.deepEqual([...p.call('main',[xs,w,s])],blocks.map(b=>b[0]+b.at(-1)));
    assert.deepEqual(reference(library.source+'\n'+sumSource,'main',[xs,w,s]),blocks.map(sum));
  }
  for(const [source,units] of [[sumSource,12],[taps,3]]){
    const c=compileSources(files(source),{...mode,maxLoopIterations:units}),q=await createRuntime(c);
    assert.equal(q.call('main',[[1,2,3,4,5],3,1],{outputBytes:24}).length,3);
    assert.throws(()=>q.call('main',[[1,2,3,4,5],3,1],{outputBytes:23}),WebAssembly.RuntimeError);
    const small=await createRuntime(compileSources(files(source),{...mode,maxLoopIterations:units-1}));
    assert.throws(()=>small.call('main',[[1,2,3,4,5],3,1]),WebAssembly.RuntimeError);
    assert.equal(small.call('main',[[],3,1],{outputBytes:0}).length,0);
  }
});

test('exhaust binary arrays and width/stride combinations with a separate slice oracle',async t=>{
  const r=await createRuntime(compileSources(files(sumSource)));let count=0;
  for(let n=0;n<=7;n++)for(let bits=0;bits<2**n;bits++){
    const xs=Array.from({length:n},(_,i)=>bits>>i&1);
    for(let w=1;w<=n+2;w++)for(let s=1;s<=4;s++){
      assert.deepEqual([...r.call('main',[xs,w,s])],windows(xs,w,s).map(sum));count++;
    }
  }
  t.diagnostic(JSON.stringify({exhaustiveCases:count}));
});

test('parameters are structural even on empty/count demand; unused maps remain lazy',async()=>{
  for(const body of ['window_map xs w s sum','count (window_map xs w s (b -> require false 0))']){
    const r=await createRuntime(compileSources(files(program(body))));
    for(const bad of [0,-0,-1,0.5,NaN,Infinity,-Infinity,2147483648])for(const xs of [[],[1,2]]){
      assert.throws(()=>r.call('main',[xs,bad,1]),WebAssembly.RuntimeError);
      assert.throws(()=>r.call('main',[xs,1,bad]),WebAssembly.RuntimeError);
    }
  }
  const lazy=await createRuntime(compileSources(files(program('do {let unused=window_map xs w s sum;7}'))));
  assert.equal(lazy.call('main',[[1],0,0]),7);
  const count=await createRuntime(compileSources(files(program('count (window_map xs w s (b -> require false 0))'))));
  assert.equal(count.call('main',[[1,2,3],2,1]),2);
  const guarded=await createRuntime(compileSources(files(program('count (window_map (require false xs) w s sum)'))));
  assert.throws(()=>guarded.call('main',[[],1,1]),WebAssembly.RuntimeError);
});

test('selected output reads only its window and keeps INT32_MAX arithmetic bounded',async()=>{
  const body='export fn main = (n:Num) -> (w:Num) -> (s:Num) -> (i:Num) -> at (window_map (range n) w s (b -> at b (count b-1))) i;';
  const c=compileSources(files(body),{maxLoopIterations:0}),f=(await instantiate(c)).exports.main;
  assert.equal(c.stats.functions[0].loops,0);assert.equal(c.stats.needsMemory,false);
  for(const n of [1,1e9,2147483647])for(const w of [1,2,3,1009,2147483647])for(const s of [1,2,7,65537,2147483647]){
    if(w>n)continue;
    const last=Number((BigInt(n)-BigInt(w))/BigInt(s));
    assert.equal(f(n,w,s,last),Number(BigInt(last)*BigInt(s)+BigInt(w)-1n));
    assert.throws(()=>f(n,w,s,last+1),WebAssembly.RuntimeError);
  }
  const selected=await createRuntime(compileSources(files(program('at (window_map xs w s (b -> sum (map b (x -> require (x>=0) x)))) 0'))));
  assert.equal(selected.call('main',[[1,2,-99],2,1]),3);
  assert.throws(()=>selected.call('main',[[1,-99,2],2,1]),WebAssembly.RuntimeError);
});

test('map composition and helper extraction preserve emitted bytes without a new optimizer',async()=>{
  const left=program('window_map xs w s (b -> at b 0) |> map (x -> x*2+1)');
  const right=program('window_map xs w s (b -> (at b 0)*2+1)');
  for(const mode of modes)assert.deepEqual(compileSources(files(left),mode).bytes,compileSources(files(right),mode).bytes);
  const partial=`fn endpoint = b -> at b 0; export fn main = (xs:[Num]) -> do {
    let {run}={run:window_map xs 2}; run 1 endpoint
  };`;
  assert.deepEqual([...(await createRuntime(compileSources(files(partial)))).call('main',[[1,2,3]])],[1,2]);
  const polymorphic='export fn main = () -> {numbers:window_map (range 3) 2 1 count,flags:window_map (range 3) 2 1 (b -> at b 0>0)};';
  assert.deepEqual(plain((await createRuntime(compileSources(files(polymorphic)))).call('main',[{}])),{numbers:[2,2],flags:[false,true]});
});

test('local scan and stopping-fold callbacks reset per window without histories',async()=>{
  const scan=program('window_map xs w s (b -> sum (scan b 0 (total -> x -> total+x)))');
  const stop=program('window_map xs w s (b -> (fold_until (scan b 0 (total -> x -> require (x>=0) (total+x))) 0 (old -> x -> {state:x,done:x>=3})).state)');
  for(const mode of modes){
    const r=await createRuntime(compileSources(files(scan),mode));
    const xs=[1,2,3,4,5];
    assert.deepEqual([...r.call('main',[xs,3,1])],windows(xs,3,1).map(b=>{let state=0;return sum(b.map(x=>state+=x));}));
    assert.deepEqual([...(await createRuntime(compileSources(files(stop),mode))).call('main',[[3,-99,3,-99],2,2])],[3,3]);
  }
});

test('nested scopes and shared-output zips preserve provenance without claiming overlap is a cover',async()=>{
  const nested=program('map (range 3) (offset -> sum (window_map (map xs (x -> x+offset)) w s sum))');
  const input=[1,2,3,4];
  for(const mode of modes)assert.deepEqual([...(await createRuntime(compileSources(files(nested),mode))).call('main',[input,2,1])],[15,21,27]);
  const shared=program('do {let ys=window_map xs w s sum;zip ys (map ys (x -> x*2)) (a -> b -> a+b)}');
  assert.deepEqual([...(await createRuntime(compileSources(files(shared)))).call('main',[input,2,1])],[9,15,21]);
  reject(program('zip xs (window_map xs w s sum) (a -> b -> a+b)'),'E_DOMAIN');
  reject(program('zip (window_map xs w s sum) (window_map xs w s sum) (a -> b -> a+b)'),'E_DOMAIN');
  reject(program('window_map (filter xs (x -> x>0)) w s sum'),'E_VIEW_DENSE');
  reject(program('window_map (scan xs 0 (s -> x -> s+x)) w s sum'),'E_VIEW_ACCESS');
});

test('f64 window sums retain per-window order rather than a cancelling prefix subtraction',async()=>{
  const r=await createRuntime(compileSources(files(sumSource)));
  const xs=[1e16,1,1];assert.deepEqual([...r.call('main',[xs,2,1])],[1e16,2]);
  let acc=0;const prefix=[0,...xs.map(x=>acc+=x)];assert.equal(prefix[3]-prefix[1],0);
  assert.deepEqual([...r.call('main',[[Infinity,-Infinity,NaN],2,1])],[NaN,NaN]);
});

test('Bool and record payloads stay staged and no window can escape the scalar-stream ABI',async()=>{
  const bool='export fn main = (xs:[Bool]) -> window_map xs 2 1 (b -> at b 0 && at b 1);';
  assert.deepEqual((await createRuntime(compileSources(files(bool)))).call('main',[[true,true,false,true]]),[true,false,false]);
  const row=program('window_map (map xs (x -> {value:x,ok:x>0})) w s (b -> (at b 0).ok)');
  assert.deepEqual((await createRuntime(compileSources(files(row)))).call('main',[[-1,2,3],2,1]),[false,true]);
  assert.equal(checkSources(files(program('window_map xs w s (b -> b)'))).ok,false);
  reject('export fn main = (xs:[Num]) -> window_map xs true 1 sum;','E_TYPE');
  const diagnostic=checkSources(files(program('window_map xs w s (b -> missing b)'))).diagnostics[0];
  assert.equal(diagnostic.code,'E_NAME');assert.equal(diagnostic.sourceName,'client.ass');
  assert.equal(diagnostic.range.start.offset,program('window_map xs w s (b -> missing b)').indexOf('missing'));
  reject(program('window_map xs w s (b -> count (sort_by b (x -> x)))'),'E_ORDER_SCOPE');
});

test('raw canaries, signed-zero bits and prepared calls preserve input/output ownership',async()=>{
  const source=program('window_map xs w s (b -> at b 0)');
  const c=compileSources(files(source)),memory=new WebAssembly.Memory({initial:1,maximum:1});
  new Uint8Array(memory.buffer).fill(0xa5);
  const frame=prepareCall(new Arena(memory),c.abi.exports[0],[[0,0,0],1,1],{outputBytes:24});
  const view=new DataView(memory.buffer),bits=[0x8000000000000000n,0x7ff8000000000042n,0x7ff0000000000000n];
  bits.forEach((x,i)=>view.setBigUint64(frame.slots[0]+8*i,x,true));
  const instance=await instantiate(c,{memory}),end=instance.exports.main(...frame.slots),p=view.getUint32(frame.resultPointer,true);
  assert.deepEqual(bits,bits.map((_,i)=>view.getBigUint64(p+8*i,true)));
  assert(new Uint8Array(memory.buffer,end,16).every(x=>x===0xa5));
  const before=new Uint8Array(memory.buffer).slice(),bad=[...frame.slots];bad[c.abi.exports[0].result.slots[1]]=bad[0];
  assert.throws(()=>instance.exports.main(...bad),WebAssembly.RuntimeError);assert.deepEqual(new Uint8Array(memory.buffer),before);
  const compiler=createCompiler();compiler.compileSources(files(sumSource)).bytes.fill(0);
  const cached=compiler.compileSources(files(sumSource));assert(cached.cache.hit);
  const runtime=await createRuntime(cached),xs=[1,2,3,4],lease=runtime.prepare('main',[xs,2,1],{outputBytes:32});
  try{xs[0]=99;const a=lease.run();assert.deepEqual([...a],[3,5,7]);
    assert.deepEqual([...lease.run({s:2})],[3,7]);assert.throws(()=>lease.run({w:0}),WebAssembly.RuntimeError);
    assert.deepEqual([...lease.run()],[3,5,7]);a[0]=9;assert.equal(lease.run()[0],3);
  }finally{lease.dispose();}
  assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
});

test('effects and sorting keep their independent authority and scratch boundaries',async()=>{
  reject('host fn read:Num -> Num;'+program('window_map xs w s (b -> read (sum b))'),'E_EFFECT');
  const effect='host fn audit:Num -> Bool;export fn main = (xs:[Num]) -> effect {perform audit 1;window_map xs 2 1 sum};';
  const r=await createRuntime(compileSources(files(effect),{maxLoopIterations:0})),seen=[];
  assert.throws(()=>r.call('main',[[1,2]]),e=>e.code==='E_CAPABILITY');
  const cap=createCapability({audit:{parameters:['Num'],result:'Bool',call:x=>(seen.push(x),true)}},{maxCalls:1});
  assert.throws(()=>r.call('main',[[1,2]],{capability:cap}),WebAssembly.RuntimeError);assert.deepEqual(seen,[1]);
  const sorted=await createRuntime(compileSources(files(program('window_map (sort_by xs (x -> x)) w s sum'))));
  assert.deepEqual([...sorted.call('main',[[3,1,2],2,1],{scratchBytes:96})],[3,5]);
  assert.throws(()=>sorted.call('main',[[3,1,2],2,1],{scratchBytes:95}),WebAssembly.RuntimeError);
});

test('published examples, CLI and exact-budget comparison execute',async()=>{
  const doc=await readFile(new URL('../docs/WINDOW-MAPS.md',import.meta.url),'utf8');
  const snippets=[...doc.matchAll(/<!-- window-example: (\w+) -->\n```ass\n([\s\S]*?)\n```/g)];assert.equal(snippets.length,3);
  for(const [,name,source] of snippets){
    assert.equal(source+'\n',await readFile(new URL(`../examples/case-studies/windows/${name}.ass`,import.meta.url),'utf8'));
    assert.deepEqual(compileSources(files(source)).bytes,compileSources(files(source.replaceAll('\n','\r\n'))).bytes);
  }
  const run=spawnSync(process.execPath,['examples/interop/window-maps.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr);const output=JSON.parse(run.stdout);assert.deepEqual(output.reports.map(r=>r.loopUnits),[3,12,3]);
  const cli=spawnSync(process.execPath,['examples/case-studies/app.mjs','window-smooth'],{cwd:new URL('../',import.meta.url),input:'[[2,4,8,4,2]]',encoding:'utf8',timeout:15000});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),[4.5,6,4.5]);
});

test('seeded neighborhoods and local chunk callbacks compose without stored windows',async t=>{
  let seed=381,cases=0;const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(const mode of modes){
    const r=await createRuntime(compileSources(files(sumSource),mode));
    for(let k=0;k<60;k++){
      const xs=Array.from({length:random()%120},()=>random()%31-15),w=1+random()%19,s=1+random()%11;
      assert.deepEqual([...r.call('main',[xs,w,s])],windows(xs,w,s).map(sum));cases++;
    }
    const chunked=program('xs |> chunks 4 |> map (b -> sum (window_map b w s sum))');
    assert.deepEqual([...(await createRuntime(compileSources(files(chunked),mode))).call('main',[[1,2,3,4,5,6,7],2,1])],[15,24]);
  }
  t.diagnostic(JSON.stringify({seededCases:cases}));
});

test('neighborhood report shares one causal traversal only when fusion is enabled',async()=>{
  const source=await readFile(new URL('../examples/case-studies/windows/neighborhood_report.ass',import.meta.url),'utf8');
  for(const mode of modes){
    const units=mode.reductionFusion?3:9,c=compileSources(files(source),{...mode,maxLoopIterations:units});
    assert.equal(c.stats.functions[0].loops,mode.reductionFusion?1:3);
    const r=await createRuntime(c);assert.deepEqual(plain(r.call('neighborhood_report',[[2,4,8,4,2]],{outputBytes:48})),
      {slopes:[3,0,-3],totals:[3,3,0],state:{slope:-3,total:0}});
    const short=await createRuntime(compileSources(files(source),{...mode,maxLoopIterations:units-1}));
    assert.throws(()=>short.call('neighborhood_report',[[2,4,8,4,2]]),WebAssembly.RuntimeError);
  }
});
