import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { compile, compileSources, checkSources, createCompiler, instantiate, verifyCertificate } from '../src/compiler.mjs';
import { parse, infer } from '../src/frontend.mjs';
import { createRuntime, createCapability } from '../src/abi.mjs';
import { reference } from './reference.mjs';
import { localPatternCases } from './local-patterns-cases.mjs';

const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const reject=(s,code)=>assert.throws(()=>compile(s),e=>e.code===code);
const main=body=>`export fn main = () -> do {${body}};`;
const source=async name=>readFile(new URL(`../examples/case-studies/vertical/${name}.ass`,import.meta.url),'utf8');

for(const c of localPatternCases) test(`local patterns: ${c.name}`,async()=>{
  for(const mode of modes) {
    const artifact=compile(c.source,mode),r=await createRuntime(artifact);
    assert.deepEqual(plain(r.call('main',c.args)),c.expected);
    assert.deepEqual(plain(reference(c.source,'main',c.args)),c.expected);
    assert(verifyCertificate(artifact.certificate.steps));
    assert.equal(artifact.stats.kernelHeapAllocationSites,0);
  }
});

test('local patterns check every product shape, even unused and explicitly annotated ones',()=>{
  for(const [pattern,value] of [
    ['(a,b)','(1,)'],['(a,b)','(1,2,3)'],['(a,b)','1'],['()','1'],['()','(1,)'],
    ['{}','1'],['{absent}','{present:1}'],['{a:(x,y)}','{a:(1,)}'],
    ['(x:Bool)','1'],['{weight:(x:Num)}','{weight:true}'],
    ['((x,):{_0:Num,_1:Num})','(1,2)'],['({}:Num)','1'],
    ['{a:((x:Num,y):(Bool,Num))}','{a:(true,2)}'],
    ['((x:Num):Bool)','true'],
  ]) reject(main(`let ${pattern}=${value};7`),'E_TYPE');
});

test('all pattern names participate in duplicate checks, without reserving underscore',()=>{
  for(const body of [
    'let (x,x)=(1,2);x','let {a:x,b:x}={a:1,b:2};x','let {x,x:y}={x:1};x',
    'let {x}={x:1};let x=2;x','let x=1;let (y,x)=(2,3);y',
    'let (x,y)=(1,2);let {a:y}={a:3};x','let (_,_)=(1,2);0',
  ]) reject(main(body),'E_NAME');
});

test('scope, generalization, occurs checks and ABI restrictions survive lowering',async()=>{
  reject(main('let {x}={x:x};x'),'E_NAME');
  reject(main('let x=do {let {hidden}={hidden:3};hidden};hidden'),'E_NAME');
  reject(`fn bad = f -> do {let {copy}={copy:f};(copy 1,copy true)};
    export fn main = () -> bad (x -> x);`,'E_TYPE');
  reject(`fn bad = x -> do {let {alias}={alias:x};alias alias}; export fn main = () -> 1;`,'E_OCCURS');
  reject(main('let {run}={run:x -> x};run'),'E_ABI');
  reject('export fn main = () -> do {let {xs}={xs:map (range 3) (x -> {x})};xs};','E_ABI');
  const types=infer(parse('fn swap = p -> do {let (x,y)=p;(y,x)};export fn main = () -> swap (1,true);'));
  assert(!JSON.stringify(types.signatures).includes('$pattern'));
  const forward='fn helper = x -> do {let {value}={value:x+1};value};';
  const linked=compileSources([{name:'client.ass',source:'export fn main(x:Num)=helper(x);'},{name:'helper.ass',source:forward}]);
  assert.equal((await createRuntime(linked)).call('main',[4]),5);
});

