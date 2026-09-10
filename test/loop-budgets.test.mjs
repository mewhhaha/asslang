import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compile,compileSources,check,checkSources,createCompiler,instantiate,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime,createCapability,readABI,Arena,prepareCall} from '../src/abi.mjs';

const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const run=async(source,args,limit,options={})=>(await createRuntime(compile(source,
  {...options,...(limit===undefined?{}:{maxLoopIterations:limit})}))).call('main',args);
const squares='export fn main = (n:Num) -> sum (map (range n) (x -> x*x));';
const plain=v=>Array.isArray(v)?v.map(plain):ArrayBuffer.isView(v)?Array.from(v):v&&typeof v==='object'
  ?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
async function boundary(source,args,required,expected,options) {
  assert.deepEqual(plain(await run(source,args,required,options)),expected);
  if(required>0)await assert.rejects(()=>run(source,args,required-1,options),WebAssembly.RuntimeError);
}

for(const options of modes)test(`every scalar loop family obeys exact aggregate boundaries ${JSON.stringify(options)}`,async()=>{
  const fixtures=[
    [squares,[5],5,30],
    ['export fn main = (xs:[Num]) -> fold xs {sum:0,count:0} (s -> x -> {sum:s.sum+x,count:s.count+1});',[[1,2,3]],3,{sum:6,count:3}],
    ['export fn main = (xs:[Num]) -> sum (filter xs (x -> x>99));',[[1,2,3]],3,0],
    ['export fn main = (xs:[Num]) -> count (filter xs (x -> x>1));',[[1,2,3]],3,2],
    ['export fn main = (xs:[Num]) -> map (scan xs 0 (s -> x -> s+x)) (x -> 2*x);',[[1,2,3]],3,[2,6,12]],
    ['export fn main = (xs:[Num]) -> transduce xs 0 (s -> x -> {state:s+x,emit:false,value:x});',[[1,2,3]],3,[]],
    ['export fn main = (xs:[Bool]) -> map xs (x -> !x);',[[true,false,true]],3,[false,true,false]],
    ['export fn main = () -> fold_until (filter (range 10) (x -> x>0)) 0 (s -> x -> {state:s+x,done:x>=2});',[{}],3,{state:3,steps:2,done:true}],
    ['export fn main = () -> iterate 1 100 (s -> {state:2*s,done:s>=4});',[{}],3,{state:8,steps:3,done:true}],
  ];
  for(const [source,args,required,expected] of fixtures)
    await boundary(source,args,required,expected,options);
});

for(const options of modes)test(`nested and multiple-output loops share one counter ${JSON.stringify(options)}`,async()=>{
  const fixtures=[
    ['export fn main = (n:Num) -> (m:Num) -> sum (map (range n) (i -> sum (map (range m) (j -> i+j))));',[3,4],15,30],
    ['export fn main = () -> sum (map (range 3) (i -> (iterate 0 (i+1) (s -> {state:s+1,done:false})).state));',[{}],9,6],
    ['export fn main = () -> iterate 0 3 (s -> {state:s+sum (map (range 2) (i -> s+i)),done:false});',[{}],9,{state:13,steps:3,done:false}],
    ['export fn main = (xs:[Num]) -> {a:map xs (x -> x*x),b:map xs (x -> x+1)};',[[1,2,3]],6,{a:[1,4,9],b:[2,3,4]}],
    ['export fn main = () -> fold (range 0) (sum (range 3)) (s -> x -> s+x);',[{}],3,3],
    ['export fn main = () -> iterate (sum (range 3)) 0 (s -> {state:s,done:false});',[{}],3,{state:3,done:false,steps:0}],
    ['export fn main = () -> require (sum (range 3)>0) (sum (range 0));',[{}],3,0],
  ];
  for(const [source,args,required,expected] of fixtures)
    await boundary(source,args,required,expected,options);
});

test('SIMD pairs cost two, scalar tails cost one, without disabling vectorization',async()=>{
  for(const options of modes)for(const kind of ['map','sum']) {
    const source=kind==='map'?'export fn main = (xs:[Num]) -> map xs (x -> x*x);'
      :'export fn main = (xs:[Num]) -> sum (map xs (x -> x*x));';
    const c=compile(source,{...options,maxLoopIterations:10});
    const f=c.stats.functions[0];
    assert.equal(f.simd.vectorizedLoops,options.simd?1:0);
    assert.equal(f.loopBudget.sites,options.simd?2:1);
    for(let n=0;n<=7;n++) {
      const xs=Array.from({length:n},(_,i)=>i+1),ys=xs.map(x=>x*x);
      await boundary(source,[xs],n,kind==='map'?ys:ys.reduce((a,b)=>a+b,0),options);
    }
  }
});

