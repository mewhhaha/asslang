import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile, compileSources, checkSources, createCompiler, verifyCertificate} from '../src/compiler.mjs';
import {parse, infer} from '../src/frontend.mjs';
import {createRuntime, createCapability} from '../src/abi.mjs';
import {reference} from './reference.mjs';
import {recordUpdateCases, recordUpdateModes as modes} from './record-updates-cases.mjs';
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const main=body=>`export fn main = () -> do {${body}};`;
const reject=(source,code)=>assert.throws(()=>compile(source),e=>e.code===code);
const run=async(source,args=[{}],options={})=>(await createRuntime(compile(source,options))).call('main',args);
const example=path=>readFile(new URL(`../examples/case-studies/records/${path}.ass`,import.meta.url),'utf8');

for(const c of recordUpdateCases)test(`record updates: ${c.name}`,async()=>{
  for(const mode of modes){
    const a=compile(c.source,mode);
    assert.deepEqual(plain((await createRuntime(a)).call('main',c.args)),c.expected);
    assert.deepEqual(plain(reference(c.source,'main',c.args)),c.expected);
    assert(verifyCertificate(a.certificate.steps));
    assert.equal(a.stats.intermediateBufferBytes,0);
  }
});

test('updates require existing, same-type fields even inside unused generic calls',()=>{
  for(const body of [
    'let r={x:1};let unused={r with absent:2};7',
    'let r={x:1};let unused={r with x:true};7',
    'let r=1;let unused={r with x:1};7',
    'let r={a:{x:1,y:true}};let unused={r with a:{x:2}};7',
    'let r=(1,true);let unused={r with _2:0};7',
  ])reject(main(body),'E_TYPE');
  const helper='fn put = value -> r -> {r with value};';
  for(const bad of ['put true {value:0}', 'put 0 {other:0}'])
    reject(`${helper}fn unused = () -> ${bad};export fn main = () -> 7;`,'E_TYPE');
  reject('symbol x;fn put = r -> {r with [x]:0};fn unused = () -> put {x:1};export fn main = () -> 7;','E_TYPE');
  reject('fn ignore = r -> do {let unused={r with value:0};7};fn unused = () -> ignore {value:true};export fn main = () -> 7;','E_TYPE');
});

test('scope, let generalization, occurs checks and product constraints are retained',async()=>{
  reject(main('let r={x:1};{r with x:missing}'),'E_NAME');
  reject(main('let r={x:1};{r with x:y,y:2}'),'E_NAME');
  reject('fn bad = r -> {r with value:r};export fn main = () -> 1;','E_OCCURS');
  reject('fn bad = f -> do {let r={f};let s={r with f};(s.f 1,s.f true)};export fn main = () -> 0;','E_TYPE');
  const source=`export fn main = () -> do {
    let r={run:x -> x,weight:2};let updated={r with weight:3};
    let {run}=updated;{a:run 1,b:run true}
  };`;
  assert.deepEqual(await run(source),{a:1,b:true});
  const polymorphic='fn put = r -> value -> {r with value};';
  const signatures=infer(parse(polymorphic)).signatures;
  assert.match(signatures.put,/value: 'a, \.\.'b/);
  const constrained=`fn consume = r -> do {
    let changed={r with value:r.value};product_fold changed 0 (s -> x -> s+x)
  };fn unused = () -> consume {value:1,other:true};export fn main = () -> 7;`;
  reject(constrained,'E_TYPE');
});

test('new grammar is bounded, explicit and does not capture existing with names',()=>{
  for(const body of ['let r={x:1};{r with}', 'let r={x:1};{r with x:}',
    'let r={x:1};{r with x:2,,}', 'let r={x:1};{r with x:2 y:3}',
    'let r={inner:{x:1}};{r.inner with x:2}', '{(1 with x:2}',
  ])reject(main(body),'E_PARSE');
  reject(main('let r={x:1};{r with x:2,x:3}'),'E_NAME');
  reject('symbol x;'+main('let r={[x]:1};{r with [x]:2,[x]:3}'),'E_NAME');
  reject(main('let r={x:1};{r with [missing]:2}'),'E_SYMBOL');
  reject('symbol x;'+main('let r={[x]:1};{r with [x+1]:2}'),'E_SYMBOL');
  const source=main('let with={with:1,x:2};{with with x:with.with}');
  assert.equal(parse(source).definitions[0].body.result.kind,'record_update');
  const c=recordUpdateCases[2];
  assert.deepEqual(compile(c.source).bytes,compile(c.source.replaceAll('\n','\r\n')).bytes);
  const comments=source.replace('{with with','{with // base\n with');
  assert.deepEqual(compile(source).bytes,compile(comments).bytes);
});

