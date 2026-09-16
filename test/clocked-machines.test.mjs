import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { compileSources, checkSources, createCompiler, instantiate, verifyCertificate } from '../src/compiler.mjs';
import { primitiveArities, builtinArities } from '../src/frontend.mjs';
import { createRuntime, createCapability, Arena, prepareCall } from '../src/abi.mjs';
import { reference } from './reference.mjs';
import { clockedMachineCases } from './clocked-machines-cases.mjs';
import { runClockedMachineBrowserChecks } from './clocked-machines-browser.mjs';

const libraries=await Promise.all(['reducers','machines'].map(async name=>({name:`${name}.ass`,
  source:await readFile(new URL(`../lib/${name}.ass`,import.meta.url),'utf8')})));
const files=source=>[...libraries,{name:'client.ass',source}];
const refSource=source=>libraries.map(l=>l.source).join('\n')+'\n'+source;
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const load=name=>readFile(new URL(`../examples/case-studies/machines/${name}.ass`,import.meta.url),'utf8');
const runtime=async(source,options={})=>createRuntime(compileSources(files(source),options));
const failure=(source,code)=>assert.equal(checkSources(files(source)).diagnostics[0]?.code,code);

for(const c of clockedMachineCases)test(`source machine: ${c.name}`,async()=>{
  for(const mode of modes){
    const cpl=compileSources(files(c.source),mode),r=await createRuntime(cpl);
    assert.deepEqual(plain(r.call('main',c.args)),c.expected);
    assert.deepEqual(reference(refSource(c.source),'main',c.args),c.expected);
    assert(verifyCertificate(cpl.certificate.steps));
    assert.equal(cpl.stats.intermediateBufferBytes,0);assert.equal(cpl.abi.version,1);
    assert.equal(cpl.stats.kernelHeapAllocationSites,0);
    assert(WebAssembly.Module.imports(new WebAssembly.Module(cpl.bytes)).every(x=>x.kind==='memory'));
  }
});

test('explicit renamed source and core-only mode have no privileged compiler body',()=>{
  assert.equal(Object.keys(primitiveArities).length,33);assert.equal(Object.keys(builtinArities).length,37);
  const renamed=text=>text.replace(/\bmachine_(then|reset_when|states_from|states)\b/g,'ordinary_$1');
  for(const c of clockedMachineCases)for(const mode of modes){
    const cpl=compileSources(files(c.source),mode);
    assert.deepEqual(cpl.bytes,compileSources(files(c.source),{...mode,prelude:false}).bytes);
    assert.deepEqual(cpl.bytes,compileSources(files(c.source).map(f=>({...f,source:renamed(f.source)})),mode).bytes);
  }
  const missing=checkSources([{name:'client.ass',source:clockedMachineCases[0].source}]);
  assert.equal(missing.diagnostics[0].code,'E_NAME');
});

// This oracle is a direct loop, not a translation through the source library.
function monitorOracle(xs,resets,config,saved={left:0,right:false}){
  let mean=saved.left,on=saved.right;const means=[],alarms=[];
  xs.forEach((x,i)=>{
    if(resets[i]){mean=0;on=false;}
    mean=mean+config.alpha*(x-mean);
    on=on?mean>config.low:mean>=config.high;
    means.push(mean);alarms.push(on);
  });
  return {means,alarms,state:{left:mean,right:on}};
}

test('composed monitor has one shared schedule and exact work/output capacities',async()=>{
  const source=await load('resumable_pipeline'),xs=[0,8,8,0,8,0],resets=[false,false,false,false,true,false];
  const config={alpha:0.5,low:3,high:6},initial={left:0,right:false};
  for(const mode of modes){
    const units=mode.reductionFusion?6:18;
    const cpl=compileSources(files(source),{...mode,maxLoopIterations:units});
    assert.equal(cpl.stats.functions[0].loops,mode.reductionFusion?1:3);
    assert.equal(cpl.stats.functions[0].stateSlots,mode.reductionFusion?2:6);
    const r=await createRuntime(cpl),args=[xs,resets,config,initial];
    assert.deepEqual(plain(r.call('monitor_chunk',args,{outputBytes:72})),monitorOracle(...args));
    assert.throws(()=>r.call('monitor_chunk',args,{outputBytes:71}),WebAssembly.RuntimeError);
    const smaller=await runtime(source,{...mode,maxLoopIterations:units-1});
    assert.throws(()=>smaller.call('monitor_chunk',args),WebAssembly.RuntimeError);
    assert.deepEqual(plain(smaller.call('monitor_chunk',[[],[],config,initial],{outputBytes:0})),monitorOracle([],[],config,initial));
  }
});

