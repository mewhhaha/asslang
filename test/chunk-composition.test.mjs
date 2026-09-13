import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compile,check,checkSources,compileSources,createCompiler,instantiate,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime,createCapability,Arena,prepareCall} from '../src/abi.mjs';
import {parse,infer} from '../src/frontend.mjs';
import {stage} from '../src/jte.mjs';
import {reference} from './reference.mjs';
import {runChunkCompositionBrowserChecks} from './chunk-composition-browser.mjs';
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const plain=v=>ArrayBuffer.isView(v)||Array.isArray(v)?Array.from(v,plain):v&&typeof v==='object'
  ?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
const sources=Object.fromEntries(await Promise.all(['block_report','block_energy','block_center'].map(async name=>
  [name,await readFile(new URL(`../examples/case-studies/chunk-scans/${name}.ass`,import.meta.url),'utf8')])));
const prefix='export fn main = (xs:[Num]) -> (w:Num) -> xs |> chunks w |> map (block -> scan block 0 (s -> x -> s+x)) |> flatten;';
const program=body=>`export fn main = (xs:[Num]) -> (w:Num) -> ${body};`;
const rejects=(s,code)=>assert.throws(()=>compile(s),e=>e.code===code);
function localScan(xs,w,seed=0,step=(s,x)=>s+x) {
  const out=[];
  for(let b=0;b<xs.length;b+=w) {
    let state=typeof seed==='function'?seed(xs.slice(b,b+w)):seed;
    for(let j=b;j<Math.min(b+w,xs.length);j++){state=step(state,xs[j]);out.push(state);}
  }
  return out;
}
function expectedReport(xs,w) {
  const local=localScan(xs,w);let total=0;
  const totals=xs.map(x=>total+=x);
  return {local,totals,state:{local:local.at(-1)??0,total}};
}

for(const mode of modes)test(`symbolic block tasks and exact costs ${JSON.stringify(mode)}`,async()=>{
  const artifacts=Object.fromEntries(Object.entries(sources).map(([name,s])=>[name,compile(s,mode)]));
  for(const c of Object.values(artifacts)) {
    assert.equal(c.abi.version,1);assert.equal(c.stats.intermediateBufferBytes,0);
    assert.equal(c.stats.kernelHeapAllocationSites,0);assert(!c.stats.scratchReservationSites);
    assert.equal(c.certificate.version,'jte-4-chunks');assert(verifyCertificate(c.certificate.steps));
  }
  const report=artifacts.block_report.stats.functions[0];
  assert.equal(report.loops,mode.reductionFusion?1:3);assert.equal(report.stateMachines,mode.reductionFusion?2:6);
  assert.equal(report.runtimeZipChecks,0);
  for(const xs of [[],[1],[1,2,3,4,5,6,7],[-1,3,0,-2]])for(const w of [1,2,3,8]) {
    const rt=await createRuntime(artifacts.block_report);
    assert.deepEqual(plain(rt.call('block_report',[xs,w])),expectedReport(xs,w));
    assert.deepEqual(plain(reference(sources.block_report,'block_report',[xs,w])),expectedReport(xs,w));
    const expectedEnergy=[];const centered=[];
    for(let i=0;i<xs.length;i+=w){const b=xs.slice(i,i+w);expectedEnergy.push(b.reduce((s,x)=>s+x*x,0));
      const mean=b.reduce((s,x)=>s+x,0)/b.length;centered.push(...b.map(x=>x-mean));}
    for(const [name,expected,units] of [
      ['block_report',expectedReport(xs,w),xs.length*(mode.reductionFusion?1:3)],
      ['block_energy',expectedEnergy,xs.length+Math.ceil(xs.length/w)],
      ['block_center',centered,2*xs.length],
    ]) {
      const r=await createRuntime(compile(sources[name],{...mode,maxLoopIterations:units}));
      assert.deepEqual(plain(r.call(name,[xs,w])),expected);
      if(units) {const small=await createRuntime(compile(sources[name],{...mode,maxLoopIterations:units-1}));
        assert.throws(()=>small.call(name,[xs,w]),WebAssembly.RuntimeError);}
    }
  }
});

test('exhaust ternary inputs and every small legal width against independent block scans',async t=>{
  const r=await createRuntime(compile(prefix));let words=0,cases=0;
  for(let n=0;n<=5;n++)for(let word=0;word<3**n;word++) {
    let code=word;const xs=Array.from({length:n},()=>{const v=code%3-1;code=Math.floor(code/3);return v;});
    for(let w=1;w<=n+2;w++){assert.deepEqual([...r.call('main',[xs,w])],localScan(xs,w));cases++;}
    words++;
  }
  t.diagnostic(JSON.stringify({words,cases}));
});

