import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compile,check,checkSources,compileSources,createCompiler,instantiate,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime,createCapability,Arena,prepareCall} from '../src/abi.mjs';
import {reference} from './reference.mjs';
import {runChunkViewBrowserChecks} from './chunk-views-browser.mjs';
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const wrap=body=>`export fn main = (xs:[Num]) -> (w:Num) -> ${body};`;
const reject=(s,code)=>assert.throws(()=>compile(s),e=>e.code===code);
const sumSource=wrap('xs |> chunks w |> map (block -> sum block)');
const flatSource=wrap('xs |> chunks w |> map (block -> map block (x -> x-at block 0)) |> flatten');
const reportSource=await readFile(new URL('../examples/case-studies/chunks/block_report.ass',import.meta.url),'utf8');
function blocks(xs,w) {const result=[];for(let i=0;i<xs.length;i+=w)result.push(xs.slice(i,i+w));return result;}
const sum=xs=>xs.reduce((a,b)=>a+b,0);
function report(xs,w) {let total=0,original=0;const relative=[],totals=[];
  for(let i=0;i<xs.length;i++){const value=xs[i]-xs[Math.floor(i/w)*w];total+=value;original+=xs[i];relative.push(value);totals.push(total);}
  return {relative,totals,state:{value:relative.at(-1)??0,total,original}};
}

for(const mode of modes)test(`block reductions and aligned report ${JSON.stringify(mode)}`,async()=>{
  const sums=await createRuntime(compile(sumSource,mode));
  const c=compile(reportSource,mode),r=await createRuntime(c);
  assert.equal(c.abi.version,1);assert.equal(c.stats.intermediateBufferBytes,0);assert(!c.stats.scratchReservationSites);
  assert.equal(c.stats.functions[0].loops,mode.reductionFusion?1:3);
  assert.equal(c.stats.functions[0].runtimeZipChecks,0);assert(verifyCertificate(c.certificate.steps));
  assert.equal(c.certificate.version,'jte-4-chunks');
  for(const xs of [[],[1],[10,13,20,18,30],[-2,1,3,-1,0,6]])for(const w of [1,2,3,7,2147483647]) {
    assert.deepEqual([...sums.call('main',[xs,w])],blocks(xs,w).map(sum));
    assert.deepEqual(plain(r.call('block_report',[xs,w])),report(xs,w));
    assert.deepEqual(plain(r.call('block_report',[xs,w])),reference(reportSource,'block_report',[xs,w]));
  }
  const units=mode.reductionFusion?5:15,args=[[10,13,20,18,30],2];
  const exact=await createRuntime(compile(reportSource,{...mode,maxLoopIterations:units}));
  assert.deepEqual(plain(exact.call('block_report',args,{outputBytes:80})),report(...args));
  const small=await createRuntime(compile(reportSource,{...mode,maxLoopIterations:units-1}));
  assert.throws(()=>small.call('block_report',args),WebAssembly.RuntimeError);
  assert.equal(small.call('block_report',[[1],1]).state.total,0);
});

test('all short ternary sequences and widths agree with independent block oracles',async t=>{
  const a=await createRuntime(compile(sumSource)),b=await createRuntime(compile(flatSource));let cases=0,words=0;
  for(let n=0;n<=6;n++)for(let word=0;word<3**n;word++) {
    let code=word;const xs=Array.from({length:n},()=>{const x=code%3-1;code=Math.floor(code/3);return x;});words++;
    for(let w=1;w<=n+2;w++) {
      assert.deepEqual([...a.call('main',[xs,w])],blocks(xs,w).map(sum));
      assert.deepEqual([...b.call('main',[xs,w])],blocks(xs,w).flatMap(b=>b.map(x=>x-b[0])));cases++;
    }
  }
  assert.equal(words,1093);t.diagnostic(JSON.stringify({words,widthCases:cases}));
});