test('every resume split, empty chunk and JSON round trip preserves monitor resets',async t=>{
  const source=await load('resumable_pipeline'),config={alpha:0.5,low:3,high:6};let cases=0;
  for(const mode of modes){
    const r=await runtime(source,mode);
    for(const [xs,resets] of [
      [[],[]],[[0,8,8,0,8,0],[false,false,false,false,true,false]],
      [[8,0,8,8,0,0],[true,false,true,false,false,true]],
    ])for(let cut=0;cut<=xs.length;cut++){
      const original=JSON.stringify({config,xs,resets});
      const a=r.call('monitor_chunk',[xs.slice(0,cut),resets.slice(0,cut),config,{left:0,right:false}]);
      // The schema/config envelope belongs to this caller, not a machine proof.
      const saved=JSON.parse(JSON.stringify({schemaVersion:1,config,state:a.state}));
      const empty=r.call('monitor_chunk',[[],[],saved.config,saved.state]);
      assert.deepEqual(empty.state,saved.state);
      const b=r.call('monitor_chunk',[xs.slice(cut),resets.slice(cut),saved.config,saved.state]);
      assert.deepEqual({means:[...a.means,...b.means],alarms:[...a.alarms,...b.alarms],state:b.state},monitorOracle(xs,resets,config));
      assert.equal(JSON.stringify({config,xs,resets}),original);cases++;
    }
  }
  t.diagnostic(JSON.stringify({splitRoundTrips:cases}));
});

test('held lanes ignore disabled payloads but keep both observations on every event',async()=>{
  const source=await load('held_channels');
  const args=[[1,NaN,3,Infinity],[true,false,true,false],[NaN,20,Infinity,40],[false,true,false,true]];
  const expected={left:[1,1,4,4],right:[0,20,20,60],state:{left:4,right:60}};
  for(const mode of modes){
    const units=mode.reductionFusion?4:12,cpl=compileSources(files(source),{...mode,maxLoopIterations:units});
    const r=await createRuntime(cpl);assert.deepEqual(plain(r.call('held_channels',args,{outputBytes:64})),expected);
    assert.equal(cpl.stats.functions[0].runtimeZipChecks,mode.reductionFusion?3:9);
    assert.equal(cpl.stats.intermediateBufferBytes,0);
    assert.throws(()=>r.call('held_channels',[[1,NaN],[true,true],[2,3],[true,true]]),WebAssembly.RuntimeError);
    assert.throws(()=>r.call('held_channels',[[1],[true],[],[]]),WebAssembly.RuntimeError);
    assert.throws(()=>r.call('held_channels',args,{outputBytes:63}),WebAssembly.RuntimeError);
    assert.deepEqual(plain(r.call('held_channels',[[],[],[],[]],{outputBytes:0})),{left:[],right:[],state:{left:0,right:0}});
  }
});

test('all short independent gate patterns agree with the direct held-state oracle',async t=>{
  const r=await runtime(await load('held_channels'));let cases=0;
  for(let n=0;n<=6;n++)for(let word=0;word<4**n;word++){
    let bits=word;const left=[],right=[],a=[],b=[],lo=[],ro=[];let ls=0,rs=0;
    for(let i=0;i<n;i++){
      a.push(Boolean(bits&1));b.push(Boolean(bits&2));bits=Math.floor(bits/4);
      left.push(a[i]?i+1:NaN);right.push(b[i]?-(i+1):Infinity);
      if(a[i])ls+=left[i];if(b[i])rs+=right[i];lo.push(ls);ro.push(rs);
    }
    assert.deepEqual(plain(r.call('held_channels',[left,a,right,b])),{left:lo,right:ro,state:{left:ls,right:rs}});cases++;
  }
  assert.equal(cases,5461);t.diagnostic(JSON.stringify({independentGateWords:cases}));
});

