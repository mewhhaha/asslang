import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { compile, check, checkSources, compileSources, createCompiler, instantiate, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime, createCapability, Arena, prepareCall } from '../src/abi.mjs';
import { reference } from './reference.mjs';
import { runLexicographicKeyBrowserChecks } from './lexicographic-keys-browser.mjs';
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const work=n=>{let result=n;for(let w=1;w<n;w*=2)result+=1+Math.ceil(n/(2*w))+n;return result;};
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const pairSource=`export fn main = (a:[Num]) -> (b:[Num]) ->
  range (count a) |> sort_by (i -> (at a i, at b i));`;
// A separate index oracle, not production key flattening or Wasm comparison.
const order=(a,b)=>Array.from(a,(_,i)=>i).sort((i,j)=>
  a[i]<a[j]?-1:a[i]>a[j]?1:b[i]<b[j]?-1:b[i]>b[j]?1:i-j);
const reject=(s,code='E_TYPE')=>assert.throws(()=>compile(s),e=>e.code===code);

for(const mode of modes)test(`native tuple priorities, stability and exact capacities ${JSON.stringify(mode)}`,async()=>{
  const c=compile(pairSource,mode),r=await createRuntime(c);
  assert(verifyCertificate(c.certificate.steps));assert.equal(c.stats.scratchReservationSites,1);
  assert.equal(c.stats.functions[0].ordering.sites[0].keyLeaves,2);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)).map(i=>i.kind),['memory']);
  for(const [a,b] of [[[],[]],[[1],[9]],[[2,1,2,1,2],[0,9,-1,8,-1]],
    [[-0,0,-0,0],[1,0,-0,1]],[[Number.MAX_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE],[1,-1,0]]]) {
    const output=r.call('main',[a,b],{scratchBytes:48*a.length,outputBytes:8*a.length});
    assert.deepEqual([...output],order(a,b));assert.deepEqual([...output],reference(pairSource,'main',[a,b]));
    const limited=await createRuntime(compile(pairSource,{...mode,maxLoopIterations:work(a.length)+a.length}));
    assert.deepEqual([...limited.call('main',[a,b])],order(a,b));
    if(a.length) {
      assert.throws(()=>r.call('main',[a,b],{scratchBytes:48*a.length-1}),WebAssembly.RuntimeError);
      const short=await createRuntime(compile(pairSource,{...mode,maxLoopIterations:work(a.length)+a.length-1}));
      assert.throws(()=>short.call('main',[a,b]),WebAssembly.RuntimeError);
      assert.deepEqual([...short.call('main',[[],[]])],[]);
    }
  }
});

test('exhaust paired binary keys through length six and compare repeated stable sorts',async t=>{
  const r=await createRuntime(compile(pairSource));
  const repeated=pairSource.replace('sort_by (i -> (at a i, at b i))','sort_by (i -> at b i) |> sort_by (i -> at a i)');
  const two=await createRuntime(compile(repeated));let cases=0;
  for(let n=0;n<=6;n++)for(let word=0;word<4**n;word++) {
    let bits=word;const a=[],b=[];
    for(let i=0;i<n;i++){a.push(bits%2);b.push(Math.floor(bits/2)%2);bits=Math.floor(bits/4);}
    const result=[...r.call('main',[a,b])];
    assert.deepEqual(result,order(a,b));assert.deepEqual(result,[...two.call('main',[a,b])]);cases++;
  }
  assert.equal(cases,5461);t.diagnostic(JSON.stringify({exhaustivePairedKeys:cases}));
});

test('seeded finite pairs, large ties and opposing priorities agree with an independent oracle',async t=>{
  let seed=5219,count=0;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(const mode of modes) {
    const r=await createRuntime(compile(pairSource,mode),{pages:32});
    for(let i=0;i<60;i++) {
      const n=rand()%70,a=Array.from({length:n},()=>rand()%7-3),b=a.map(()=>rand()%17-8);
      assert.deepEqual([...r.call('main',[a,b])],order(a,b));count++;
    }
    for(const n of [1024,4096]) {
      const a=Array.from({length:n},(_,i)=>Math.floor(i/8)),b=a.map((_,i)=>n-i);
      assert.deepEqual([...r.call('main',[a,b])],order(a,b));count++;
    }
  }
  t.diagnostic(JSON.stringify({seededAndLargePairs:count}));
});

