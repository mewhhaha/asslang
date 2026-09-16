import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile,compileSources,check,checkSources,createCompiler,verifyCertificate } from '../src/compiler.mjs';
import { parse,infer,primitiveArities,builtinArities } from '../src/frontend.mjs';
import { intrinsicArities } from '../src/intrinsics.mjs';
import { preludeSource,preludeArities,createPrelude } from '../src/prelude.mjs';
import { createRuntime,createCapability } from '../src/abi.mjs';
import { corePreludeCases } from './core-prelude-cases.mjs';
import { runCorePreludeBrowserChecks } from './core-prelude-browser.mjs';
import { sourceBasis } from '../examples/case-studies/core/source-basis.mjs';
const root=new URL('../',import.meta.url);
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>[false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const files=source=>[{name:'prelude.ass',source:preludeSource},{name:'app.ass',source}];
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const reject=(source,code,options)=>assert.throws(()=>compile(source,options),e=>e.code===code);
const run=(args,input)=>spawnSync(process.execPath,args,{cwd:root,input,encoding:'utf8',timeout:20000});

test('source and generated snapshot agree; every callable has an explicit boundary decision',async()=>{
  assert.equal(preludeSource,await readFile(new URL('../lib/prelude.ass',import.meta.url),'utf8'));
  const guide=await readFile(new URL('../docs/CORE-AND-PRELUDE.md',import.meta.url),'utf8');
  assert.equal(guide.match(/<!-- core-prelude-source -->\n```ass\n([\s\S]*?)\n```/)[1]+'\n',preludeSource);
  assert.equal(guide.match(/<!-- core-example -->\n```ass\n([\s\S]*?)\n```/)[1]+'\n',sourceBasis);
  assert.equal(Object.keys(builtinArities).length,37);assert.equal(Object.keys(primitiveArities).length,33);
  assert.deepEqual(Object.keys(preludeArities).sort(),['grad','jvp','sum','vjp']);
  for(const name of Object.keys(preludeArities)){assert(!Object.hasOwn(primitiveArities,name));assert(!Object.hasOwn(intrinsicArities,name));}
  assert(Object.isFrozen(preludeArities));
  for(const path of ['scripts/build-prelude.mjs','scripts/audit-core.mjs']){
    const result=run([path,...(path.includes('build-')?['--check']:[])]);assert.equal(result.status,0,result.stderr);
    if(path.includes('audit-'))assert.equal(JSON.parse(result.stdout).compilerPrimitives,33);
  }
});

for(const c of corePreludeCases)test(`source prelude: ${c.name}`,async()=>{
  for(const options of modes){
    const compiled=compile(c.source,options),explicit=compileSources(files(c.source),{...options,prelude:false});
    assert.deepEqual(compiled.bytes,explicit.bytes);assert.deepEqual(compiled.abi,explicit.abi);
    assert.deepEqual(compiled.certificate,explicit.certificate);assert(verifyCertificate(compiled.certificate.steps));
    assert.deepEqual(plain((await createRuntime(compiled)).call('main',c.args)),c.expected);
    assert.equal(compiled.stats.intermediateBufferBytes,0);
    assert.deepEqual(Object.keys(compiled.signatures),['main']);
  }
});

test('core-only mode supports explicit linkage and independently named derivations',async()=>{
  for(const c of corePreludeCases){
    const renamedSource=c.source.replace(/\b(sum|grad|jvp|vjp)\b/g,'derived_$1');
    const renamedPrelude=preludeSource.replace(/\b(sum|grad|jvp|vjp)\b/g,'derived_$1');
    const renamed=compileSources([{name:'library.ass',source:renamedPrelude},{name:'app.ass',source:renamedSource}],{prelude:false});
    assert.deepEqual(renamed.bytes,compile(c.source).bytes);
  }
  for(const [name,expr] of [['sum','sum (range 3)'],['grad','grad (x -> x*x) 3'],['jvp','(jvp (x -> x*x) 3 1).value'],['vjp','(vjp (x -> x*x) 3 1).value']]){
    const s=`export fn main = () -> ${expr};`;
    assert.equal(check(s,{prelude:false}).diagnostics[0].code,'E_NAME',name);
    assert(checkSources(files(s),{prelude:false}).ok);
  }
  const custom='fn sum = xs -> 17;export fn main = () -> sum (range 3);';
  reject(custom,'E_NAME');assert.equal((await createRuntime(compile(custom,{prelude:false}))).call('main',[{}]),17);
  reject('fn fold = x -> x;export fn main = () -> 1;','E_NAME',{prelude:false});
});

test('default names remain shadowable locally without capturing helper binders or primitives',async()=>{
  const source=`export fn main = (xs:[Num]) -> do {
    let plan=19;let total=23;let fold=x -> x;let reduce=sum;
    let sum=x -> x+1;
    {direct:sum plan,derived:reduce xs,untouched:fold total}
  };`;
  assert.deepEqual((await createRuntime(compile(source))).call('main',[[1,2,3]]),{direct:20,derived:6,untouched:23});
  const local='export fn main = () -> do {let grad=x -> x;let jvp=x -> x;let vjp=x -> x;let sum=x -> x;sum (vjp (jvp (grad 7)))};';
  const c=compile(local);assert.equal((await createRuntime(c)).call('main',[{}]),7);
  assert.deepEqual(c.stats.sourcePrelude.functions,[]);assert.equal(c.stats.sourcePrelude.syntaxNodes,0);
});

test('loading has per-compilation ASTs and normal type generalization',async()=>{
  const s='export fn main = (x:Num) -> do {let d=grad;{a:d (p -> p*p) x,b:d (p -> p.a*p.a) {a:x}}};';
  const p=parse(s),before=structuredClone(p),inferred=infer(p);
  assert.deepEqual(p,before,'Inference must not inject source into caller AST');
  assert.equal(inferred.preludeDefinitions.length,1);
  inferred.preludeDefinitions[0].body.kind='broken';
  assert.deepEqual((await createRuntime(compile(s))).call('main',[3]),{a:6,b:{a:6}});
  reject('fn bad = f -> do {let d=f;(d 1,d true)};export fn main = () -> 0;','E_TYPE');
  const c=compile('export fn main = x -> x+1;');assert.equal(c.stats.sourcePrelude.syntaxNodes,0);
  assert.equal(compile('fn unused = xs -> sum xs;export fn main = () -> 7;').stats.sourcePrelude.functions[0],'sum');
});

test('scalar and product shape checks remain, including unselected one-shot derivatives',()=>{
  for(const expr of [
    '(jvp (x -> sum (range 3)) 1 1).value',
    '(vjp (x -> sum (range 3)) 1 1).value',
  ])reject(`export fn main = () -> ${expr};`,'E_DIFF_UNSUPPORTED');
  for(const expr of ['grad (x -> 1) {}','grad (x -> 1) true','(jvp (x -> x) true true).value','(vjp (x -> x) true true).value'])
    reject(`export fn main = () -> ${expr};`,'E_DIFF_TYPE');
  for(const expr of ['sum true','grad (x -> true) 1','jvp (x -> x*x) 1 true','vjp (x -> x*x) 1 true'])
    reject(`export fn main = () -> ${expr};`,'E_TYPE');
  const point='{'+Array.from({length:65},(_,i)=>`f${i}:1`).join(',')+'}';
  reject(`export fn main = () -> grad (p -> p.f0) ${point};`,'E_LIMIT');
});

test('source wrappers retain selected primal demand, lazy unused runtime fields and strict sum guards',async()=>{
  for(const options of modes){
    for(const expr of ['sum (require false (range 0))','grad (x -> require false (x*x)) 3','(jvp (x -> require false (x*x)) 3 1).tangent','(vjp (x -> require false (x*x)) 3 1).cotangent']){
      const r=await createRuntime(compile(`export fn main = () -> ${expr};`,options));
      assert.throws(()=>r.call('main',[{}]),WebAssembly.RuntimeError);
    }
    const unused=compile('export fn main = () -> do {let ignored=sum (require false (range 0));7};',{...options,maxLoopIterations:0});
    assert.equal((await createRuntime(unused)).call('main',[{}]),7);
    const empty=await createRuntime(compile('export fn main = (xs:[Num]) -> sum (scan xs (require false 0) (s -> x -> s+x));',options));
    assert(Object.is(empty.call('main',[[]]),0));assert.throws(()=>empty.call('main',[[1]]),WebAssembly.RuntimeError);
  }
});

test('ordered source sum retains f64 behavior, no intermediates, SIMD and exact loop allowances',async()=>{
  const s='export fn main = (xs:[Num]) -> sum xs;';
  for(const options of modes){
    const c=compile(s,{...options,maxLoopIterations:4}),r=await createRuntime(c);
    for(const xs of [[],[-0],[Infinity],[-Infinity],[NaN],[1e16,1,-1e16,1]]){
      const wanted=xs.reduce((a,b)=>a+b,0),got=r.call('main',[xs]);
      assert(Object.is(got,wanted)||Number.isNaN(got)&&Number.isNaN(wanted));
    }
    assert.throws(()=>r.call('main',[[1,2,3,4,5]]),WebAssembly.RuntimeError);
    assert.equal(r.call('main',[[3]]),3);assert.equal(c.stats.intermediateBufferBytes,0);
    if(options.simd)assert(c.stats.functions[0].simd.vectorizedLoops>0);
  }
});

test('source derivatives retain performed-result identity and cannot create host authority',async()=>{
  const s=`host fn weight:Num -> Num;export fn main = (x:Num) -> effect {
    let w=perform weight 2;
    let f=y -> y*w;
    {g:grad f x,j:(jvp f x 1).tangent,v:(vjp f x 1).cotangent}
  };`;
  for(const options of modes){
    const r=await createRuntime(compile(s,options));assert.throws(()=>r.call('main',[3]),e=>e.code==='E_CAPABILITY');
    let called=0;const cap=createCapability({weight:{parameters:['Num'],result:'Num',call:x=>(called++,x)}},{maxCalls:1});
    assert.deepEqual(r.call('main',[3],{capability:cap}),{g:2,j:2,v:2});assert.equal(called,1);assert.equal(cap.remaining,0);
  }
  reject('host fn read:Num -> Num;export fn main = (x:Num) -> grad (y -> read y) x;','E_EFFECT');
  reject('host fn sum:Num -> Num;export fn main = () -> 1;','E_NAME');
});

test('prelude internals point to the invocation; user objectives keep their own source locations',()=>{
  const bad='// distinct file\nexport fn main = () -> grad (x -> 1) {};';
  const d=checkSources([{name:'lib.ass',source:'fn id = x -> x;'},{name:'app.ass',source:bad}]).diagnostics[0];
  assert.equal(d.code,'E_DIFF_TYPE');assert.equal(d.sourceName,'app.ass');assert.equal(d.range.start.offset,bad.indexOf('grad'));
  const partial='export fn main = () -> do {let apply=grad (x -> 1);apply {}};';
  const p=checkSources([{name:'partial.ass',source:partial}]).diagnostics[0];
  assert.equal(p.code,'E_DIFF_TYPE');assert.equal(p.range.start.offset,partial.lastIndexOf('apply'));
  const objective='fn objective = (x:Num) -> at (scan (range 2) 0 (s -> x -> s+x)) 0;';
  const q=checkSources([{name:'objective.ass',source:objective},{name:'caller.ass',source:'export fn main = () -> grad objective 1;'}]).diagnostics[0];
  assert.equal(q.code,'E_CAUSAL_ACCESS');assert.equal(q.sourceName,'objective.ass');assert.equal(q.range.start.offset,objective.indexOf('at ('));
  const text='export fn main = () -> sum (range 3);';
  const c=compileSources([{name:'app.ass',source:text}]);
  assert.deepEqual(c.sourceFiles,[{name:'app.ass',start:0,end:text.length}]);
});

test('cache keys distinguish prelude modes and returned artifacts remain independent',async()=>{
  const compiler=createCompiler(),source='export fn main = xs -> sum xs;';
  const a=compiler.compile(source);assert(!a.cache.hit);a.bytes.fill(0);a.stats.sourcePrelude.functions.length=0;
  const b=compiler.compile(source,{prelude:true});assert(b.cache.hit);assert(WebAssembly.validate(b.bytes));
  assert.deepEqual(b.stats.sourcePrelude.functions,['sum']);
  assert.equal(compiler.check(source,{prelude:false}).diagnostics[0].code,'E_NAME');
  const src='export fn main = x -> x+1;';
  assert(!compiler.compile(src).cache.hit);assert(!compiler.compile(src,{prelude:false}).cache.hit);
  assert(compiler.compile(src,{prelude:false}).cache.hit);
  const r=await createRuntime(compiler.compileSources(files(source),{prelude:false}));assert.equal(r.call('main',[[1,2]]),3);
  for(const prelude of [null,0,'false',{},[]])assert.throws(()=>compiler.check(source,{prelude}),TypeError);
});

test('prelude parsing and invocation have explicit bounded cost',()=>{
  const nodes=parse(preludeSource).nodeCount;
  const accepted=createPrelude(parse,true,50_000-nodes,(message)=>{throw new Error(message);});
  assert(accepted.definition('sum',{pos:7}));assert.equal(accepted.syntaxNodes,nodes);
  const limited=createPrelude(parse,true,50_001-nodes,(message,at,code)=>{assert.equal(at.pos,9);assert.equal(code,'E_LIMIT');throw new Error(message);});
  assert.throws(()=>limited.definition('sum',{pos:9}),/including source prelude/);
  reject('export fn main = () -> sum (range 3);','E_LIMIT',{maxExpansion:1});
  const plainSource='export fn main = (xs:[Num]) -> fold xs 0 (s -> x -> s+x);';
  const a=compile(plainSource,{prelude:false}),b=compile(plainSource.replace('fold xs 0 (s -> x -> s+x)','sum xs'));
  assert.deepEqual(a.bytes,b.bytes);assert(b.stats.stagingWork>a.stats.stagingWork);
});

test('count cannot become a counting fold without changing structural demand and work',async()=>{
  const s='export fn main = (n:Num) -> count (map (range n) (x -> require false x));';
  const structural=await createRuntime(compile(s,{maxLoopIterations:0,prelude:false}));assert.equal(structural.call('main',[5]),5);
  const folded=await createRuntime(compile(s.replace('count (map (range n) (x -> require false x))','fold (map (range n) (x -> require false x)) 0 (s -> x -> s+1)'),{maxLoopIterations:0,prelude:false}));
  assert.throws(()=>folded.call('main',[5]),WebAssembly.RuntimeError);
  const causal=await createRuntime(compile('export fn main = (xs:[Num]) -> count (scan xs 0 (s -> x -> require false (s+x)));',{prelude:false}));
  assert.throws(()=>causal.call('main',[[1]]),WebAssembly.RuntimeError);assert.equal(causal.call('main',[[]]),0);
});

test('reconstructed indexing and emit-always machines cannot forge map/scan provenance',()=>{
  const map='export fn main = (xs:[Num]) -> zip xs (map xs (x -> x+1)) (x -> y -> x+y);';
  assert(check(map,{prelude:false}).ok);
  reject(map.replace('map xs (x -> x+1)','map (range (count xs)) (i -> at xs i + 1)'),'E_DOMAIN',{prelude:false});
  const scan='export fn main = (xs:[Num]) -> zip xs (scan xs 0 (s -> x -> s+x)) (x -> y -> x+y);';
  assert(check(scan,{prelude:false}).ok);
  reject(scan.replace('scan xs 0 (s -> x -> s+x)','transduce xs 0 (s -> x -> {state:s+x,value:s+x,emit:true})'),'E_DOMAIN',{prelude:false});
  reject('export fn main = (xs:[Num]) -> at (scan xs 0 (s -> x -> s+x)) 0;','E_CAUSAL_ACCESS',{prelude:false});
});

test('a source length assertion cannot replace checked positional pairing',async()=>{
  const prefix='export fn main = (a:[Num]) -> (b:[Num]) -> ';
  reject(prefix+'require (count a == count b) (zip a b (x -> y -> x+y));','E_DOMAIN',{prelude:false});
  const r=await createRuntime(compile(prefix+'zip_checked a b (x -> y -> x+y);',{prelude:false}));
  assert.deepEqual([...r.call('main',[[1,2],[3,4]])],[4,6]);assert.throws(()=>r.call('main',[[1],[3,4]]),WebAssembly.RuntimeError);
});

test('a non-stopping sink cannot preserve suffix demand just by freezing its result',async()=>{
  const prefix='export fn main = (xs:[Num]) -> do {let h=scan xs 0 (s -> x -> require (x>=0) (s+x));';
  const a=await createRuntime(compile(prefix+'(fold_until h 0 (s -> x -> {state:x,done:x>=3})).state};',{prelude:false}));
  const b=await createRuntime(compile(prefix+'fold h 0 (s -> x -> if s>=3 then s else x)};',{prelude:false}));
  assert.equal(a.call('main',[[1,2,-99]]),3);assert.throws(()=>b.call('main',[[1,2,-99]]),WebAssembly.RuntimeError);
});

test('numeric primitives cannot be replaced using real-number identities at f64 boundaries',async()=>{
  const r=await createRuntime(compile('export fn main = (a:Num) -> (b:Num) -> {native:min a b,conditional:if a<=b then a else b};',{prelude:false}));
  const zero=r.call('main',[0,-0]);assert(Object.is(zero.native,-0));assert(Object.is(zero.conditional,0));
  const nan=r.call('main',[NaN,1]);assert(Number.isNaN(nan.native));assert.equal(nan.conditional,1);
});

test('core-only CLI works with explicit source and rejects an absent prelude or duplicate flag',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'asslang-core-'));
  try {
    const path=join(temp,'demo.ass');await writeFile(path,'export fn main = (xs:[Num]) -> sum xs;');
    const args=['src/cli.mjs',path,'--no-prelude'];
    const missing=run([...args,'--check','--diagnostics=json']);assert.equal(missing.status,1);assert.equal(JSON.parse(missing.stdout).diagnostics[0].code,'E_NAME');
    const linked=run([...args,'--lib','lib/prelude.ass','--run','main','--args','[[1,2,3]]']);assert.equal(linked.status,0,linked.stderr);assert.equal(linked.stdout.trim(),'6');
    const duplicated=run([...args,'--no-prelude','--check','--diagnostics=json']);assert.equal(duplicated.status,1);assert.equal(JSON.parse(duplicated.stdout).diagnostics[0].code,'E_OPTIONS');
    const ordered=run(['src/cli.mjs',path,'--lib','lib/prelude.ass','--check','--diagnostics=json']);assert.equal(ordered.status,1);assert.equal(JSON.parse(ordered.stdout).diagnostics[0].code,'E_NAME');
  } finally {await rm(temp,{recursive:true,force:true});}
});