test('shared-prefix product factoring preserves results but uses one prefix state',async t=>{
  const source=await load('shared_prefix');
  const duplicate=source.replace('smooth_signal alpha |> machine_then observers',
    'reducer_product (smooth_signal alpha |> machine_then (sum_reducer ())) (smooth_signal alpha |> machine_then (peak_signal ()))');
  let cases=0,seed=881;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(const mode of modes){
    const a=compileSources(files(source),mode),b=compileSources(files(duplicate),mode);
    const ar=await createRuntime(a),br=await createRuntime(b);
    assert.equal(a.stats.functions[0].stateSlots,mode.reductionFusion?3:9);
    assert.equal(b.stats.functions[0].stateSlots,mode.reductionFusion?4:12);
    assert.equal(a.stats.intermediateBufferBytes,0);assert.equal(b.stats.intermediateBufferBytes,0);
    for(let trial=0;trial<50;trial++){
      const xs=Array.from({length:rand()%30},()=>rand()%31-15),alpha=0.5;
      const actual=plain(ar.call('shared_prefix',[xs,alpha]));
      let mean=0,total=0,peak=0;const totals=[],peaks=[];
      for(const x of xs){mean=mean+alpha*(x-mean);total+=mean;peak=Math.max(peak,Math.abs(mean));totals.push(total);peaks.push(peak);}
      assert.deepEqual(actual,{totals,peaks,summary:{left:total,right:peak}});
      assert.deepEqual(actual,plain(br.call('shared_prefix',[xs,alpha])));cases++;
    }
  }
  t.diagnostic(JSON.stringify({sharedPrefixCases:cases}));
});

test('serial association has equal traces and explicitly reassociated checkpoints',async t=>{
  const prelude=`fn a = () -> {initial:1,step:s -> x -> s*0.5+x,finish:s -> s};
    fn b = () -> mean_reducer ();
    fn c = () -> {initial:{total:0,positive:false},step:s -> x -> {total:s.total+x,positive:x>0},finish:s -> s.total};`;
  const make=(name,body,state)=>`${prelude} export fn ${name} = (xs:[Num]) -> do {
    let m=${body};let h=machine_states xs m;let last=fold h m.initial (s -> x -> x);
    {trace:map h m.finish,state:${state}}
  };`;
  const left=make('main','machine_then (machine_then (a ()) (b ())) (c ())','{a:last.left.left,b:last.left.right,c:last.right}');
  const right=make('main','machine_then (a ()) (machine_then (b ()) (c ()))','{a:last.left,b:last.right.left,c:last.right.right}');
  let seed=429,cases=0;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(const mode of modes){
    const l=await runtime(left,mode),r=await runtime(right,mode);
    for(let i=0;i<40;i++){
      const xs=Array.from({length:rand()%20},()=>rand()%19-9);
      const actual=plain(l.call('main',[xs]));assert.deepEqual(actual,plain(r.call('main',[xs])));
      let a=1,n=0,totalB=0,totalC=0,positive=false;const trace=[];
      for(const x of xs){a=a*0.5+x;n++;totalB+=a;const mean=totalB/n;totalC+=mean;positive=mean>0;trace.push(totalC);}
      assert.deepEqual(actual,{trace,state:{a,b:{n,total:totalB},c:{total:totalC,positive}}});cases++;
    }
  }
  t.diagnostic(JSON.stringify({associativityCases:cases}));
});

test('block-local composition resets the whole cascade and retains certified input alignment',async()=>{
  const source=await load('block_cascade');
  const aligned=`export fn main = (xs:[Num]) -> do {
    let m=machine_then (sum_reducer ()) (sum_reducer ());
    let ys=xs |> chunks 3 |> map (b -> scan_with b m) |> flatten;
    zip xs ys (x -> y -> y-x)
  };`;
  for(const mode of modes){
    const r=await runtime(source,{...mode,maxLoopIterations:7});
    assert.deepEqual([...r.call('block_cascade',[[1,2,3,4,5,6,7],3],{outputBytes:56})],[1,4,10,4,13,28,7]);
    const cpl=compileSources(files(aligned),mode);assert.equal(cpl.stats.functions[0].runtimeZipChecks,0);
    assert.deepEqual([...(await createRuntime(cpl)).call('main',[[1,2,3,4,5,6,7]])],[0,2,7,0,8,22,0]);
    assert.throws(()=>r.call('block_cascade',[[1],0]),WebAssembly.RuntimeError);
    assert.deepEqual([...r.call('block_cascade',[[],3],{outputBytes:0})],[]);
  }
});