test('shape checking adds no runtime assertion and does not force pure bindings',async()=>{
  const sources=[
    [main('let {valid,value}={valid:false,value:7};value'),7],
    [main('let {ignored}={ignored:require false 0};7'),7],
    [main('let {value}=require false {value:7};value'),null],
    [main('let {valid,value}={valid:false,value:7};require valid value'),null],
  ];
  for(const mode of modes)for(const [s,expected] of sources){const r=await createRuntime(compile(s,mode));
    if(expected===null)assert.throws(()=>r.call('main',[{}]),WebAssembly.RuntimeError);
    else assert.equal(r.call('main',[{}]),expected);
  }
});

test('one source initializer, one shared causal identity, independent invocations',async()=>{
  const s=`fn build = xs -> do {let h=scan xs 0 (s -> x -> s+x);{a:h,b:h}};
    export fn main = (xs:[Num]) -> do {let {a,b}=build xs;{left:a,right:b}};`;
  const ast=parse(s).definitions[1].body;
  const walk=n=>n&&typeof n==='object'?Object.values(n).reduce((s,v)=>s+walk(v),n.kind==='name'&&n.name==='build'?1:0):0;
  assert.equal(walk(ast),1);
  const c=compile(s,{maxLoopIterations:3});
  assert.equal(c.stats.functions[0].loops,1);assert.equal(c.stats.functions[0].stateMachines,1);
  const r=await createRuntime(c),result=r.call('main',[[1,2,3]]);
  assert.deepEqual(plain(result),{left:[1,3,6],right:[1,3,6]});
  result.left[0]=99;assert.equal(result.right[0],1);
  const independent=compile(s.replace('let {a,b}=build xs;', 'let {a}=build xs;let {b}=build xs;'));
  assert.equal(independent.stats.functions[0].stateMachines,2);
});

test('performed calls remain direct, sequenced and exactly once even when their binding is unused',async()=>{
  const s=`host fn audit:Num -> Bool;export fn main = (x:Num) -> effect {
    let (ok:Bool)=perform audit x;
    let {flag,value}={flag:ok,value:x};
    let (unused:Bool)=perform audit (value+1);
    {flag,value}
  };`;
  for(const mode of modes) {
    const artifact=compile(s,mode),runtime=await createRuntime(artifact),seen=[];
    assert.throws(()=>runtime.call('main',[3]),e=>e.code==='E_CAPABILITY');
    const capability=createCapability({audit:{parameters:['Num'],result:'Bool',call:x=>(seen.push(x),true)}},{maxCalls:2});
    assert.deepEqual(runtime.call('main',[3],{capability}),{flag:true,value:3});
    assert.deepEqual(seen,[3,4]);assert.equal(capability.remaining,0);
  }
  for(const body of ['let (ok:Bool)=audit x;ok',
    'let {run}={run:audit};let ok=perform run x;ok',
    'let (ok:Bool)=perform audit;ok', 'let (ok:Bool)=perform audit x x;ok'])
    reject(`host fn audit:Num -> Bool;export fn main = (x:Num) -> effect {${body}};`,'E_EFFECT');
  reject('host fn audit:Num -> Bool;export fn main = () -> effect {let {ok}=perform audit 1;ok};','E_TYPE');
  reject('host fn audit:Num -> Bool;export fn main = () -> effect {let (ok:Num)=perform audit 1;ok};','E_TYPE');
});

test('named stopping results retain suffix laziness and exact aggregate budgets',async()=>{
  const s=await source('threshold');
  for(const mode of modes) {
    const c=compile(s,{...mode,maxLoopIterations:2});const r=await createRuntime(c);
    assert.deepEqual(r.call('reach_target',[[2,3,-99],5]),{reached:true,total:5,visited:2});
    assert.throws(()=>r.call('reach_target',[[2,-99,3],5]),WebAssembly.RuntimeError);
    assert.throws(()=>r.call('reach_target',[[1,1,1],5]),WebAssembly.RuntimeError);
    assert.deepEqual(r.call('reach_target',[[],5]),{reached:false,total:0,visited:0});
    assert.throws(()=>r.call('reach_target',[[],0]),WebAssembly.RuntimeError);
    assert.equal(r.call('reach_target',[[5],5]).visited,1);
    const small=await createRuntime(compile(s,{...mode,maxLoopIterations:1}));
    assert.throws(()=>small.call('reach_target',[[2,3],5]),WebAssembly.RuntimeError);
  }
  const raw=compile('export fn main = (n:Num) -> do {let {total}={total:sum (range n)};total};',{maxLoopIterations:3});
  const f=(await instantiate(raw)).exports.main;
  assert.equal(f(3),3);assert.throws(()=>f(4),WebAssembly.RuntimeError);assert.equal(f(1),0);
});