test('nested families and chained machines reset at the correct local boundaries',async()=>{
  const nested=program('xs |> chunks w |> map (block -> block |> chunks 2 |> map (part -> scan part 0 (s -> x -> s+x)) |> flatten) |> flatten');
  const chained=program('xs |> chunks w |> map (block -> block |> scan 0 (s -> x -> s+x) |> scan 1 (s -> x -> s*x)) |> flatten');
  const xs=[1,2,3,4,5,6,7,8,9,10,11];
  for(const mode of modes) {
    // Nested widths retain main's one structural preflight step per outer block.
    const r=await createRuntime(compile(nested,mode));
    for(const w of [1,3,5,20]) {
      const expected=[];for(let i=0;i<xs.length;i+=w)expected.push(...localScan(xs.slice(i,i+w),2));
      assert.deepEqual([...r.call('main',[xs,w])],expected);
    }
    const c=compile(chained,mode);assert.equal(c.stats.functions[0].stateMachines,2);
    const expected=[];for(let i=0;i<xs.length;i+=3){let product=1;expected.push(...localScan(xs.slice(i,i+3),3).map(x=>product*=x));}
    assert.deepEqual([...(await createRuntime(c)).call('main',[xs,3])],expected);
  }
});

test('record transitions, seeds and f64 order match independently reset recurrences',async()=>{
  const s=program(`xs |> chunks w |> map (b -> scan b {a:0,b:1} (s -> x -> {a:s.b+x,b:s.a-x})) |> flatten |> map (s -> s.a)`);
  const numeric=[[],[-0],[1e16,1,-1e16,1,2], [Infinity,-Infinity,NaN,0]];
  for(const mode of modes) {
    const r=await createRuntime(compile(s,mode)),q=await createRuntime(compile(prefix,mode));
    for(const xs of numeric)for(const w of [1,2,4]) {
      assert.deepEqual([...q.call('main',[xs,w])],localScan(xs,w));
      const expected=localScan(xs,w,()=>({a:0,b:1}),(s,x)=>({a:s.b+x,b:s.a-x})).map(s=>s.a);
      assert.deepEqual([...r.call('main',[xs,w])],expected);
    }
  }
});

test('flatten substitution protects nested reduction and iteration binders in block seeds',async()=>{
  const bodies=[
    ['sum b', b=>b.reduce((s,x)=>s+x,0)],
    ['fold b 0 (s -> x -> s+x)', b=>b.reduce((s,x)=>s+x,0)],
    ['(fold b {total:0} (s -> x -> {total:s.total+x})).total', b=>b.reduce((s,x)=>s+x,0)],
    ['(fold_until b 0 (s -> x -> {state:s+x,done:s+x>=5})).state',b=>{let n=0;for(const x of b){n+=x;if(n>=5)break;}return n;}],
    ['sum (map b (x -> sum (range x)))',b=>b.reduce((s,x)=>s+x*(x-1)/2,0)],
    ['(iterate (sum b) 2 (s -> {state:s+1,done:false})).state',b=>b.reduce((s,x)=>s+x,0)+2],
  ];
  for(const mode of modes)for(const [seed,oracle] of bodies) {
    const s=program(`xs |> chunks w |> map (b -> scan b (${seed}) (s -> x -> s)) |> flatten`);
    const r=await createRuntime(compile(s,mode));
    const xs=[1,2,3,4,5,6,7];
    assert.deepEqual([...r.call('main',[xs,3])],localScan(xs,3,oracle,s=>s));
  }
});

test('block scalar summaries, local arrays and nested captures compose under outer loops',async()=>{
  const s=`export fn main = (xs:[Num]) -> sum (map (range 3) (outer -> do {
    let groups=xs |> chunks (outer+1);
    sum (map (range 2) (inner -> sum (map groups (b -> sum b + outer + inner))))
  }));`;
  const values=[1,2,3,4,5];let expected=0;
  for(let o=0;o<3;o++)for(let i=0;i<2;i++)for(let b=0;b<values.length;b+=o+1)
    expected+=values.slice(b,b+o+1).reduce((s,x)=>s+x,0)+o+i;
  const captured=`export fn main = (xs:[Num]) -> sum (map (range 3) (outer ->
    sum (xs |> chunks (outer+1) |> map (b -> map b (x -> x+outer)) |> flatten)));`;
  for(const mode of modes) {
    assert.equal((await createRuntime(compile(s,mode))).call('main',[values]),expected);
    assert.equal((await createRuntime(compile(captured,mode))).call('main',[values]),60);
  }
});