test('seeded block reports across lowering modes preserve exact event order',async t=>{
  let seed=193, cases=0;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(const mode of modes) {const r=await createRuntime(compile(reportSource,mode));
    for(let n=0;n<50;n++){const xs=Array.from({length:rand()%50},()=>rand()%21-10),w=1+rand()%10;
      assert.deepEqual(plain(r.call('block_report',[xs,w])),report(xs,w));cases++;}
  }
  t.diagnostic(JSON.stringify({cases}));
});

test('positive width is structural, including count, empty source, selected block and untouched flatten',async()=>{
  for(const body of ['count (chunks xs w)','count (flatten (chunks xs w))','flatten (chunks xs w)',
    'at (chunks xs w) 0','xs |> chunks w |> map (b -> sum b)']) {
    const r=await createRuntime(compile(wrap(body)));
    for(const xs of [[],[1,2]])for(const width of [0,-0,-1,0.5,Infinity,NaN,2147483648])
      assert.throws(()=>r.call('main',[xs,width]),WebAssembly.RuntimeError);
  }
  const unused=await createRuntime(compile(wrap('do {let unused=chunks xs w;7}'),{maxLoopIterations:0}));
  assert.equal(unused.call('main',[[1],0]),7);
  const guarded=await createRuntime(compile(wrap('count (chunks (require false xs) w)')));
  assert.throws(()=>guarded.call('main',[[],1]),WebAssembly.RuntimeError);
});

test('billion-element and INT32_MAX virtual covers need no descriptors or memory',async()=>{
  const count=compile('export fn main = (n:Num) -> (w:Num) -> count (chunks (range n) w);',{maxLoopIterations:0});
  const tail=compile('export fn main = (n:Num) -> (w:Num) -> (k:Num) -> at (at (chunks (range n) w) k) 0;',{maxLoopIterations:0});
  for(const c of [count,tail]){assert(!c.stats.needsMemory);assert.equal(c.stats.functions[0].loops,0);assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)),[]);}
  const f=(await instantiate(count)).exports.main,g=(await instantiate(tail)).exports.main;
  for(const n of [0,1,1e9,2147483647])for(const w of [1,2,3,2147483646,2147483647]) {
    const c=n?Math.floor((n-1)/w)+1:0;assert.equal(f(n,w),c);
    if(c)assert.equal(g(n,w,c-1),(c-1)*w);
    assert.throws(()=>g(n,w,c),WebAssembly.RuntimeError);
  }
  assert.throws(()=>f(0,0),WebAssembly.RuntimeError);assert.throws(()=>g(5,2,1.5),WebAssembly.RuntimeError);
});

test('block-local scans reset and exact outer-plus-inner work is metered',async()=>{
  const s=await readFile(new URL('../examples/case-studies/chunks/block_exposure.ass',import.meta.url),'utf8');
  for(const mode of modes) {
    const r=await createRuntime(compile(s,{...mode,maxLoopIterations:8}));
    assert.deepEqual([...r.call('block_exposure',[[10,13,20,18,30],2],{outputBytes:24})],[33,58,30]);
    const small=await createRuntime(compile(s,{...mode,maxLoopIterations:7}));
    assert.throws(()=>small.call('block_exposure',[[10,13,20,18,30],2]),WebAssembly.RuntimeError);
    assert.deepEqual([...small.call('block_exposure',[[1,2],2])],[4]);
    const lazy=wrap('xs |> chunks w |> map (b -> scan b (require false 0) (s -> x -> s+x) |> sum)');
    const empty=await createRuntime(compile(lazy,mode));assert.deepEqual([...empty.call('main',[[],2])],[]);
    assert.throws(()=>empty.call('main',[[1],2]),WebAssembly.RuntimeError);
  }
});

test('stopping folds within blocks preserve unused suffix demand',async()=>{
  const s=wrap('xs |> chunks w |> map (b -> (fold_until (scan b 0 (s -> x -> require (x>=0) (s+x))) 0 (s -> x -> {state:x,done:x>=5})).state)');
  for(const mode of modes) {
    const r=await createRuntime(compile(s,{...mode,maxLoopIterations:6}));
    assert.deepEqual([...r.call('main',[[2,3,-99,5,-99,-99],3])],[5,5]);
    assert.throws(()=>r.call('main',[[2,-99,3],3]),WebAssembly.RuntimeError);
  }
});