test('file-local diagnostics identify replacements and keep legacy callers working',async()=>{
  const helper='fn put = r -> x -> {r with x};';
  const files=[{name:'helper.ass',source:helper},{name:'client.ass',source:'export fn main(x:Num)=put({x:x,keep:true},x+1);'}];
  assert.deepEqual((await createRuntime(compileSources(files))).call('main',[3]),{x:4,keep:true});
  for(const [body,code,needle] of [
    ['let r={x:1};{r with x:true}','E_TYPE','x:true'],
    ['let r={x:1};{r with missing:0}','E_TYPE','missing'],
    ['let r={x:1};{r with x:unknown}','E_NAME','unknown'],
    ['let r={x:1};{r with x:2,x:3}','E_NAME','x:3'],
  ]){
    const source='// location\r\n'+main(body),result=checkSources([{name:'other.ass',source:helper},{name:'bad.ass',source}]);
    const d=result.diagnostics[0];assert.equal(d.code,code);assert.equal(d.sourceName,'bad.ass');
    assert.equal(d.range.start.offset,source.indexOf(needle));
  }
});

test('unused and overwritten fields remain lazy; retained field guards still trap',async()=>{
  const safe=[
    ['let r={x:require false 0,y:7};({r with x:9}).y',7],
    ['let r={x:require false 0,y:7};({r with x:9}).x',9],
    ['let r={x:0,y:7};({r with x:require false 1}).y',7],
    ['let r=require false {x:0};({r with x:9}).x',9],
    ['let r={valid:false,x:7};({r with x:8}).x',8],
    ['let r={x:0};({r with x:if false then require false 1 else 3}).x',3],
    ['let r={x:0,y:7};false && (({r with x:require false 1}).x>0)',false],
  ];
  for(const mode of modes){
    for(const [body,expected] of safe)assert.equal(await run(main(body),[{}],mode),expected);
    for(const body of [
      'let r=require false {x:0,y:7};({r with x:9}).y',
      'let r={x:0,y:require false 7};({r with x:9}).y',
      'let r={x:0};({r with x:require false 1}).x',
    ])assert.rejects(()=>run(main(body),[{}],mode),WebAssembly.RuntimeError);
  }
});

test('seeded row-preserving edits agree with independent value and lens laws',async()=>{
  const source=`fn modify = f -> r -> {r with value:f r.value};
    fn put = value -> r -> {r with value};
    export fn main = (r:{value:Num,flag:Bool,nested:{x:Num,y:Num}}) -> (a:Num) -> (b:Num) -> do {
      let changed=modify (x -> x+a) r;
      {changed,identity:put r.value r,last:put b (put a r)}
    };`;
  let seed=0x9e3779b9;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(const mode of modes){
    const runtime=await createRuntime(compile(source,mode));
    for(let i=0;i<32;i++){
      const r={value:next()%2000-1000,flag:!!(next()&1),nested:{x:next()%19,y:next()%29}},a=next()%17,b=next()%31;
      const before=structuredClone(r),got=runtime.call('main',[r,a,b]);
      assert.deepEqual(got,{changed:{...r,value:r.value+a},identity:r,last:{...r,value:b}});
      assert.deepEqual(r,before);
    }
  }
});