test('array-valued maps can be chained or reduced without flattening their intermediate arrays',async()=>{
  const s=program('xs |> chunks w |> map (b -> scan b 0 (s -> x -> s+x)) |> map (b -> sum b)');
  const family=program('do {let stored={blocks:chunks xs w};let {blocks}=stored;blocks |> map (b -> map b (x -> x*2)) |> map (b -> map b (x -> x+1)) |> flatten}');
  for(const mode of modes) {
    assert.deepEqual([...(await createRuntime(compile(s,mode))).call('main',[[1,2,3,4,5],2])],[4,10,5]);
    assert.deepEqual([...(await createRuntime(compile(family,mode))).call('main',[[1,2,3],2])],[3,5,7]);
  }
  const generic=`fn transform = f -> xs -> xs |> chunks 2 |> map (b -> map b f) |> flatten;
    export fn main = () -> {numbers:transform (x -> x+1) (range 3),flags:transform (x -> x>0) (range 3)};`;
  assert.deepEqual(plain((await createRuntime(compile(generic))).call('main',[{}])),{numbers:[1,2,3],flags:[false,true,true]});
});

test('invalid widths remain checked for empty inputs and counts, but unused families stay lazy',async()=>{
  const demand=[program('xs |> chunks w |> count'),program('xs |> chunks w |> flatten |> count'),
    program('xs |> chunks w |> map (b -> sum b) |> count')];
  for(const s of demand) {const r=await createRuntime(compile(s));
    for(const w of [0,-0,-1,0.5,NaN,Infinity,-Infinity,2147483648])for(const xs of [[],[1,2]])
      assert.throws(()=>r.call('main',[xs,w]),WebAssembly.RuntimeError);
    assert.equal(r.call('main',[[],1]),0);
  }
  const lazy=await createRuntime(compile(program('do {let ignored=chunks xs w;7}')));
  assert.equal(lazy.call('main',[[1,2],0]),7);
  const counted=await createRuntime(compile(program('xs |> chunks w |> map (b -> scan b (require false 0) (s -> x -> s+x)) |> count')));
  assert.equal(counted.call('main',[[1,2,3],2]),2);
});

test('original alignment, local split/rejoin and inherited cut covers remain checked',async()=>{
  const s=program(`do {
    let local=xs |> chunks w |> map (b -> do {let {left,right}=split_at b (floor (count b/2));concat (map left (x -> x*2)) (map right (x -> x*3))}) |> flatten;
    zip xs local (original -> adjusted -> adjusted-original)
  }`);
  assert.deepEqual([...(await createRuntime(compile(s))).call('main',[[1,2,3,4,5],3])],[1,4,6,4,10]);
  const restored=program(`do {let {left,right}=split_at xs (min w (count xs));
    let l=left |> chunks w |> map (b -> map b (x -> x+1)) |> flatten;
    let joined=concat l right;zip xs joined (a -> b -> b-a)}`);
  const c=compile(restored);assert.equal(c.stats.functions[0].runtimeZipChecks,0);
  assert.deepEqual([...(await createRuntime(c)).call('main',[[1,2,3,4],2])],[1,1,0,0]);
  const independent=program('zip (xs |> chunks w |> flatten) (range (count xs)) (a -> b -> a+b)');
  rejects(independent,'E_DOMAIN');
});

test('ordering dependencies inside per-block checkpoints retain scratch and complete demand',async()=>{
  const s=program(`do {let ordered=sort_by xs (x -> x);
    xs |> chunks w |> map (b -> require (count ordered == count xs) b) |> flatten}`);
  const c=compile(s);assert.equal(c.stats.scratchReservationSites,1);assert.equal(c.abi.version,2);
  const r=await createRuntime(c);assert.deepEqual([...r.call('main',[[3,1,2],2],{scratchBytes:96})],[3,1,2]);
  assert.throws(()=>r.call('main',[[3,1,2],2],{scratchBytes:95}),WebAssembly.RuntimeError);
  assert.deepEqual([...r.call('main',[[],2],{scratchBytes:0,outputBytes:0})],[]);
});