test('same family flattens to the original domain; block selection creates a new one',async()=>{
  const aligned=wrap('do {let ys=xs |> chunks w |> map (b -> map b (x -> x*2)) |> flatten;zip xs ys (a -> b -> a+b)}');
  const r=await createRuntime(compile(aligned));assert.deepEqual([...r.call('main',[[1,2,3],2])],[3,6,9]);
  reject(wrap('do {let bs=chunks xs w;zip (at bs 0) (at bs 1) (a -> b -> a+b)}'),'E_DOMAIN');
  const selected=wrap('do {let b=at (chunks xs w) 1;zip b (map b (x -> x*2)) (a -> b -> a+b)}');
  assert.deepEqual([...(await createRuntime(compile(selected))).call('main',[[1,2,3,4],2])],[9,12]);
  // Different widths can each cover the same source, but their OUTER blocks differ.
  const refold=wrap('zip (flatten (chunks xs w)) (flatten (chunks xs 3)) (a -> b -> a+b)');
  assert.deepEqual([...(await createRuntime(compile(refold))).call('main',[[1,2,3,4],2])],[2,4,6,8]);
  reject(wrap('zip (chunks xs w) (chunks xs w) (a -> b -> sum a+sum b)'),'E_DOMAIN');
});

test('same-domain nested zips compose; independent blocks need checked pairing at both levels',async()=>{
  const s=wrap('do {let bs=chunks xs w;zip bs (map bs (b -> map b (x -> x*2))) (a -> b -> zip a b (x -> y -> x+y)) |> flatten}');
  const c=compile(s);assert.equal(c.stats.functions[0].runtimeZipChecks,0);
  assert.deepEqual([...(await createRuntime(c)).call('main',[[1,2,3,4,5],2])],[3,6,9,12,15]);
  const paired=await readFile(new URL('../examples/case-studies/chunks/paired_blocks.ass',import.meta.url),'utf8');
  const r=await createRuntime(compile(paired));
  assert.deepEqual([...r.call('paired_blocks',[[1,2,3],[4,5,6],2])],[14,18]);
  for(const [a,b] of [[[1,2,3],[1,2,3,4]],[[1,2,3],[1]],[[1],[]]])
    assert.throws(()=>r.call('paired_blocks',[a,b,2]),WebAssembly.RuntimeError);
});

test('nested traversals substitute block coordinates without capturing an outer block',async()=>{
  const s=wrap('do {let bs=chunks xs w;map bs (b -> sum (map bs (c -> sum c))+sum b)}');
  const select=wrap('at (map (chunks xs w) (b -> map b (x -> x-at b 0))) 1');
  const dynamic=wrap('xs |> map (n -> sum (map (chunks (range n) w) (b -> sum b)))');
  for(const mode of modes) {
    assert.deepEqual([...(await createRuntime(compile(s,mode))).call('main',[[1,3,10,14,20],2])],[52,72,68]);
    assert.deepEqual([...(await createRuntime(compile(select,mode))).call('main',[[1,3,10,14,20],2])],[0,4]);
    assert.deepEqual([...(await createRuntime(compile(dynamic,mode))).call('main',[[0,1,3,10],2])],[0,0,3,45]);
  }
});

test('structural preflight checks every block but never demands mapped item values',async()=>{
  const source=wrap('xs |> chunks w |> map (b -> require (at b 0>=0) (map b (x -> require false x))) |> flatten');
  const count=source.replace('xs |> chunks','count (xs |> chunks').replace('|> flatten;','|> flatten);');
  const c=compile(count,{maxLoopIterations:3}),r=await createRuntime(c);
  assert.equal(c.stats.chunkViews.structuralPasses,1);
  assert.equal(r.call('main',[[1,-3,2,-4,3],2]),5);
  assert.throws(()=>r.call('main',[[1,2,-1,4,3],2]),WebAssembly.RuntimeError);
  assert.equal(r.call('main',[[],2]),0);
  const at=wrap('at (xs |> chunks w |> map (b -> require (at b 0>=0) b) |> flatten) 0');
  const reader=await createRuntime(compile(at));
  assert.throws(()=>reader.call('main',[[1,2,-1,4],2]),WebAssembly.RuntimeError);
});