test('all nested block cascades agree with an independent loop without prefix reassociation',async t=>{
  const source=await load('block_cascade');let seed=162,cases=0;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(const mode of modes){const r=await runtime(source,mode);
    for(let i=0;i<50;i++){
      const xs=Array.from({length:rand()%40},()=>rand()%9-4),width=rand()%9+1,expected=[];
      for(let start=0;start<xs.length;start+=width){let a=0,b=0;for(const x of xs.slice(start,start+width)){a+=x;b+=a;expected.push(b);}}
      assert.deepEqual([...r.call('block_cascade',[xs,width])],expected);cases++;
    }
  }t.diagnostic(JSON.stringify({blockCascades:cases}));
});

test('typed checkpoint witness is erased, yet rejects mismatched declared initial state',()=>{
  const source='export fn main = (xs:[Num]) -> machine_states_from xs {initial:require false 0,step:s -> x -> s+x} 5;';
  const explicit='export fn main = (xs:[Num]) -> scan xs 5 (s -> x -> s+x);';
  for(const mode of modes)assert.deepEqual(compileSources(files(source),mode).bytes,compileSources(files(explicit),mode).bytes);
  failure(source.replace('require false 0','true'),'E_TYPE');
});

test('empty and disabled event clocks distinguish lazy seeds from held updates',async()=>{
  const bad=`{initial:require false 0,step:s -> x -> s+x,finish:s -> s}`;
  const empty=`export fn main = (xs:[Num]) -> scan_with xs (${bad} |> reducer_filter (x -> false));`;
  const observed=`export fn main = (xs:[Num]) -> count (machine_states xs (${bad} |> reducer_filter (x -> false)));`;
  for(const source of [empty,observed]){
    const r=await runtime(source);
    assert.deepEqual(plain(r.call('main',[[]])),source===empty?[]:0);
    assert.throws(()=>r.call('main',[[1]]),WebAssembly.RuntimeError);
  }
  const filtered=await runtime(`export fn main = (xs:[Num]) -> scan_with (filter xs (x -> false)) ${bad};`);
  assert.deepEqual([...filtered.call('main',[[1]])],[]);
  const final=await runtime(`export fn main = (xs:[Num]) -> do {let m=${bad};fold (machine_states xs m) m.initial (s -> x -> x)};`);
  assert.throws(()=>final.call('main',[[]]),WebAssembly.RuntimeError);
});

test('a held lane does not evaluate disabled input projections, but next state remains strict',async()=>{
  const source=`export fn main = (xs:[Num]) -> scan_with xs (
    sum_reducer () |> reducer_map_input (x -> require false x) |> reducer_filter (x -> false));`;
  assert.deepEqual([...(await runtime(source)).call('main',[[1,2]])],[0,0]);
  const strict=`export fn main = (xs:[Num]) -> count (machine_states xs
    {initial:{a:0,b:0},step:s -> x -> {a:s.a+x,b:require false x},finish:s -> s.a});`;
  const r=await runtime(strict);assert.throws(()=>r.call('main',[[1]]),WebAssembly.RuntimeError);
  assert.equal(r.call('main',[[]]),0);
});

test('observations stay demand-directed, including after serial composition',async()=>{
  const m='{initial:0,step:s -> x -> s+x,finish:s -> require false s}';
  const unused=await runtime(`export fn main = (xs:[Num]) -> count (machine_states xs ${m});`);
  assert.equal(unused.call('main',[[1,2]]),2);
  const used=await runtime(`export fn main = (xs:[Num]) -> scan_with xs ${m};`);
  assert.throws(()=>used.call('main',[[1]]),WebAssembly.RuntimeError);
  const ignored=await runtime(`export fn main = (xs:[Num]) -> scan_with xs
    (machine_then ${m} {initial:0,step:s -> ignored -> s+1,finish:s -> s});`);
  assert.deepEqual([...ignored.call('main',[[1,2]])],[1,2]);
});

test('early stopping avoids invalid later transitions and resets without pre-reading a suffix',async()=>{
  const source=`export fn main = (xs:[Num]) -> do {
    let m={initial:0,step:s -> x -> require (x>=0) (s+x),finish:s -> s}
      |> machine_then (sum_reducer ()) |> machine_reset_when (x -> require (x>=0) false);
    machine_states xs m |> fold_until 0 (s -> next -> {state:next.right,done:next.right>=5})
  };`;
  for(const mode of modes){const r=await runtime(source,{...mode,maxLoopIterations:2});
    assert.deepEqual(r.call('main',[[2,1,-99]]),{state:5,steps:2,done:true});
    assert.throws(()=>r.call('main',[[1,-99]]),WebAssembly.RuntimeError);
    assert.deepEqual(r.call('main',[[]]),{state:0,steps:0,done:false});
    assert.deepEqual(r.call('main',[[5]]),{state:5,steps:1,done:true});
  }
});