test('fusion charges shared traversal once and independent traversals separately',async()=>{
  const source='export fn main = (xs:[Num]) -> do {let ys=scan xs 0 (s -> x -> s+x); {sum:sum ys,count:count ys}};';
  for(const options of modes) {
    const required=options.reductionFusion?4:8;
    await boundary(source,[[1,2,3,4]],required,{sum:20,count:4},options);
    const c=compile(source,{...options,maxLoopIterations:required});
    assert.equal(c.stats.functions[0].loops,options.reductionFusion?1:2);
    assert.equal(c.stats.functions[0].loopBudget.sites,c.stats.functions[0].loops);
    assert.equal(verifyCertificate(c.certificate.steps),true);
  }
});

test('memoization charges a reduction only when forced, not once per use',async()=>{
  const source='export fn main = (xs:[Num]) -> map xs (x -> x+sum xs);';
  for(const options of modes) {
    await boundary(source,[[1,2,3]],options.memoizeReductions?6:12,[7,8,9],options);
    assert.deepEqual(Array.from(await run(source,[[]],0,options)),[]);
  }
});

test('zero allowance permits scalar, empty, inactive, and extent-only computations',async()=>{
  const fixtures=[
    ['export fn main = () -> 7;',[{}],7],
    [squares,[0],0],
    ['export fn main = (xs:[Num]) -> map xs (x -> require false x);',[[]],[]],
    ['export fn main = (xs:[Num]) -> count xs;',[[1,2,3]],3],
    ['export fn main = (flag:Bool) -> if flag then sum (range 100) else 7;',[false],7],
    ['export fn main = () -> do {let unused=sum (range 100); 7};',[{}],7],
    ['export fn main = () -> {safe:7,dead:sum (range 100)}.safe;',[{}],7],
    ['export fn main = () -> (iterate 7 0 (s -> {state:require false s,done:false})).state;',[{}],7],
    ['export fn main = (xs:[Num]) -> scan xs (require false 0) (s -> x -> s+x);',[[]],[]],
  ];
  for(const options of modes)for(const [source,args,expected] of fixtures)
    await boundary(source,args,0,expected,options);
});

test('ordinary primal guards and entry span checks are not suppressed by budgets',async()=>{
  for(const options of modes)for(const limit of [0,100])
    await assert.rejects(()=>run('export fn main = () -> require false 7;',[{}],limit,options),WebAssembly.RuntimeError);
  const c=compile('export fn main = (xs:[Num]) -> 7;',{maxLoopIterations:0});
  const memory=new WebAssembly.Memory({initial:1});
  const r=await instantiate(c,{memory});
  assert.equal(r.exports.main(0,0),7);
  assert.throws(()=>r.exports.main(1,1),WebAssembly.RuntimeError);
  assert.throws(()=>r.exports.main(65528,2),WebAssembly.RuntimeError);
});

test('an exhausted allowance traps before the next body and cannot underflow',async()=>{
  // A body would perform another host-free traversal; debit must precede it.
  const source='export fn main = () -> sum (map (range 1) (i -> sum (range 3)+i));';
  await boundary(source,[{}],4,3,{});
  await assert.rejects(()=>run(source,[{}],0),WebAssembly.RuntimeError);
  const full=await createRuntime(compile(squares,{maxLoopIterations:2147483647}));
  assert.equal(full.call('main',[2]),1);
});

test('huge runtime extents are stopped using a tiny budget, in an isolated test process',()=>{
  // A process timeout protects this regression against accidentally unmetered code;
  // it is not a runtime-performance assertion and does not time a successful call.
  const script=`import {compile} from './src/compiler.mjs';
    import {createRuntime} from './src/abi.mjs';
    const r=await createRuntime(compile(${JSON.stringify(squares)},{maxLoopIterations:3}));
    try {r.call('main',[2147483647]);process.exit(2);}
    catch(e) {if(!(e instanceof WebAssembly.RuntimeError))throw e;console.log('budget trapped');}`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000,
  });
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.trim(),'budget trapped');
});