test('base expressions stage once and preserve causal sharing and cut-cover evidence',async()=>{
  const build='fn build = xs -> do {let h=scan xs 0 (+);{left:h,right:h,tag:0}};';
  const source=build+'export fn main = (xs:[Num]) -> do {let plan={(build xs) with tag:1};zip plan.left plan.right (a -> b -> a+b)};';
  const ast=parse(source).definitions[1].body;
  const count=n=>n&&typeof n==='object'?Object.values(n).reduce((s,v)=>s+count(v),n.kind==='name'&&n.name==='build'?1:0):0;
  assert.equal(count(ast),1);
  for(const mode of modes){
    const c=compile(source,{...mode,maxLoopIterations:3});assert(verifyCertificate(c.certificate.steps));
    assert.deepEqual(plain((await createRuntime(c)).call('main',[[1,2,3]])),[2,6,12]);
    assert.equal(c.stats.functions[0].stateMachines,1);
    const cuts='export fn main = (xs:[Num]) -> do {let parts=split_at xs 2;let edit={parts with left:map parts.left (x -> x+1)};zip xs (concat edit.left edit.right) (x -> y -> y-x)};';
    assert.deepEqual(plain(await run(cuts,[[1,2,3]],mode)),[1,1,0]);
  }
  reject('export fn main = (xs:[Num]) -> (ys:[Num]) -> do {let r={xs};let s={r with xs:ys};zip xs s.xs (+)};','E_DOMAIN');
  reject('export fn main = (xs:[Num]) -> do {let r={xs};let s={r with xs:scan xs 0 (+)};at s.xs 0};','E_CAUSAL_ACCESS');
});

test('record edits preserve guard preflight separately from lazy scan seeds',async()=>{
  const lazy='export fn main = (xs:[Num]) -> do {let r={xs:scan xs (require false 0) (+),tag:0};sum ({r with tag:1}).xs};';
  const preflight='export fn main = (xs:[Num]) -> do {let r={xs:require false xs,tag:0};sum ({r with tag:1}).xs};';
  for(const mode of modes){
    assert.equal(await run(lazy,[[]],mode),0);
    await assert.rejects(()=>run(lazy,[[1]],mode),WebAssembly.RuntimeError);
    await assert.rejects(()=>run(preflight,[[]],mode),WebAssembly.RuntimeError);
  }
});

test('iteration state edits stop before unvisited suffixes and retain exact budgets',async()=>{
  const source=await example('ledger');
  const account={balance:0,enabled:true,metadata:{revision:7,limit:50}};
  for(const mode of modes){
    const runtime=await createRuntime(compile(source,{...mode,maxLoopIterations:2}));
    assert.deepEqual(runtime.call('settle',[account,[2,3,-99],5]),{
      state:{...account,balance:5},done:true,steps:2});
    assert.throws(()=>runtime.call('settle',[account,[1,1,1],5]),WebAssembly.RuntimeError);
    assert.equal(runtime.call('settle',[account,[5],5]).steps,1);
    assert.equal(runtime.call('settle',[account,[],5]).steps,0);
    assert.throws(()=>runtime.call('settle',[account,[2,-99],5]),WebAssembly.RuntimeError);
  }
});

test('record edits retain AD activity checks and analytic/finite-difference gradients',async()=>{
  const objective='fn objective = p -> do {let q={p with x:2*p.x};q.x*q.x+q.y*q.y};';
  const source=objective+'export fn main = (p:{x:Num,y:Num}) -> grad objective p;';
  for(const mode of modes){
    const runtime=await createRuntime(compile(source,mode));
    for(const p of [{x:3,y:4},{x:-2,y:0.5},{x:0,y:-7}]){
      const actual=runtime.call('main',[p]);assert.deepEqual(actual,{x:8*p.x,y:2*p.y});
      const f=({x,y})=>4*x*x+y*y,h=1e-4;
      for(const k of ['x','y']){
        const fd=(f({...p,[k]:p[k]+h})-f({...p,[k]:p[k]-h}))/(2*h);
        assert(Math.abs(actual[k]-fd)<1e-6);
      }
    }
    const rounded='export fn main = (p:{x:Num,y:Num}) -> grad (r -> ({r with x:floor r.x}).x) p;';
    assert.deepEqual(await run(rounded,[{x:2.5,y:3}],mode),{x:0,y:0});
    const active='export fn main = (xs:[Num]) -> (p:{x:Num,y:Num}) -> grad (r -> ({r with x:at xs r.x}).x) p;';
    assert.throws(()=>compile(active,mode),e=>e.code==='E_DIFF_CONTROL');
  }
});