test('inner split/rejoin guards are preflighted once per block and can restore an outer cut',async()=>{
  const transform='map (b -> do {let {left,right}=split_at b (min 1 (count b));concat (map left (x -> -x)) right})';
  const s=wrap(`xs |> chunks w |> ${transform} |> flatten`);
  const c=compile(s,{maxLoopIterations:8}),r=await createRuntime(c);
  assert.equal(c.stats.chunkViews.structuralPasses,1);
  assert.deepEqual([...r.call('main',[[1,2,3,4,5],2])],[-1,2,-3,4,-5]);
  const bad=wrap('count (xs |> chunks w |> map (b -> do {let {left,right}=split_at b 2;concat left right}) |> flatten)');
  const invalid=await createRuntime(compile(bad));
  assert.throws(()=>invalid.call('main',[[1,2,3],2]),WebAssembly.RuntimeError);
  assert.equal(invalid.call('main',[[],2]),0);
  const outer=wrap('do {let {left,right}=split_at xs 2;let fixed=flatten (map (chunks left w) (b -> map b (x -> x*2)));zip xs (concat fixed right) (a -> b -> b-a)}');
  assert.deepEqual([...(await createRuntime(compile(outer))).call('main',[[1,2,3,4],1])],[1,2,0,0]);
});

test('partial applications, polymorphic helpers, Bool blocks and scalar-record rows remain staged',async()=>{
  const source='fn batch = xs -> w -> f -> map (chunks xs w) f;export fn main = () -> do {let {run}={run:batch};{numbers:run (range 5) 2 (b -> sum b),flags:run (map (range 5) (x -> x>1)) 2 (b -> count (filter b (x -> x)))}};';
  assert.deepEqual(plain((await createRuntime(compile(source))).call('main',[{}])),{numbers:[1,5,4],flags:[0,2,1]});
  const nested=wrap('map xs (x -> {value:x,ok:x>=0}) |> chunks w |> map (b -> map b (r -> r.ok)) |> flatten');
  assert.deepEqual((await createRuntime(compile(nested))).call('main',[[-1,2,0,-3,5],2]),[false,true,true,false,true]);
  const bool='export fn main = (xs:[Bool]) -> flatten (chunks xs 2);';
  assert.deepEqual((await createRuntime(compile(bool))).call('main',[[true,false,true]]),[true,false,true]);
});

test('unsupported covers, costly flattened items and ABI escapes fail explicitly',()=>{
  for(const body of ['flatten (filter (chunks xs w) (b -> count b>0))',
    'flatten (map (chunks xs w) (b -> range (count b)))',
    'flatten (map (chunks xs w) (b -> (split_at b 1).left))',
    'do {let bs=chunks xs w;flatten (map bs (b -> at bs 0))}',
    'do {let bs=chunks xs w;flatten (zip_checked bs bs (a -> b -> a))}']) {
    assert.throws(()=>compile(wrap(body)),e=>['E_CHUNK_COVER','E_CHUNK_DENSE'].includes(e.code));
  }
  reject(wrap('chunks (filter xs (x -> x>0)) w'),'E_ABI'); // nested export has no wire shape
  reject(wrap('count (chunks (filter xs (x -> x>0)) w)'),'E_CHUNK_DENSE');
  reject(wrap('count (chunks (scan xs 0 (s -> x -> s+x)) w)'),'E_CHUNK_ACCESS');
  reject(wrap('xs |> chunks w |> map (b -> scan b 0 (s -> x -> s+x)) |> flatten'),'E_CHUNK_ACCESS');
  reject(flatSource.replace('x-at block 0','x-sum block'),'E_CHUNK_WORK');
  reject(flatSource.replace('x-at block 0','(iterate x 2 (s -> {state:s+1,done:false})).state'),'E_CHUNK_WORK');
  for(const body of ['chunks xs w','map (chunks xs w) (b -> b)','chunks xs','map xs (x -> range 2)'])
    reject(wrap(body),'E_ABI');
  reject(wrap('sum (map xs (x -> range 2))'),'E_TYPE');
  reject(wrap('count (chunks (chunks xs w) w)'),'E_LOWER');
});