test('normal calls reset after both successful calls and traps, including separate exports',async()=>{
  const source=squares+' export fn other = (n:Num) -> sum (range n);';
  for(const options of modes) {
    const r=await createRuntime(compile(source,{...options,maxLoopIterations:3}));
    for(let i=0;i<3;i++) {
      assert.equal(r.call('main',[3]),5);
      assert.throws(()=>r.call('main',[4]),WebAssembly.RuntimeError);
      assert.equal(r.call('other',[3]),3);
      assert.equal(r.call('main',[2]),1);
    }
  }
});

test('prepared calls reset budgets after traps without corrupting snapshots or results',async()=>{
  const source='export fn main = (xs:[Num]) -> (n:Num) -> map (range n) (i -> at xs i);';
  for(const options of modes) {
    const r=await createRuntime(compile(source,{...options,maxLoopIterations:3}));
    const xs=new Float64Array([2,4,6,8]),lease=r.prepare('main',[xs,3]);xs.fill(99);
    try {
      const first=lease.run();assert.deepEqual(Array.from(first),[2,4,6]);
      assert.throws(()=>lease.run({n:4}),WebAssembly.RuntimeError);
      assert.deepEqual(Array.from(first),[2,4,6]);first.fill(-1);
      const second=lease.run({n:2});assert.deepEqual(Array.from(second),[2,4]);
      assert.throws(()=>r.call('main',[[1],1]),e=>e.code==='E_LEASE_BUSY');
      lease.dispose();
      assert.deepEqual(Array.from(second),[2,4]);
      assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
      assert.deepEqual(Array.from(r.call('main',[[5,6],2])),[5,6]);
    } finally {lease.dispose();}
  }
});

test('raw bytes enforce the policy with no extra imports, globals, or wire arguments',async()=>{
  const limited=compile(squares,{maxLoopIterations:3}),unlimited=compile(squares);
  const module=new WebAssembly.Module(limited.bytes);
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  assert.deepEqual(WebAssembly.Module.exports(module),[{name:'main',kind:'function'}]);
  assert.deepEqual(readABI(module),unlimited.abi);
  const instance=await WebAssembly.instantiate(module,{});
  assert.equal(instance.exports.main.length,1);
  assert.equal(instance.exports.main(3),5);
  assert.throws(()=>instance.exports.main(4),WebAssembly.RuntimeError);
  assert.equal(instance.exports.main(3),5);
  const r=await createRuntime(limited.bytes);
  assert.throws(()=>r.call('main',[4]),WebAssembly.RuntimeError);
  assert.equal(r.call('main',[3]),5);
});

test('metadata describes the artifact policy without changing ASABI',()=>{
  for(const maxLoopIterations of [0,1,2147483647]) {
    const c=compile(squares,{maxLoopIterations}),module=new WebAssembly.Module(c.bytes);
    const expected={version:1,maxLoopIterations,unit:'scalar-loop-iterations'};
    const sections=WebAssembly.Module.customSections(module,'asslang.limits');
    assert.equal(sections.length,1);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(sections[0])),expected);
    assert.deepEqual(c.executionLimits,expected);
    assert.deepEqual(c.stats.functions[0].loopBudget,{limit:maxLoopIterations,sites:1});
    const direct=compile(squares);
    assert.deepEqual(c.abi,direct.abi);assert.deepEqual(c.certificate,direct.certificate);
    assert.equal(c.stats.abiMetadataBytes,direct.stats.abiMetadataBytes);
    assert.equal(c.stats.functions[0].wasmLocalValueBytes,direct.stats.functions[0].wasmLocalValueBytes+4);
    assert.equal(c.stats.needsMemory,false);
  }
  const c=compile(squares,{maxLoopIterations:undefined});
  assert.equal(Object.hasOwn(c,'executionLimits'),false);
  assert.equal(Object.hasOwn(c.stats.functions[0],'loopBudget'),false);
  assert.equal(WebAssembly.Module.customSections(new WebAssembly.Module(c.bytes),'asslang.limits').length,0);
  assert.deepEqual(c.bytes,compile(squares).bytes);
  assert.deepEqual(compile('export fn main = () -> 7;',{maxLoopIterations:0}).stats.functions[0].loopBudget,{limit:0,sites:0});
});