test('source basis executes with exact output/work limits and independently checked derivatives',async()=>{
  for(const options of modes){
    const c=compile(sourceBasis,{...options,maxLoopIterations:10}),r=await createRuntime(c);
    const args=[[1,2,3,4,5,6,7],3,{x:3,y:4}];
    assert.deepEqual(plain(r.call('source_basis',args,{outputBytes:24})),{blocks:[14,77,49],gradient:{x:6,y:8},along_x:6,weighted:{x:8,y:2}});
    assert.throws(()=>r.call('source_basis',args,{outputBytes:23}),WebAssembly.RuntimeError);
    assert.equal(c.stats.functions[0].loops,2);assert.equal(c.stats.intermediateBufferBytes,0);
    const small=await createRuntime(compile(sourceBasis,{...options,maxLoopIterations:9}));assert.throws(()=>small.call('source_basis',args),WebAssembly.RuntimeError);
  }
  const result=run(['examples/interop/core-prelude.mjs']);assert.equal(result.status,0,result.stderr);assert(JSON.parse(result.stdout).sameWasmBytes);
});

test('browser core checks also execute independently of the browser driver',async()=>{
  const report={checks:0,cases:[]};await runCorePreludeBrowserChecks({compile,compileSources,check,createCompiler},createRuntime,report);
  assert.equal(report.checks,47);assert.equal(report.cases.length,1);
});