test('vertical layout, comments and CRLF preserve the exact AST meaning and bytes',async()=>{
  for(const name of ['threshold','shared_report','paired_error']) {
    const s=await source(name),noComments=s.replace(/\/\/[^\n]*/g,'');
    const compact=noComments.replace(/\s+/g,' ').trim();
    const crlf=s.replaceAll('\n','\r\n');
    for(const mode of modes) {
      const normal=compile(s,mode);assert.deepEqual(normal.bytes,compile(compact,mode).bytes);
      assert.deepEqual(normal.bytes,compile(crlf,mode).bytes);
    }
  }
  const c=localPatternCases.find(c=>c.name==='nested record and tuple names');
  const comments=c.source.replace('let {','let // names\n {').replace('=\n','= // initializer\n');
  assert.deepEqual(compile(c.source).bytes,compile(comments).bytes);
});

test('malformed local patterns and missing delimiters are localized, not inferred from layout',()=>{
  for(const body of ['let [x]=range 1;x','let {x,,}={x:1};x','let (x,y)=(1,2) x+y',
    'let x:Num=1;x','let {x}=;x','let {x}= {x:1};', 'let (x y)=(1,2);x'])reject(main(body),'E_PARSE');
  const bad='// client\nexport fn main = () -> do {let {x}={x:missing};x};';
  const checked=checkSources([{name:'lib.ass',source:'fn id = x -> x;'}, {name:'client.ass',source:bad}]);
  assert.equal(checked.diagnostics[0].code,'E_NAME');assert.equal(checked.diagnostics[0].sourceName,'client.ass');
  assert.equal(checked.diagnostics[0].range.start.offset,bad.indexOf('missing'));
  const duplicate='export fn main = () -> do {let x=1;let {x}={x:2};x};';
  assert.throws(()=>compileSources([{name:'client.ass',source:duplicate}]),e=>
    e.code==='E_NAME'&&e.sourceName==='client.ass'&&e.offset===duplicate.indexOf('{x}')+1);
  const type='export fn main = () -> do {let {x}=3;x};';
  assert.throws(()=>compileSources([{name:'client.ass',source:type}]),e=>
    e.code==='E_TYPE'&&e.sourceName==='client.ass'&&e.offset===type.indexOf('{x}'));
});

test('new patterns remain under syntax, nesting and staging budgets',()=>{
  reject(main(`let ${'('.repeat(260)}x${')'.repeat(260)}=1;x`),'E_LIMIT');
  const width=10000, names=Array.from({length:width},(_,i)=>`x${i}`).join(',');
  reject(main(`let (${names})=(${Array(width).fill(1).join(',')});0`),'E_LIMIT');
  assert.throws(()=>compile(main('let {value}={value:1};value'),{maxExpansion:1}),e=>e.code==='E_LIMIT');
  const many=Array.from({length:120},(_,i)=>`let {value:x${i}}={value:${i}};`).join('\n');
  assert(WebAssembly.validate(compile(main(many+'x119')).bytes));
});