test('limits reject invalid API values without presenting them as source errors',()=>{
  for(const limit of [null,false,true,'10',{},[],NaN,Infinity,-Infinity,-1,0.5,2147483648,Number.MAX_SAFE_INTEGER,1n]) {
    const options={maxLoopIterations:limit};
    for(const build of [()=>compile(squares,options),()=>check(squares,options),
      ()=>compileSources([{name:'main.ass',source:squares}],options),
      ()=>checkSources([{name:'main.ass',source:squares}],options),
      ()=>createCompiler().compile(squares,options)])
      assert.throws(build,e=>e instanceof TypeError&&/maxLoopIterations/.test(e.message));
  }
  assert.equal(check(squares,Object.freeze({maxLoopIterations:0})).ok,true);
});

test('compiler-session policies are isolated, cloned, and included in cache keys',async()=>{
  const compiler=createCompiler();
  const plain=compiler.compile(squares),three=compiler.compile(squares,{maxLoopIterations:3}),two=compiler.compile(squares,{maxLoopIterations:2});
  assert.equal(plain.cache.hit,false);assert.equal(three.cache.hit,false);assert.equal(two.cache.hit,false);
  assert.equal(compiler.compile(squares,{maxLoopIterations:3}).cache.hit,true);
  three.bytes.fill(0);three.executionLimits.maxLoopIterations=999;three.stats.functions[0].loopBudget.limit=999;
  const next=compiler.compile(squares,{maxLoopIterations:3});
  assert.equal(next.executionLimits.maxLoopIterations,3);assert.equal(next.stats.functions[0].loopBudget.limit,3);
  assert.equal((await createRuntime(next)).call('main',[3]),5);
  assert.throws(()=>(new WebAssembly.Instance(new WebAssembly.Module(two.bytes))).exports.main(3),WebAssembly.RuntimeError);
  assert.equal((await createRuntime(plain)).call('main',[4]),14);
  assert.equal(compiler.check(squares,{maxLoopIterations:0}).ok,true);
});

test('linked sources and source-local errors retain their compilation semantics',async()=>{
  const files=[{name:'helper.ass',source:'fn square = x -> x*x;'},
    {name:'main.ass',source:'export fn main = (n:Num) -> sum (map (range n) square);'}];
  const c=createCompiler().compileSources(files,{maxLoopIterations:3});
  const r=await createRuntime(c);assert.equal(r.call('main',[3]),5);assert.throws(()=>r.call('main',[4]),WebAssembly.RuntimeError);
  assert.equal(checkSources(files,{maxLoopIterations:0}).ok,true);
  const bad=[files[0],{name:'bad.ass',source:'// error\nexport fn main = () -> missing 1;'}];
  const d=checkSources(bad,{maxLoopIterations:0}).diagnostics[0];
  assert.equal(d.code,'E_NAME');assert.equal(d.sourceName,'bad.ass');assert.equal(d.range.start.line,2);
  assert.throws(()=>compileSources(bad,{maxLoopIterations:0}),e=>e.code===d.code&&e.offset===d.range.start.offset);
});

test('host argument loops charge before authority is consumed and allow recovery',async()=>{
  const source='host fn h: Num -> Num; export fn main = (n:Num) -> effect {let y=perform h (sum (range n)); y};';
  for(const options of modes) {
    let calls=0;
    const capability=createCapability({h:{parameters:['Num'],result:'Num',call:x=>{calls++;return x;}}},{maxCalls:1});
    const r=await createRuntime(compile(source,{...options,maxLoopIterations:2}));
    assert.throws(()=>r.call('main',[3],{capability}),WebAssembly.RuntimeError);
    assert.equal(calls,0);assert.equal(capability.remaining,1);
    assert.equal(r.call('main',[2],{capability}),1);
    assert.equal(calls,1);assert.equal(capability.remaining,0);
  }
});

test('a later loop trap never refunds or replays earlier host effects',async()=>{
  const source='host fn h: Num -> Num; export fn main = (n:Num) -> effect {let y=perform h 7; y+sum (range n)};';
  for(const options of modes) {
    let calls=0;
    const grant=()=>createCapability({h:{parameters:['Num'],result:'Num',call:x=>{calls++;return x;}}},{maxCalls:1});
    const r=await createRuntime(compile(source,{...options,maxLoopIterations:2})),capability=grant();
    assert.throws(()=>r.call('main',[3],{capability}),WebAssembly.RuntimeError);
    assert.equal(calls,1);assert.equal(capability.remaining,0);
    assert.throws(()=>r.call('main',[2],{capability}),e=>e.code==='E_EFFECT_BUDGET');assert.equal(calls,1);
    assert.equal(r.call('main',[2],{capability:grant()}),8);assert.equal(calls,2);
  }
});