test('raw output bytes, canaries, duplicate arrays and prepared widths have ordinary ownership',async()=>{
  const c=compile(program('xs |> chunks w |> map (b -> map b (x -> x)) |> flatten'));
  const memory=new WebAssembly.Memory({initial:1,maximum:1});new Uint8Array(memory.buffer).fill(0xa5);
  const arena=new Arena(memory),frame=prepareCall(arena,c.abi.exports[0],[[1,2,3],2],{outputBytes:24});
  const raw=await instantiate(c,{memory}),end=raw.exports.main(...frame.slots);
  assert.deepEqual([...frame.lift(end)],[1,2,3]);assert(new Uint8Array(memory.buffer,end,16).every(x=>x===0xa5));
  const bad=[...frame.slots];bad[c.abi.exports[0].result.slots[1]]=bad[0];
  const snapshot=new Uint8Array(memory.buffer).slice();assert.throws(()=>raw.exports.main(...bad),WebAssembly.RuntimeError);
  assert.deepEqual(new Uint8Array(memory.buffer),snapshot);
  const compiler=createCompiler();compiler.compile(prefix).bytes.fill(0);const cached=compiler.compile(prefix);assert(cached.cache.hit);
  const r=await createRuntime(cached),input=[1,2,3],lease=r.prepare('main',[input,2],{outputBytes:24});
  try {
    input[0]=99;const a=lease.run();assert.deepEqual([...a],[1,3,3]);
    assert.deepEqual([...lease.run({w:1})],[1,2,3]);assert.throws(()=>lease.run({w:0}),WebAssembly.RuntimeError);
    assert.deepEqual([...lease.run()],[1,3,3]);a[0]=100;assert.equal(lease.run()[0],1);
  } finally {lease.dispose();}
  assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
});

test('Bool and symbolic record payloads remain static, while raw invalid Bool values still trap',async()=>{
  const s='export fn main = (xs:[Bool]) -> xs |> chunks 2 |> map (b -> scan b false (s -> x -> if s then !x else x)) |> flatten;';
  assert.deepEqual((await createRuntime(compile(s))).call('main',[[true,false,true,true,false]]),[true,true,true,false,false]);
  const sym='symbol slot;export fn main = (xs:[Num]) -> xs |> map (x -> {[slot]:x}) |> chunks 2 |> map (b -> map b (r -> r[slot]+1)) |> flatten;';
  assert.deepEqual([...(await createRuntime(compile(sym))).call('main',[[1,2,3]])],[2,3,4]);
  const c=compile(s),memory=new WebAssembly.Memory({initial:1}),arena=new Arena(memory);
  const frame=prepareCall(arena,c.abi.exports[0],[[true]],{outputBytes:4});new DataView(memory.buffer).setUint32(frame.slots[0],2,true);
  const r=await instantiate(c,{memory});assert.throws(()=>r.exports.main(...frame.slots),WebAssembly.RuntimeError);
});

test('source-local diagnostics, explicit effects and legacy application remain intact',async()=>{
  const source=program('xs |> chunks w |> map (b -> map b (x -> missing)) |> flatten');
  const d=checkSources([{name:'client.ass',source}]).diagnostics[0];assert.equal(d.code,'E_NAME');assert.equal(d.sourceName,'client.ass');
  assert.equal(d.range.start.offset,source.indexOf('missing'));
  const shape=program('xs |> chunks w |> map (b -> filter b (x -> x>0)) |> flatten');
  const e=checkSources([{name:'chunks.ass',source:shape}]).diagnostics[0];assert.equal(e.code,'E_CHUNK_DENSE');assert.equal(e.sourceName,'chunks.ass');
  assert.equal(e.phase,'stage');assert(e.range.start.offset>0);
  const effect='host fn audit:Num -> Bool;export fn main = (xs:[Num]) -> effect {perform audit 1;xs |> chunks 2 |> map (b -> scan b 0 (s -> x -> s+x)) |> flatten};';
  const r=await createRuntime(compile(effect,{maxLoopIterations:0})),seen=[];
  assert.throws(()=>r.call('main',[[1]]),x=>x.code==='E_CAPABILITY');
  const cap=createCapability({audit:{parameters:['Num'],result:'Bool',call:x=>(seen.push(x),true)}},{maxCalls:1});
  assert.throws(()=>r.call('main',[[1]],{capability:cap}),WebAssembly.RuntimeError);assert.deepEqual(seen,[1]);
  rejects('host fn audit:Num -> Bool;'+program('xs |> chunks w |> map (b -> map b (x -> audit x)) |> flatten'),'E_EFFECT');
  const legacy='export fn main(xs:[Num])=flatten(map(chunks(xs,2),b=>scan(b,0,(s,x)=>s+x)));';
  assert.deepEqual([...(await createRuntime(compile(legacy))).call('main',[[1,2,3]])],[1,3,3]);
});