test('preserved fields retain NaN and signed-zero bits and arithmetic order',async()=>{
  const source='export fn main = (x:Num) -> (y:Num) -> do {let r={x,y};{r with x:y}};';
  const ordered='export fn main = (xs:[Num]) -> do {let r={total:sum xs,tag:0};({r with tag:1}).total};';
  for(const mode of modes){
    for(const [x,y] of [[1,-0],[-0,0],[1,NaN],[1,Infinity]]){
      const got=await run(source,[x,y],mode);assert(Object.is(got.x,y));assert(Object.is(got.y,y));
    }
    assert.equal(await run(ordered,[[1e16,1,-1e16]],mode),0);
  }
});

test('performed effects are not hidden, duplicated or dropped by record edits',async()=>{
  const source=`host fn audit:Num -> Bool;
    export fn main = (x:Num) -> effect {
      let first=perform audit x;let r={first,value:x};let changed={r with first:false};
      let second=perform audit (changed.value+1);{changed with first:second}
    };`;
  for(const mode of modes){
    const runtime=await createRuntime(compile(source,mode)),seen=[];
    const capability=createCapability({audit:{parameters:['Num'],result:'Bool',call:x=>(seen.push(x),true)}},{maxCalls:2});
    assert.deepEqual(runtime.call('main',[3],{capability}),{first:true,value:3});
    assert.deepEqual(seen,[3,4]);assert.equal(capability.remaining,0);
    assert.throws(()=>runtime.call('main',[3],{capability}),e=>e.code==='E_EFFECT_BUDGET');
  }
  for(const expression of ['{r with run:audit}','{r with value:audit 3}'])
    reject(`host fn audit:Num -> Bool;export fn main = () -> do {let r={run:x -> true,value:true};${expression}};`,'E_EFFECT');
});

test('retained input spans and result arrays obey prepared ownership and disposal',async()=>{
  const source=await example('configuration');
  const c=compile(source),runtime=await createRuntime(c);
  const config={name:'demo',enabled:false,network:{retries:0,timeout:30},payload:new Uint8Array([1,2,3])};
  const lease=runtime.prepare('configure',[config,4]);
  config.payload.fill(9);config.name='changed';
  try{
    const a=lease.run(),b=lease.run();assert.deepEqual(plain(a),{name:'demo',enabled:true,network:{retries:4,timeout:30},payload:[1,2,3]});
    a.payload[0]=8;assert.equal(b.payload[0],1);assert.equal(lease.run().payload[0],1);
  }finally{lease.dispose();}
  assert.throws(()=>lease.run());
  const array='export fn main = (xs:[Num]) -> do {let r={xs,tag:0};{r with tag:1}};';
  const r=await createRuntime(compile(array));
  assert.throws(()=>r.call('main',[[1,2,3]],{outputBytes:23}),WebAssembly.RuntimeError);
  assert.deepEqual(plain(r.call('main',[[1,2,3]],{outputBytes:24})),{xs:[1,2,3],tag:1});
});

test('staged values and symbol-keyed records still cannot escape the ABI',()=>{
  reject(main('let r={run:x -> x,tag:0};{r with tag:1}'),'E_ABI');
  reject('symbol hidden;'+main('let r={[hidden]:1,tag:0};{r with tag:1}'),'E_ABI');
  reject('export fn main = r -> {r with x:1};','E_ABI');
});

test('explicit source expansions have identical Wasm, ABI and JTE artifacts',()=>{
  const pairs=[
    ['let r={x,y,keep:true};{r with x:y,y:x}','let r={x,y,keep:true};{x:y,y:x,keep:r.keep}'],
    ['let r={x,y,keep:true};({r with x:2*x}).x+y','let r={x,y,keep:true};({x:2*x,y:r.y,keep:r.keep}).x+y'],
  ];
  for(const mode of modes)for(const [updated,explicit] of pairs){
    const wrap=b=>`export fn main = (x:Num) -> (y:Num) -> do {${b}};`;
    const a=compile(wrap(updated),mode),b=compile(wrap(explicit),mode);
    assert.deepEqual(a.bytes,b.bytes);assert.deepEqual(a.abi,b.abi);assert.deepEqual(a.certificate,b.certificate);
    assert.deepEqual(a.stats.functions,b.stats.functions);
  }
});