test('source-local, effect, type and expansion checks retain their boundaries',async()=>{
  const s='export fn bad = (xs:[Num]) -> xs |> chunks 2 |> map (b -> missing b) |> sum;';
  const d=checkSources([{name:'client.ass',source:s}]).diagnostics[0];
  assert.equal(d.code,'E_NAME');assert.equal(d.sourceName,'client.ass');assert.equal(d.range.start.offset,s.indexOf('missing'));
  const work=checkSources([{name:'client.ass',source:flatSource.replace('x-at block 0','x-sum block')}]).diagnostics[0];
  assert.equal(work.code,'E_CHUNK_WORK');assert.equal(work.sourceName,'client.ass');
  reject('export fn bad = (xs:[Num]) -> count (chunks xs true);','E_TYPE');
  reject('fn chunks = x -> x;export fn main = () -> 1;','E_NAME');
  reject('host fn read:Num -> Num;export fn bad = (xs:[Num]) -> xs |> chunks 2 |> map (b -> read (sum b));','E_EFFECT');
  const effect='host fn audit:Num -> Bool;export fn main = (xs:[Num]) -> effect {perform audit 1;map (chunks xs 2) (b -> sum b)};';
  const r=await createRuntime(compile(effect,{maxLoopIterations:0})),seen=[];
  assert.throws(()=>r.call('main',[[1]]),e=>e.code==='E_CAPABILITY');
  const cap=createCapability({audit:{parameters:['Num'],result:'Bool',call:x=>(seen.push(x),true)}},{maxCalls:1});
  assert.throws(()=>r.call('main',[[1]],{capability:cap}),WebAssembly.RuntimeError);assert.deepEqual(seen,[1]);
  assert.throws(()=>compile(flatSource,{maxExpansion:1}),e=>e.code==='E_LIMIT');
  let body='xs';for(let i=0;i<33;i++)body=`flatten (chunks (${body}) w)`;
  reject(wrap(body),'E_LIMIT');
});

test('raw outputs preserve ownership, bit patterns, alignment and untouched canaries',async()=>{
  const source='export fn main = (xs:[Num]) -> do {let ys=flatten (chunks xs 2);{a:ys,b:map ys (x -> x>0)}};';
  const c=compile(source),memory=new WebAssembly.Memory({initial:1,maximum:1});new Uint8Array(memory.buffer).fill(0xa5);
  const arena=new Arena(memory),frame=prepareCall(arena,c.abi.exports[0],[[0,0,0,0]],{outputBytes:48});
  const bits=[0x7ff8000000000042n,0x8000000000000000n,0x7ff0000000000000n,0n],view=new DataView(memory.buffer);
  bits.forEach((x,i)=>view.setBigUint64(frame.slots[0]+i*8,x,true));
  const f=(await instantiate(c,{memory})).exports.main,end=f(...frame.slots);
  const pointer=view.getUint32(frame.resultPointer,true);
  assert.deepEqual(bits,bits.map((_,i)=>view.getBigUint64(pointer+8*i,true)));
  assert(new Uint8Array(memory.buffer,end,16).every(x=>x===0xa5));
  const before=new Uint8Array(memory.buffer).slice(),bad=[...frame.slots];bad[c.abi.exports[0].result.slots[1]]=bad[0];
  assert.throws(()=>f(...bad),WebAssembly.RuntimeError);assert.deepEqual(new Uint8Array(memory.buffer),before);
  const r=await createRuntime(c);assert.throws(()=>r.call('main',[[1,2,3,4]],{outputBytes:47}),WebAssembly.RuntimeError);
  const value=r.call('main',[[1,2]]);r.call('main',[[9]]);assert.deepEqual([...value.a],[1,2]);
});