test('tuple association, nested reusable subkeys and singleton keys erase to the same backend',async()=>{
  const a='export fn main = (xs:[Num]) -> sort_by xs (x -> (abs x, x, x*x));';
  for(const mode of modes) {
    const c=compile(a,mode);
    for(const key of ['((abs x,x),x*x)','(abs x,(x,x*x))'])
      assert.deepEqual(c.bytes,compile(a.replace('(abs x, x, x*x)',key),mode).bytes);
    const scalar='export fn main = (xs:[Num]) -> sort_by xs (x -> abs x);';
    assert.deepEqual(compile(scalar,mode).bytes,compile(scalar.replace('x -> abs x','x -> (abs x,)'),mode).bytes);
  }
  const helper='fn subkey = x -> (abs x,x);export fn main = (xs:[Num]) -> sort_by xs (x -> (subkey x,x*x));';
  assert.deepEqual(compile(a).bytes,compile(helper).bytes);
  const r=await createRuntime(compile(helper));assert.deepEqual([...r.call('main',[[-2,1,2,-1]])],[-1,1,-2,2]);
});

test('numeric tuple positions outrank field spelling and construction order',async()=>{
  const key=Array(9).fill('0').concat(['x','-x','0']).join(',');
  const r=await createRuntime(compile(`export fn main = (xs:[Num]) -> sort_by xs (x -> (${key}));`));
  assert.deepEqual([...r.call('main',[[1,-1]])],[-1,1]);
  const structural='export fn main = (xs:[Num]) -> sort_by xs (x -> {_1:-x,_0:x});';
  const tuple=structural.replace('{_1:-x,_0:x}','(x,-x)');
  assert.deepEqual([...(await createRuntime(compile(structural))).call('main',[[1,-1]])],[-1,1]);
  assert.deepEqual(compile(structural).bytes,compile(tuple).bytes);
});

test('tuple keys avoid the demonstrated precision loss of scalar score packing',async()=>{
  const a=[1,1],b=[1,0];
  const tuple=await createRuntime(compile(pairSource));
  const packed=await createRuntime(compile(pairSource.replace('(at a i, at b i)','at a i * 9007199254740992 + at b i')));
  assert.deepEqual([...tuple.call('main',[a,b])],[1,0]);
  assert.deepEqual([...packed.call('main',[a,b])],[0,1]);
});

test('key constraints survive helpers, aliases, destructuring, partial application and unused callers',async()=>{
  const prelude='fn by = key -> xs -> sort_by xs key;';
  const s=prelude+`export fn main = (xs:[Num]) -> do {
    let {sort}={sort:by};
    {a:sort (x -> x) xs,b:sort (x -> (abs x,-x)) xs}
  };`;
  assert.deepEqual(plain((await createRuntime(compile(s))).call('main',[[-2,2,1]])),{a:[-2,1,2],b:[1,2,-2]});
  const invalid=[
    prelude+'fn unused = () -> by (x -> true) (range 2);',
    'fn by = xs -> sort_by xs (r -> (r.a,r.b));fn unused = () -> by (map (range 1) (x -> {a:true,b:0}));',
    'fn by = xs -> sort_by xs;fn unused = () -> (by (range 1)) (x -> (x,true));',
    'fn by = xs -> sort_by xs (r -> r);fn unused = () -> by (map (range 1) (x -> {label:x}));',
    'fn by = xs -> do {let {sort}={sort:sort_by};sort xs (x -> (x,true))};',
  ];
  for(const prefix of invalid){const report=check(prefix+'export fn main = () -> 1;');assert.equal(report.diagnostics[0].code,'E_TYPE');assert.equal(report.diagnostics[0].phase,'infer');}
  reject('fn bad = f -> do {let xs=sort_by (range 2) f;let (a,b)=f 1;let n=f 2 + 1;7};export fn main = () -> 1;');
});