test('native shared browser assertions run in Node too',async()=>{
  const report={checks:0,cases:[]};await runChunkCompositionBrowserChecks({compile,check},createRuntime,report);
  assert.equal(report.checks,65);assert.equal(report.cases.length,1);
});

test('shared flattened streams fuse while separately flattened templates retain independent state',async()=>{
  const shared=program('do {let h=xs |> chunks w |> map (b -> scan b 0 (s -> x -> s+x)) |> flatten;{a:h,b:h}}');
  const separate=program('do {let blocks=xs |> chunks w |> map (b -> scan b 0 (s -> x -> s+x));{a:flatten blocks,b:flatten blocks}}');
  const c=compile(shared,{maxLoopIterations:5}),other=compile(separate);
  assert.equal(c.stats.functions[0].loops,1);assert.equal(c.stats.functions[0].stateMachines,1);
  assert.equal(other.stats.functions[0].loops,2);assert.equal(other.stats.functions[0].stateMachines,2);
  const r=await createRuntime(c),result=r.call('main',[[1,2,3,4,5],2],{outputBytes:80});
  assert.deepEqual(plain(result),{a:[1,3,3,7,5],b:[1,3,3,7,5]});
  result.a[0]=100;assert.equal(result.b[0],1);
  assert.deepEqual(plain((await createRuntime(other)).call('main',[[1,2,3,4,5],2])),{a:[1,3,3,7,5],b:[1,3,3,7,5]});
});

test('seeded tails, captures and nested widths agree with independent block loops',async t=>{
  let seed=671,count=0;const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const s=program('xs |> chunks w |> map (b -> b |> chunks (count b) |> map (part -> scan part (at part 0) (s -> x -> s+x)) |> flatten) |> flatten');
  for(const mode of modes) {
    const r=await createRuntime(compile(s,mode));
    for(let k=0;k<100;k++) {
      const xs=Array.from({length:random()%60},()=>random()%21-10),w=1+random()%16;
      assert.deepEqual([...r.call('main',[xs,w])],localScan(xs,w,b=>b[0]));count++;
    }
  }
  t.diagnostic(JSON.stringify({seededNestedCases:count}));
});

test('filtering inside block summaries is supported without claiming ragged array flattening',async()=>{
  const s=program('xs |> chunks w |> map (b -> b |> filter (x -> x>0) |> sum)');
  const r=await createRuntime(compile(s,{maxLoopIterations:9}));
  assert.deepEqual([...r.call('main',[[-1,2,-3,4,-5,6],2])],[2,4,6]);
});

test('flattened resetting machines compose with native ordering and repeated source traversal',async()=>{
  const s=program('xs |> chunks w |> map (b -> scan b 0 (s -> x -> s+x)) |> flatten |> sort_by (x -> x)');
  for(const mode of modes) {
    const c=compile(s,mode);assert.equal(c.abi.version,2);
    assert.deepEqual([...(await createRuntime(c)).call('main',[[3,2,1,4,-1],2])],[-1,1,3,5,5]);
  }
});