test('record-map copying is charged to expansion limits, not hidden behind one AST node',()=>{
  const width=80,fields=Array.from({length:width},(_,i)=>`f${i}:${i}`).join(',');
  const before=main(`let r={${fields}};r.f0`),after=main(`let r={${fields}};({r with f0:3}).f0`);
  const b=compile(before),a=compile(after);
  assert.equal(a.stats.stagingWork-b.stats.stagingWork,width+2);
  assert(WebAssembly.validate(compile(after,{maxExpansion:a.stats.stagingWork}).bytes));
  assert.throws(()=>compile(after,{maxExpansion:a.stats.stagingWork-1}),e=>e.code==='E_LIMIT'&&e.phase==='stage');
  reject(main(`let r={x:1};{${'('.repeat(260)}r${')'.repeat(260)} with x:2}`),'E_LIMIT');
  const copy=Array.from({length:20},(_,i)=>`let r${i}={${i?'r'+(i-1):'r'} with f0:${i}};`).join('');
  assert.throws(()=>compile(main(`let r={${fields}};${copy}r19.f0`),{maxExpansion:1000}),e=>e.code==='E_LIMIT');
});

test('documentation snippets execute and compiler sessions retain isolated snapshots',async()=>{
  const doc=await readFile(new URL('../docs/RECORD-UPDATES.md',import.meta.url),'utf8');
  const snippets=[...doc.matchAll(/<!-- example: record-update-[^>]+ -->\n```ass\n([\s\S]*?)\n```/g)].map(x=>x[1]);
  assert.equal(snippets.length,2);
  assert.deepEqual(await run(snippets[0],['demo']),{name:'demo',score:9,enabled:true,revision:7});
  assert.deepEqual(await run(snippets[1],[4]),{enabled:true,network:{retries:4,timeout:30}});
  const compiler=createCompiler(),s=recordUpdateCases[0].source;
  compiler.compile(s).bytes.fill(0);const hit=compiler.compile(s);
  assert(hit.cache.hit);assert(WebAssembly.validate(hit.bytes));
  assert.deepEqual((await createRuntime(hit)).call('main',[{}]),recordUpdateCases[0].expected);
});

test('record updates retain strict sorting, explicit scratch and output ownership',async()=>{
  const source='export fn main = (xs:[Num]) -> do {let r={xs:sort_by xs (x -> x),tag:0};{r with tag:1}};';
  const first='export fn main = (xs:[Num]) -> do {let r={xs:sort_by xs (x -> x),tag:0};at ({r with tag:1}).xs 0};';
  for(const mode of modes){
    const artifact=compile(source,mode);assert.equal(artifact.abi.version,2);
    const runtime=await createRuntime(artifact);
    const a=runtime.call('main',[[3,1,2]],{scratchBytes:96,outputBytes:24});
    assert.deepEqual(plain(a),{xs:[1,2,3],tag:1});
    assert.throws(()=>runtime.call('main',[[3,1,2]],{scratchBytes:95,outputBytes:24}),WebAssembly.RuntimeError);
    assert.throws(()=>runtime.call('main',[[3,1,2]],{scratchBytes:96,outputBytes:23}),WebAssembly.RuntimeError);
    const b=runtime.call('main',[[3,1,2]],{scratchBytes:96,outputBytes:24});a.xs[0]=99;assert.equal(b.xs[0],1);
    const indexed=await createRuntime(compile(first,mode));
    assert.throws(()=>indexed.call('main',[[1,NaN]],{scratchBytes:64}),WebAssembly.RuntimeError);
  }
});

test('scalar record editing executes natively with no memory imports or loop work',async()=>{
  const source='fn put = x -> r -> {r with x};export fn main = (x:Num) -> (put x {x:0,keep:7}).x;';
  for(const mode of modes){
    const c=compile(source,{...mode,maxLoopIterations:0}),module=await WebAssembly.compile(c.bytes);
    assert.equal(c.stats.needsMemory,false);assert.equal(c.stats.functions[0].loops,0);
    assert.deepEqual(WebAssembly.Module.imports(module),[]);
    const instance=await WebAssembly.instantiate(module);
    for(const x of [3,-0,NaN,Infinity])assert(Object.is(instance.exports.main(x),x));
  }
});