test('managed and prepared calls keep snapshots, overrides, disposal and post-trap reset',async()=>{
  const compiler=createCompiler();compiler.compile(sumSource).bytes.fill(0);const c=compiler.compile(sumSource);assert(c.cache.hit);
  const r=await createRuntime(c),xs=[1,2,3,4,5],lease=r.prepare('main',[xs,2],{outputBytes:40});
  try {xs[0]=100;assert.deepEqual([...lease.run()],[3,7,5]);assert.deepEqual([...lease.run({w:3})],[6,9]);
    assert.throws(()=>lease.run({w:0}),WebAssembly.RuntimeError);assert.deepEqual([...lease.run()],[3,7,5]);}
  finally{lease.dispose();}
  assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');assert.deepEqual([...r.call('main',[[2,3],1])],[2,3]);
});

test('previously materialized orders remain strict and retain their own scratch cost',async()=>{
  const s=wrap('sort_by xs (x -> x) |> chunks w |> map (b -> sum b)');
  const c=compile(s),r=await createRuntime(c);assert.equal(c.abi.version,2);assert.equal(c.stats.scratchReservationSites,1);
  assert.deepEqual([...r.call('main',[[5,1,3,2,4],2],{scratchBytes:160})],[3,7,5]);
  assert.throws(()=>r.call('main',[[5,1,3,2,4],2],{scratchBytes:159}),WebAssembly.RuntimeError);
  reject(wrap('xs |> chunks w |> map (b -> count (sort_by b (x -> x)))'),'E_ORDER_SCOPE');
  const count=await createRuntime(compile(wrap('count (flatten (chunks (sort_by xs (x -> x)) w))')));
  assert.throws(()=>count.call('main',[[1,NaN],2]),WebAssembly.RuntimeError);
});

test('certificates reconstruct the exact family rather than accepting a claimed domain',()=>{
  const s=wrap('do {let bs=chunks xs w;let other=chunks xs 2;let ignored=sum (map other (b -> sum b));{xs:flatten (map bs (b -> map b (x -> x*2))),ignored}}');
  const steps=compile(s).certificate.steps;assert(verifyCertificate(steps));
  const mutate=f=>{const copy=structuredClone(steps);f(copy);assert.throws(()=>verifyCertificate(copy));};
  mutate(ss=>delete ss.find(s=>s.rule==='chunks').obligation);
  mutate(ss=>delete ss.find(s=>s.rule==='flatten_chunks').obligation);
  mutate(ss=>ss.find(s=>s.rule==='flatten_chunks').domain=999);
  mutate(ss=>ss.find(s=>s.rule==='flatten_chunks').parents[1]=ss.filter(s=>s.rule==='chunk')[1].id);
  mutate(ss=>ss.find(s=>s.rule==='chunk').parents=[0]);
  const select=compile(wrap('count (at (chunks xs w) 0)')).certificate.steps;
  const forged=structuredClone(select);forged.find(s=>s.rule==='select_block').domain=0;assert.throws(()=>verifyCertificate(forged));
});

test('documented fixtures, linked helpers, vertical layout, CLI and browser assertions execute',async()=>{
  const doc=await readFile(new URL('../docs/CHUNK-VIEWS.md',import.meta.url),'utf8');
  const examples=[...doc.matchAll(/<!-- chunk-example: (\w+) -->\n```ass\n([\s\S]*?)\n```/g)];assert.equal(examples.length,3);
  for(const [,name,source] of examples) {
    assert.equal(source+'\n',await readFile(new URL(`../examples/case-studies/chunks/${name}.ass`,import.meta.url),'utf8'));
    assert.deepEqual(compile(source).bytes,compile(source.replaceAll('\n','\r\n')).bytes);
    assert.deepEqual(compile(source).bytes,compile(source.replace(/\/\/[^\n]*/g,'').replace(/\s+/g,' ')).bytes);
  }
  const files=[{name:'lib.ass',source:'fn means = xs -> w -> map (chunks xs w) (b -> sum b/count b);'},
    {name:'client.ass',source:'export fn main = (xs:[Num]) -> means xs 2;'}];
  assert.deepEqual([...(await createRuntime(compileSources(files))).call('main',[[1,3,10]])],[2,10]);
  const cli=spawnSync(process.execPath,['examples/case-studies/app.mjs','chunk-block-exposure'],{cwd:new URL('../',import.meta.url),input:'[[10,13,20,18,30],2]',encoding:'utf8',timeout:15000});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),[33,58,30]);
  const driver=spawnSync(process.execPath,['examples/interop/chunk-views.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(driver.status,0,driver.stderr);assert(JSON.parse(driver.stdout).reports.every(r=>r.intermediateBytes===0));
  const report={checks:0,cases:[]};await runChunkViewBrowserChecks({compile,check},createRuntime,report);assert.equal(report.checks,56);
});