test('scalar-inferred exports keep their Num boundary without defaulting unrelated variables',async()=>{
  for(const src of ['export fn main = xs -> sort_by xs (x -> x);',
    'fn by = xs -> sort_by xs (x -> x);export fn main = xs -> by xs;',
    'export fn main = xs -> sort_by xs (x -> (x,x));']) {
    const c=compile(src);assert.equal(c.signatures.main,'[Num] -> [Num]');
    assert.deepEqual([...(await createRuntime(c)).call('main',[[2,1]])],[1,2]);
  }
  reject('export fn main = (xs:[Num]) -> unrelated -> {values:sort_by xs (x -> (x,x)),unrelated};','E_ABI');
});

test('invalid key shapes and width/depth limits are checked even in unused definitions',async()=>{
  for(const key of ['true','()','{x}','if x>0 then x else (x,x)','(x,true)','(x,())','range 1','(y -> y)',
    '{_0:x,_2:x}','{_00:x}','{_1:x}','{_0:x,named:x}']) {
    reject(`fn unused = (xs:[Num]) -> sort_by xs (x -> ${key}); export fn main = () -> 1;`);
  }
  reject('symbol key; fn unused = xs -> sort_by xs (x -> {[key]:x});export fn main = () -> 1;');
  const width=n=>`export fn main = (xs:[Num]) -> sort_by xs (x -> (${Array(n).fill('x').join(',')}));`;
  const c=compile(width(16));assert.equal(c.stats.functions[0].ordering.sites[0].rowBytes,136);
  assert.deepEqual([...(await createRuntime(c)).call('main',[[2,1]],{scratchBytes:544})],[1,2]);
  reject(width(17),'E_LIMIT');
  const deep=n=>`export fn main = (xs:[Num]) -> sort_by xs (x -> ${'('.repeat(n)}x${',)'.repeat(n)});`;
  assert(WebAssembly.validate(compile(deep(16)).bytes));reject(deep(17),'E_LIMIT');
});

test('all key components remain strict even when a primary key would decide every comparison',async()=>{
  for(const mode of modes) {
    const s='export fn main = (xs:[Num]) -> count (sort_by xs (x -> (x, require false x)));';
    const r=await createRuntime(compile(s,mode));
    assert.throws(()=>r.call('main',[[1,2]]),WebAssembly.RuntimeError);assert.equal(r.call('main',[[]]),0);
    const bad=await createRuntime(compile(s.replace('require false x','1/0'),mode));
    assert.throws(()=>bad.call('main',[[1]]),WebAssembly.RuntimeError);
    const lazy=compile(s.replace('count (sort_by xs (x -> (x, require false x)))','do {let unused=sort_by xs (x -> (x,require false x));7}'),mode);
    assert.equal(lazy.abi.version,1);assert.equal((await createRuntime(lazy)).call('main',[[1,2]]),7);
    const branch=await createRuntime(compile('export fn main = (xs:[Num]) -> (flag:Bool) -> if flag then count (sort_by xs (x -> (x,require false x))) else 7;',mode));
    assert.equal(branch.call('main',[[1,2],false]),7);
  }
});

test('key loops run during materialization, not comparisons, and share the invocation allowance',async()=>{
  const s='export fn main = (xs:[Num]) -> sort_by xs (n -> (sum (range n),sum (range (n+1))));';
  for(const mode of modes) {
    const r=await createRuntime(compile(s,{...mode,maxLoopIterations:32}));
    assert.deepEqual([...r.call('main',[[3,1,2]])],[1,2,3]);
    const short=await createRuntime(compile(s,{...mode,maxLoopIterations:31}));
    assert.throws(()=>short.call('main',[[3,1,2]]),WebAssembly.RuntimeError);
    assert.deepEqual([...short.call('main',[[1]])],[1]);
  }
});

test('later key dependencies register invariant orders with separate reservations',async()=>{
  const s=`export fn main = (xs:[Num]) -> do {
    let auxiliary=sort_by xs (x -> -x);
    let ordered=sort_by xs (x -> (x,at auxiliary 0));
    ordered
  };`;
  const c=compile(s),r=await createRuntime(c);assert.equal(c.stats.scratchReservationSites,2);
  assert.deepEqual([...r.call('main',[[3,1,2]],{scratchBytes:240})],[1,2,3]);
  assert.throws(()=>r.call('main',[[3,1,2]],{scratchBytes:239}),WebAssembly.RuntimeError);
  assert.deepEqual([...r.call('main',[[]],{scratchBytes:0,outputBytes:0})],[]);
  reject('export fn main = (xs:[Num]) -> sort_by xs (x -> (x,count (sort_by xs (n -> n))));','E_ORDER_SCOPE');
});