test('host calls do not reset the shared allowance and zero budget is not no-effects mode',async()=>{
  const source=`host fn h: Num -> Num; export fn main = () -> effect {
    let a=perform h (sum (range 2));
    let b=perform h (sum (map (range 2) (x -> x+1))); a+b
  };`;
  let calls=0;
  const capability=createCapability({h:{parameters:['Num'],result:'Num',call:x=>{calls++;return x;}}},{maxCalls:2});
  const r=await createRuntime(compile(source,{maxLoopIterations:3}));
  assert.throws(()=>r.call('main',[{}],{capability}),WebAssembly.RuntimeError);
  assert.equal(calls,1);assert.equal(capability.remaining,1);
  const noLoop=await createRuntime(compile('host fn h: Num -> Num; export fn main = () -> effect {let y=perform h 5; y};',{maxLoopIterations:0}));
  assert.equal(noLoop.call('main',[{}],{capability}),5);assert.equal(calls,2);assert.equal(capability.remaining,0);
  assert.throws(()=>noLoop.call('main',[{}]),e=>e.code==='E_CAPABILITY');
  assert.throws(()=>noLoop.prepare('main',[{}]),e=>e.code==='E_LEASE_EFFECT');
});

test('successful limited execution preserves f64 values in every lowering configuration',async()=>{
  const source='export fn main = (xs:[Num]) -> map xs (x -> x*x-x);';
  const values=[-0,0,1,-2,Infinity,-Infinity,NaN];
  for(const options of modes) {
    const limited=await run(source,[values],values.length,options),unlimited=await run(source,[values],undefined,options);
    for(let i=0;i<values.length;i++)assert.ok(Object.is(limited[i],unlimited[i]));
  }
});

test('documented runtime example executes, traps, and recovers',async()=>{
  const doc=await readFile(new URL('../docs/LOOP-BUDGETS.md',import.meta.url),'utf8');
  const example=doc.match(/```js\n([\s\S]*?)\n```/)[1];
  const source=example.match(/const source = `([\s\S]*?)`;/)[1];
  const maxLoopIterations=Number(example.match(/maxLoopIterations: (\d+)/)[1]);
  // Execute the actual JS example as well as checking its declared boundary.
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const r=await new AsyncFunction('compile','createRuntime',
    example.replace(/^import .*;\n/gm,'')+'\nreturn runtime;')(compile,createRuntime);
  assert.equal(compile(source,{maxLoopIterations}).executionLimits.maxLoopIterations,1000);
  assert.equal(r.call('energy',[10]),285);
  assert.throws(()=>r.call('energy',[1001]),WebAssembly.RuntimeError);
  assert.equal(r.call('energy',[10]),285);
});


test('raw output is untouched when a scalar step or SIMD pair cannot be reserved',async()=>{
  const source='export fn main = (xs:[Num]) -> map xs (x -> x*x);';
  for(const simd of [false,true]) {
    const c=compile(source,{simd,maxLoopIterations:simd?1:0});
    assert.equal(c.stats.functions[0].simd.vectorizedLoops,simd?1:0);
    const memory=new WebAssembly.Memory({initial:1}),arena=new Arena(memory);
    const frame=prepareCall(arena,c.abi.exports[0],[[2,3]],{outputBytes:16});
    new Uint8Array(memory.buffer,frame.outputStart,16).fill(0xa5);
    const instance=await instantiate(c,{memory});
    assert.throws(()=>instance.exports.main(...frame.slots),WebAssembly.RuntimeError);
    assert.ok(new Uint8Array(memory.buffer,frame.outputStart,16).every(x=>x===0xa5));
  }
});

test('negative zero API budgets have canonical zero metadata',()=>{
  const c=compile(squares,{maxLoopIterations:-0});
  assert.equal(c.executionLimits.maxLoopIterations,0);
  assert.equal(c.stats.functions[0].loopBudget.limit,0);
});