test('held traces retain source identity while filters, seeks and foreign zips do not gain evidence',async()=>{
  const valid=`export fn main = (xs:[Num]) -> do {
    let m=sum_reducer () |> reducer_filter (x -> x>0);
    let h=machine_states xs m;zip xs h (x -> s -> x+s)
  };`;
  const cpl=compileSources(files(valid));assert.equal(cpl.stats.functions[0].runtimeZipChecks,0);
  assert.deepEqual([...(await createRuntime(cpl)).call('main',[[2,-1,3]])],[4,1,8]);
  failure(valid.replace('machine_states xs m','machine_states (filter xs (x -> x>0)) m'),'E_DOMAIN');
  failure('export fn main = (xs:[Num]) -> at (machine_states xs (sum_reducer ())) 0;','E_CAUSAL_ACCESS');
  failure('export fn main = (xs:[Num]) -> machine_states xs (sum_reducer ()) |> chunks 3 |> map count;','E_CHUNK_ACCESS');
  failure('export fn main = (xs:[Num]) -> (ys:[Num]) -> zip (machine_states xs (sum_reducer ())) ys (x -> y -> x+y);','E_DOMAIN');
});

test('scope, invalid protocols, bounds and source-local diagnostics retain ordinary errors',()=>{
  for(const source of [
    'export fn main = (xs:[Num]) -> machine_states xs {initial:0,step:s -> x -> true};',
    'export fn main = (xs:[Num]) -> scan_with xs {initial:0,step:s -> x -> s+x};',
    'export fn main = (xs:[Num]) -> machine_states_from xs (sum_reducer ()) true;',
    'export fn main = (xs:[Num]) -> scan_with xs (sum_reducer () |> machine_reset_when (x -> x));',
    'export fn main = (xs:[Num]) -> scan_with xs (machine_then (sum_reducer ()) {initial:false,step:s -> x -> s && x,finish:s -> s});',
  ])failure(source,'E_TYPE');
  failure('export fn main = () -> machine_then (sum_reducer ()) (sum_reducer ());','E_ABI');
  failure('export fn main = (xs:[Num]) -> machine_states xs {initial:range 1,step:s -> x -> s};','E_ABI');
  const bad='export fn main = (xs:[Num]) -> machine_states xs {initial:0,step:s -> x -> missing x};';
  const d=checkSources(files(bad)).diagnostics[0];assert.equal(d.code,'E_NAME');assert.equal(d.sourceName,'client.ass');assert.equal(d.range.start.offset,bad.indexOf('missing'));
  assert.throws(()=>compileSources(files(clockedMachineCases[0].source),{maxExpansion:1}),e=>e.code==='E_LIMIT');
});

test('captured performed results remain atomic when initial state is reused for reset',async()=>{
  const source=`host fn seed:Num -> Num; export fn main = (xs:[Num]) -> effect {
    let initial=perform seed 10;
    let m={initial,step:s -> x -> s+x,finish:s -> s} |> machine_reset_when (x -> x<0);
    scan_with xs m
  };`;
  for(const mode of modes){const r=await runtime(source,mode),seen=[];
    assert.throws(()=>r.call('main',[[1,-1,2]]),e=>e.code==='E_CAPABILITY');
    const capability=createCapability({seed:{parameters:['Num'],result:'Num',call:x=>(seen.push(x),x)}},{maxCalls:1});
    assert.deepEqual([...r.call('main',[[1,-1,2]],{capability})],[11,9,11]);
    assert.deepEqual(seen,[10]);assert.equal(capability.remaining,0);
  }
  failure('host fn step:Num -> Num;export fn main = (xs:[Num]) -> scan_with xs {initial:0,step:s -> x -> step x,finish:s -> s};','E_EFFECT');
});