test('published source blocks, whitespace layouts, CLI and comparison execute as documented',async()=>{
  const doc=await readFile(new URL('../docs/CHUNK-COMPOSITION.md',import.meta.url),'utf8');
  const blocks=[...doc.matchAll(/<!-- chunk-example: (\w+) -->\n```ass\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length,3);
  for(const [,name,body] of blocks) {
    assert.equal(body+'\n',sources[name]);
    const compact=body.replace(/\/\/[^\n]*/g,'').replace(/\s+/g,' ');
    for(const mode of modes) {assert.deepEqual(compile(body,mode).bytes,compile(compact,mode).bytes);
      assert.deepEqual(compile(body,mode).bytes,compile(body.replaceAll('\n','\r\n'),mode).bytes);}
  }
  const run=spawnSync(process.execPath,['examples/interop/chunk-composition.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr);const report=JSON.parse(run.stdout);
  assert.deepEqual(report.reports.map(r=>r.loopUnits),[7,10,14]);
  assert(report.reports.every(r=>r.intermediateBufferBytes===0));
  const cli=spawnSync(process.execPath,['examples/case-studies/app.mjs','chunk-report'],{cwd:new URL('../',import.meta.url),input:'[[1,2,3,4,5,6,7],3]',encoding:'utf8',timeout:15000});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),expectedReport([1,2,3,4,5,6,7],3));
});

test('integration retains guard preflight and rejects repeated work but allows once-per-block seeds',async()=>{
  for(const mode of modes) {
    const guarded=program('xs |> chunks w |> map (b -> require (at b 0>=0) (scan b 0 (s -> x -> s+x))) |> flatten |> fold_until 0 (s -> x -> {state:x,done:x>=3})');
    const r=await createRuntime(compile(guarded,mode));
    // Main's all-block structural preflight is not changed to visited-only checks.
    assert.throws(()=>r.call('main',[[1,2,-99,4],2]),WebAssembly.RuntimeError);
    assert.equal(r.call('main',[[1,2,3,4],2]).state,3);
    const seeded=program('xs |> chunks w |> map (b -> scan b (require (at b 0>=0) 0) (s -> x -> s+x)) |> flatten |> fold_until 0 (s -> x -> {state:x,done:x>=3})');
    const q=await createRuntime(compile(seeded,{...mode,maxLoopIterations:2}));
    assert.equal(q.call('main',[[1,2,-99,4],2]).state,3);
    assert.equal(q.call('main',[[],2]).steps,0);
    const sums=await createRuntime(compile(program('xs |> chunks w |> map (b -> scan b (sum b) (s -> x -> s)) |> flatten'),{...mode,maxLoopIterations:10}));
    assert.deepEqual([...sums.call('main',[[1,2,3,4,5],2])],[3,3,7,7,5]);
  }
  for(const body of ['map b (x -> sum b)','scan b 0 (s -> x -> sum b)',
    'scan b 0 (s -> x -> (iterate x 2 (s -> {state:s+1,done:false})).state)',
    'require (sum b>0) (scan b 0 (s -> x -> s+x))'])
    rejects(program(`xs |> chunks w |> map (b -> ${body}) |> flatten`),'E_CHUNK_WORK');
});

test('selected block scans and outer-family zips survive the reconciliation',async()=>{
  const selected=program('at (xs |> chunks w |> map (b -> scan b 0 (s -> x -> s+x))) 1');
  const paired=program('do {let bs=chunks xs w;zip bs bs (a -> b -> sum (zip a b (x -> y -> x*y)))}');
  for(const mode of modes) {
    assert.deepEqual([...(await createRuntime(compile(selected,mode))).call('main',[[1,2,3,4,5],2])],[3,7]);
    assert.deepEqual([...(await createRuntime(compile(paired,mode))).call('main',[[1,2,3,4,5],2])],[5,25,25]);
  }
  rejects(program('at (xs |> chunks w |> map (b -> scan b 0 (s -> x -> s+x)) |> flatten) 0'),'E_CAUSAL_ACCESS');
});

test('flatten certificates recover alignment without forging random access',()=>{
  const steps=compile(prefix).certificate.steps;
  for(const edit of [s=>s.seekable=true,s=>s.domain=s.id,s=>s.obligation='equal-length',s=>s.parents.pop()]){
    const forged=structuredClone(steps);edit(forged.find(s=>s.rule==='flatten_chunks'));
    assert.throws(()=>verifyCertificate(forged),/JTE/);
  }
});

test('nested guard preflight has exact work and scan seeds retain private causal binders',async()=>{
  const nested=program('xs |> chunks w |> map (b -> b |> chunks 2 |> map (c -> scan c 0 (s -> x -> s+x)) |> flatten) |> flatten');
  for(const mode of modes)for(const w of [1,3,5,20]){
    const xs=[1,2,3,4,5,6,7], units=xs.length+Math.ceil(xs.length/w);
    const rt=await createRuntime(compile(nested,{...mode,maxLoopIterations:units}));
    const expected=[];for(let i=0;i<xs.length;i+=w)expected.push(...localScan(xs.slice(i,i+w),2));
    assert.deepEqual([...rt.call('main',[xs,w])],expected);
    const short=await createRuntime(compile(nested,{...mode,maxLoopIterations:units-1}));
    assert.throws(()=>short.call('main',[xs,w]),WebAssembly.RuntimeError);
  }
  const seed=program('xs |> chunks w |> map (b -> scan b (sum (scan b 0 (s -> x -> s+x))) (s -> x -> s)) |> flatten');
  assert.deepEqual([...(await createRuntime(compile(seed))).call('main',[[1,2,3,4,5],2])],[4,4,10,10,5]);
});