test('sparse and causal producers retain clocks, strict accepted rows, and fresh provenance',async()=>{
  const s=`export fn main = (xs:[Num]) -> do {
    let ordered=xs |> scan 0 (s -> x -> s+x) |> filter (x -> x!=0) |> sort_by (x -> (abs x,x));
    {values:ordered,sum:sum ordered}
  };`;
  const r=await createRuntime(compile(s));
  for(const xs of [[],[1,-2,1,3,-5]])assert.deepEqual(plain(r.call('main',[xs])),reference(s,'main',[xs]));
  reject('export fn main = (xs:[Num]) -> zip xs (sort_by xs (x -> (x,x))) (x -> y -> x+y);','E_DOMAIN');
  reject('export fn main = (xs:[Num]) -> zip (sort_by xs (x -> (x,x))) (sort_by xs (x -> (x,x))) (x -> y -> x+y);','E_DOMAIN');
  const shared='export fn main = (xs:[Num]) -> do {let ys=sort_by xs (x -> (abs x,x));zip ys (map ys (x -> x*2)) (x -> y -> x+y)};';
  assert.deepEqual([...(await createRuntime(compile(shared))).call('main',[[2,-1,1]])],[-3,3,6]);
});

test('raw tuple-key rows preserve payload bits, canaries and input separation',async()=>{
  const c=compile('export fn main = (xs:[Num]) -> sort_by xs (x -> (0,0));');
  const memory=new WebAssembly.Memory({initial:1,maximum:1});new Uint8Array(memory.buffer).fill(0xa5);
  const arena=new Arena(memory),frame=prepareCall(arena,c.abi.exports[0],[[0,0,0,0]],{scratchBytes:192,outputBytes:32});
  const bits=[0x7ff8000000000042n,0x8000000000000000n,0x7ff0000000000000n,0x0000000000000000n];
  const view=new DataView(memory.buffer);bits.forEach((v,i)=>view.setBigUint64(frame.slots[0]+8*i,v,true));
  const instance=await instantiate(c,{memory});const end=instance.exports.main(...frame.slots);
  const pointer=view.getUint32(frame.resultPointer,true);
  assert.deepEqual(bits,bits.map((_,i)=>view.getBigUint64(pointer+8*i,true)));
  assert(new Uint8Array(memory.buffer,end,16).every(v=>v===0xa5));
  const before=new Uint8Array(memory.buffer).slice(),slots=[...frame.slots];
  slots[c.abi.exports[0].scratch.slots[0]]=slots[0];
  assert.throws(()=>instance.exports.main(...slots),WebAssembly.RuntimeError);
  assert.deepEqual(new Uint8Array(memory.buffer),before);
  const bool=await createRuntime(compile('export fn main = (xs:[Bool]) -> sort_by xs (x -> (if x then 0 else 1,0));'));
  assert.deepEqual(bool.call('main',[[false,true,false,true]]),[true,true,false,false]);
});

test('cached compilation and prepared calls retain input snapshots and fresh key tuples',async()=>{
  const s='export fn main = (xs:[Num]) -> (center:Num) -> sort_by xs (x -> (abs (x-center),x));';
  const compiler=createCompiler();compiler.compile(s).bytes.fill(0);const c=compiler.compile(s);assert(c.cache.hit);
  const r=await createRuntime(c),input=[3,1,2],lease=r.prepare('main',[input,0],{scratchBytes:144,outputBytes:24});
  try {
    const a=lease.run();input[0]=99;assert.deepEqual([...lease.run({center:3})],[3,2,1]);
    assert.deepEqual([...lease.run()],[1,2,3]);a[0]=999;assert.equal(lease.run()[0],1);
  } finally {lease.dispose();}
  assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
  assert.throws(()=>r.call('main',[[1,2,3],0],{scratchBytes:143}),WebAssembly.RuntimeError);
  assert.deepEqual([...r.call('main',[[1],0])],[1]);
});