test('ordered floating-point state and signed zeros survive checkpoints without reassociation',async()=>{
  const source='export fn main = (xs:[Num]) -> (saved:Num) -> machine_states_from xs (sum_reducer ()) saved;';
  for(const mode of modes){const r=await runtime(source,mode),xs=[1e16,1,-1e16,1];
    assert.deepEqual([...r.call('main',[xs,0])],[1e16,1e16,0,1]);
    for(let i=0;i<=xs.length;i++){
      const a=r.call('main',[xs.slice(0,i),0]),state=a.length?a.at(-1):0;
      const b=r.call('main',[xs.slice(i),state]);assert.deepEqual([...a,...b],[1e16,1e16,0,1]);
    }
    const held=await runtime('export fn main = (xs:[Num]) -> (saved:Num) -> machine_states_from xs (sum_reducer () |> reducer_filter (x -> false)) saved;',mode);
    assert(Object.is(held.call('main',[[1,2],-0])[0],-0));
  }
});

test('raw output separation, prepared snapshots and post-trap state are preserved',async()=>{
  const source=await load('resumable_pipeline'),cpl=compileSources(files(source),{maxLoopIterations:6});
  const config={alpha:0.5,low:3,high:6},saved={left:0,right:false},xs=[0,8,8,0,8,0],resets=[false,false,false,false,true,false];
  const args=[xs,resets,config,saved];
  const memory=new WebAssembly.Memory({initial:1,maximum:1});new Uint8Array(memory.buffer).fill(0xa5);
  const arena=new Arena(memory),frame=prepareCall(arena,cpl.abi.exports[0],args,{outputBytes:72});
  const instance=await instantiate(cpl,{memory});const end=instance.exports.monitor_chunk(...frame.slots);
  assert.deepEqual(plain(frame.lift(end)),monitorOracle(...args));
  assert(new Uint8Array(memory.buffer,end,16).every(b=>b===0xa5));
  const manager=await createRuntime(cpl),lease=manager.prepare('monitor_chunk',args,{outputBytes:72});
  try{
    const a=lease.run();xs[0]=99;resets[0]=true;config.alpha=1;saved.left=99;
    assert.deepEqual(plain(lease.run()),plain(a));a.means[0]=999;assert.equal(lease.run().means[0],0);
  }finally{lease.dispose();}
  assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
  assert.throws(()=>manager.call('monitor_chunk',[[NaN],[false],{alpha:0.5,low:3,high:6},{left:0,right:false}]),WebAssembly.RuntimeError);
  assert.deepEqual(plain(manager.call('monitor_chunk',[[8],[false],{alpha:0.5,low:3,high:6},{left:0,right:false}])),{means:[4],alarms:[false],state:{left:4,right:false}});
});

test('monitor validates configuration, checkpoint scalars and alignment even for empty input',async()=>{
  const r=await runtime(await load('resumable_pipeline'));
  for(const config of [{alpha:0,low:3,high:6},{alpha:NaN,low:3,high:6},{alpha:1,low:3,high:3},{alpha:0.5,low:Infinity,high:Infinity}])
    assert.throws(()=>r.call('monitor_chunk',[[],[],config,{left:0,right:false}]),WebAssembly.RuntimeError);
  assert.throws(()=>r.call('monitor_chunk',[[],[],{alpha:0.5,low:3,high:6},{left:Infinity,right:false}]),WebAssembly.RuntimeError);
  assert.throws(()=>r.call('monitor_chunk',[[1],[],{alpha:0.5,low:3,high:6},{left:0,right:false}]),WebAssembly.RuntimeError);
});