test('cached compilation, prepared inputs and borrowed-domain rules remain unchanged',async()=>{
  const s=await source('shared_report'),compiler=createCompiler();
  compiler.compile(s).bytes.fill(0);const artifact=compiler.compile(s);
  assert(artifact.cache.hit);const runtime=await createRuntime(artifact),x=[1,2,3];
  const lease=runtime.prepare('running_report',[x,{start:0,alert:3}]);
  try {const a=lease.run();x[0]=99;const b=lease.run();assert.deepEqual(a,b);a.values[0]=42;assert.equal(b.values[0],1);}
  finally {lease.dispose();}
  reject('export fn main = (xs:[Num]) -> do {let {h}={h:scan xs 0 (s -> x -> s+x)};at h 0};','E_CAUSAL_ACCESS');
  reject('export fn main = (xs:[Num]) -> (ys:[Num]) -> do {let (a,b)=(xs,ys);zip a b (x -> y -> x+y)};','E_DOMAIN');
  const error=await createRuntime(compile(await source('paired_error')));
  assert.throws(()=>error.call('error_summary',[[1],[1,2]]),WebAssembly.RuntimeError);
  assert.throws(()=>error.call('error_summary',[[Infinity],[1]]),WebAssembly.RuntimeError);
  assert.deepEqual(error.call('error_summary',[[],[]]),{count:0,rms:0,maximum:0});
});

test('seeded pattern/program family matches explicit projections in all lowering modes',async t=>{
  let programs=0,evaluations=0;
  for(let i=0;i<32;i++) {
    const intro=`export fn main = (x:Num) -> do {let r={p:(x,${i}),meta:{scale:${i+1}}};`;
    const patterned=intro+'let {p:(a,b),meta:{scale}}=r; (a+b)*scale};';
    const explicit=intro+'let a=r.p._0;let b=r.p._1;let scale=r.meta.scale;(a+b)*scale};';
    for(const mode of modes){const a=compile(patterned,mode),b=compile(explicit,mode);assert.deepEqual(a.bytes,b.bytes);
      const r=await createRuntime(a);
      for(const x of [-3,-0,0,1,7]){assert.equal(r.call('main',[x]),(x+i)*(i+1));evaluations++;}
      programs++;
    }
  }
  t.diagnostic(JSON.stringify({programs,evaluations}));
});

test('published vertical comparison runs as a complete program',()=>{
  const p=spawnSync(process.execPath,['examples/interop/vertical-composition.mjs'],
    {cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:20000});
  assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);
  assert(r.cases.every(c=>c.sameBytes));assert.equal(r.cases.length,3);
});

test('published vertical source blocks are exact executable fixtures',async()=>{
  const doc=await readFile(new URL('../docs/VERTICAL-COMPOSITION.md',import.meta.url),'utf8');
  const blocks=[...doc.matchAll(/<!-- vertical-example: (\w+) -->\n```ass\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length,3);
  for(const [,name,body] of blocks)assert.equal(body+'\n',await source(name));
});

test('long vertical pipelines retain explicit stage boundaries and ordinary first-argument calls',async()=>{
  const stages=Array.from({length:64},()=> '    |> plus 1').join('\n');
  const s=`fn plus = x -> y -> x+y; export fn main = (n:Num) -> do {
    let {value} = n\n${stages}\n    |> (x -> {value:x});
    value
  };`;
  const c=compile(s);assert.equal(c.stats.functions[0].loops,0);
  assert.equal((await createRuntime(c)).call('main',[1]),65);
  assert.deepEqual(c.bytes,compile(s.replace(/\s+/g,' ')).bytes);
  assert.throws(()=>compile(main('let [x]=range 1;x')),e=>e.code==='E_PARSE'&&e.message.includes('before ='));
});

test('the prefix example rejects finite-input overflow before returning an infinite total',async()=>{
  const r=await createRuntime(compile(await source('threshold')));
  assert.throws(()=>r.call('reach_target',[[1e308,1e308],Number.MAX_VALUE]),WebAssembly.RuntimeError);
  assert.equal(r.call('reach_target',[[5],5]).total,5);
});