test('type, effect, differentiation and source-local diagnostics remain explicit',async()=>{
  const bad='export fn main = (xs:[Num]) -> sort_by xs (x -> (x,missing));';
  const d=checkSources([{name:'priorities.ass',source:bad}]).diagnostics[0];
  assert.equal(d.code,'E_NAME');assert.equal(d.sourceName,'priorities.ass');assert.equal(d.range.start.offset,bad.indexOf('missing'));
  const keybad='fn by = xs -> sort_by xs (r -> (r.a,r.b));';
  const client='fn unused = () -> by (map (range 1) (x -> {a:1,b:true}));export fn main = () -> 7;';
  const kd=checkSources([{name:'lib.ass',source:keybad},{name:'client.ass',source:client}]).diagnostics[0];
  assert.equal(kd.code,'E_TYPE');assert.equal(kd.sourceName,'client.ass');
  reject('host fn read:Num -> Num; export fn main = (xs:[Num]) -> sort_by xs (x -> (x,read x));','E_EFFECT');
  reject('export fn main = (n:Num) -> grad (x -> at (sort_by (range 3) (y -> (x,y))) 0) n;','E_DIFF_UNSUPPORTED');
  const effect='host fn audit:Num -> Bool;export fn main = (xs:[Num]) -> effect {perform audit 1;sort_by xs (x -> (x,x))};';
  const r=await createRuntime(compile(effect,{maxLoopIterations:0})),seen=[];
  assert.throws(()=>r.call('main',[[1]]),e=>e.code==='E_CAPABILITY');
  const cap=createCapability({audit:{parameters:['Num'],result:'Bool',call:x=>(seen.push(x),true)}},{maxCalls:1});
  assert.throws(()=>r.call('main',[[1]],{capability:cap}),WebAssembly.RuntimeError);assert.deepEqual(seen,[1]);
});

test('registered examples, compact/vertical layout, CLI and documented comparison execute',async()=>{
  for(const [file,name,args,expected] of [
    ['nearest_ties','nearest_ties',[[7,3,6,4,7,5],5],[5,4,6,3,7,7]],
    ['schedule_jobs','schedule_jobs',[[2,1,2,3,2],[9,1,4,8,4]],[3,2,4,0,1]],
  ]) {
    const s=await readFile(new URL(`../examples/case-studies/ordering/${file}.ass`,import.meta.url),'utf8');
    const compact=s.replace(/\/\/[^\n]*/g,'').replace(/\s+/g,' ');
    assert.deepEqual(compile(s).bytes,compile(compact).bytes);
    assert.deepEqual([...(await createRuntime(compile(s))).call(name,args)],expected);
    assert.deepEqual(compile(s).bytes,compile(s.replaceAll('\n','\r\n')).bytes);
  }
  const run=spawnSync(process.execPath,['examples/interop/lexicographic-keys.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr);const {reports}=JSON.parse(run.stdout);
  assert.deepEqual(reports.map(r=>r.scratchBytes),[400,640]);assert.deepEqual(reports.map(r=>r.loopUnits),[34,63]);
  const cli=spawnSync(process.execPath,['examples/case-studies/app.mjs','lexicographic-jobs'],{cwd:new URL('../',import.meta.url),input:'[[2,1,2,3,2],[9,1,4,8,4]]',encoding:'utf8',timeout:15000});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),[3,2,4,0,1]);
});

test('browser assertions execute in Node too',async()=>{
  const report={checks:0,cases:[]};await runLexicographicKeyBrowserChecks({compile},createRuntime,report);
  assert.equal(report.checks,56);assert.equal(report.cases.length,1);
});

test('published source examples are the exact registered files',async()=>{
  const doc=await readFile(new URL('../docs/LEXICOGRAPHIC-KEYS.md',import.meta.url),'utf8');
  const blocks=[...doc.matchAll(/<!-- lexicographic-example: (\w+) -->\n```ass\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length,2);
  for(const [,name,source] of blocks)
    assert.equal(source+'\n',await readFile(new URL(`../examples/case-studies/ordering/${name}.ass`,import.meta.url),'utf8'));
});