test('public examples, compact layout, docs snippets and the comparison driver execute',async()=>{
  const doc=await readFile(new URL('../docs/CLOCKED-MACHINES.md',import.meta.url),'utf8');
  const blocks=[...doc.matchAll(/<!-- clocked-example: (\w+) -->\n```ass\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length,3);
  for(const [,name,source] of blocks){
    assert.equal(source+'\n',await load(name));
    assert.deepEqual(compileSources(files(source)).bytes,compileSources(files(source.replace(/\/\/[^\n]*/g,'').replace(/\s+/g,' '))).bytes);
  }
  const run=spawnSync(process.execPath,['examples/interop/clocked-machines.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr);const report=JSON.parse(run.stdout);
  assert.equal(report.factoring.shared.stateSlots,3);assert.equal(report.factoring.duplicated.stateSlots,4);
  assert.equal(report.resume.saved.state.left,3);assert.deepEqual(report.resume.after.means,[4,2]);
  for(const [id,args] of [['clocked-channels',[[1,99,3,99],[true,false,true,false],[99,20,99,40],[false,true,false,true]]],['clocked-block-cascade',[[1,2,3,4,5,6,7],3]]]){
    const r=spawnSync(process.execPath,['examples/case-studies/app.mjs',id],{cwd:new URL('../',import.meta.url),input:JSON.stringify(args),encoding:'utf8',timeout:15000});
    assert.equal(r.status,0,r.stderr);assert.doesNotThrow(()=>JSON.parse(r.stdout));
  }
});

test('the real-browser source checks are also executable in Node',async()=>{
  const report={checks:0,cases:[]};await runClockedMachineBrowserChecks({compileSources,checkSources},createRuntime,report,libraries);
  assert.equal(report.checks,68);assert.equal(report.cases.length,1);
});


test('nested work is accounted for when the existing multi-output cohort is ineligible',async()=>{
  const original=await load('shared_prefix');
  const source=original.replace('mean+alpha*(value-mean)','mean+fold (range value) 0 (s -> x -> s+x)');
  const duplicate=source.replace('smooth_signal alpha |> machine_then observers',
    'reducer_product (smooth_signal alpha |> machine_then (sum_reducer ())) (smooth_signal alpha |> machine_then (peak_signal ()))');
  for(const mode of modes)for(const [program,units,loops,slots] of [[source,27,6,9],[duplicate,45,9,12]]){
    const cpl=compileSources(files(program),{...mode,maxLoopIterations:units});
    assert.equal(cpl.stats.functions[0].loops,loops);assert.equal(cpl.stats.functions[0].stateSlots,slots);
    assert.equal(cpl.stats.functions[0].outputFusion.groups.length,0);
    const r=await createRuntime(cpl);
    assert.deepEqual(plain(r.call('shared_prefix',[[2,3,1],0.5],{outputBytes:48})),
      {totals:[1,5,9],peaks:[1,4,4],summary:{left:9,right:4}});
    const small=await runtime(program,{...mode,maxLoopIterations:units-1});
    assert.throws(()=>small.call('shared_prefix',[[2,3,1],0.5]),WebAssembly.RuntimeError);
  }
});

test('the same source machine can step checkpoints with zero loops or scan a whole batch',async()=>{
  const source=`fn stages = () -> machine_then (sum_reducer ()) (mean_reducer ());
    export fn advance = (saved:{left:Num,right:{n:Num,total:Num}}) -> (x:Num) -> do {
      let m=stages ();let state=m.step saved x;{state,value:m.finish state}
    };
    export fn batch = (xs:[Num]) -> (saved:{left:Num,right:{n:Num,total:Num}}) -> do {
      let m=stages ();machine_states_from xs m saved |> map m.finish
    };`;
  for(const mode of modes){
    const cpl=compileSources(files(source),{...mode,maxLoopIterations:0});
    assert.equal(cpl.stats.functions.find(f=>f.name==='advance').loops,0);
    const scalar=await createRuntime(cpl),batch=await runtime(source,mode);
    const initial={left:0,right:{n:0,total:0}},xs=[1,2,3,4],trace=[];let state=initial;
    for(const x of xs){const result=scalar.call('advance',[state,x]);state=result.state;trace.push(result.value);}
    assert.deepEqual([...batch.call('batch',[xs,initial])],trace);
    assert.deepEqual(state,{left:10,right:{n:4,total:20}});
  }
});

test('compiler sessions snapshot source libraries and pure reset predicates are not assertions',async()=>{
  const source=clockedMachineCases[0].source,compiler=createCompiler();
  const first=compiler.compileSources(files(source));first.bytes.fill(0);
  const cached=compiler.compileSources(files(source));assert(cached.cache.hit);
  assert.deepEqual([...(await createRuntime(cached)).call('main',[[1,2,3]])],[1,4,10]);
  const independent=compiler.compileSources(files(source),{prelude:false});assert(!independent.cache.hit);
  const unused=await runtime(`export fn main = (xs:[Num]) -> scan_with xs (
    {initial:0,step:ignored -> x -> x,finish:s -> s} |> machine_reset_when (x -> require false true));`);
  // A transition that ignores its previous state need not demand its reset.
  assert.deepEqual([...unused.call('main',[[1,2]])],[1,2]);
});