test('record-state updates and sparse block reductions keep their ordinary semantics',async()=>{
  const state=wrap('xs |> chunks w |> map (b -> do {let state=fold b {left:0,right:1} (s -> x -> {left:s.right+x,right:s.left-x});state.left*10+state.right})');
  const sparse=wrap('xs |> chunks w |> map (b -> filter b (x -> x>0)) |> map sum');
  const xs=[1,2,-3,4,0];
  for(const mode of modes) {
    const expected=blocks(xs,2).map(b=>{let s={left:0,right:1};for(const x of b)s={left:s.right+x,right:s.left-x};return s.left*10+s.right;});
    assert.deepEqual([...(await createRuntime(compile(state,mode))).call('main',[xs,2])],expected);
    assert.deepEqual([...(await createRuntime(compile(sparse,mode))).call('main',[xs,2])],[3,4,0]);
  }
});

test('flattened virtual indexing has no block-count-sized work and retains width checks',async()=>{
  const source='export fn main = (n:Num) -> (w:Num) -> (i:Num) -> at (range n |> chunks w |> map (b -> map b (x -> x-at b 0)) |> flatten) i;';
  const c=compile(source,{maxLoopIterations:0}),f=(await instantiate(c)).exports.main;
  assert.equal(c.stats.functions[0].loops,0);assert.equal(c.stats.needsMemory,false);
  assert.equal(f(1e9,3,999999998),2);assert.equal(f(2147483647,3,2147483646),0);
  assert.throws(()=>f(5,0,0),WebAssembly.RuntimeError);assert.throws(()=>f(5,2,5),WebAssembly.RuntimeError);
});

test('raw Bool selection never reads an inactive block, and odd output alignment remains exact',async()=>{
  const source='export fn main = (xs:[Bool]) -> do {let b=at (chunks xs 2) 0;{a:b,b:map b (x -> if x then 1 else 0)}};';
  const c=compile(source),memory=new WebAssembly.Memory({initial:1}),arena=new Arena(memory);
  new Uint8Array(memory.buffer).fill(0xa5);
  const frame=prepareCall(arena,c.abi.exports[0],[[true]],{outputBytes:16});
  const f=(await instantiate(c,{memory})).exports.main,end=f(...frame.slots);
  assert.deepEqual(plain(frame.lift(end)),{a:[true],b:[1]});
  assert.equal(end,frame.outputStart+16);assert(new Uint8Array(memory.buffer,end,8).every(x=>x===0xa5));
  const input=prepareCall(arena,c.abi.exports[0],[[true,false,true]],{outputBytes:24});
  new DataView(memory.buffer).setUint32(input.slots[0]+8,2,true); // malformed Bool in the unselected tail
  assert.deepEqual(plain(input.lift(f(...input.slots))),{a:[true,false],b:[1,0]});
});

test('already-issued effect results remain atomic even when their arguments contained a reduction',async()=>{
  const source='host fn offset:Num -> Num;export fn main = (xs:[Num]) -> effect {let delta=perform offset (sum (range 3));xs |> chunks 2 |> map (b -> map b (x -> x+delta)) |> flatten};';
  const r=await createRuntime(compile(source,{maxLoopIterations:5})),seen=[];
  const capability=createCapability({offset:{parameters:['Num'],result:'Num',call:x=>(seen.push(x),x)}},{maxCalls:1});
  assert.deepEqual([...r.call('main',[[1,2]],{capability})],[4,5]);
  assert.deepEqual(seen,[3]);assert.equal(capability.remaining,0);
});
