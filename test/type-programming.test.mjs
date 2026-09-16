import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { compile, compileSources, check, checkSources, createCompiler, instantiate, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime, createCapability, Arena, prepareCall } from '../src/abi.mjs';
import { parse, infer, primitiveArities } from '../src/frontend.mjs';
import { productArities, PRODUCT_LIMITS, stageProduct } from '../src/products.mjs';
import { reference } from './reference.mjs';

const modes = [false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const root = new URL('../',import.meta.url);
const library = {name:'products.ass',source:await readFile(new URL('../lib/products.ass',import.meta.url),'utf8')};
const poly = {name:'polynomials.ass',source:await readFile(new URL('../lib/polynomials.ass',import.meta.url),'utf8')};
const files = source => [library,{name:'client.ass',source}];
const main = expression => `export fn main = () -> ${expression};`;
const normalize = value => ArrayBuffer.isView(value) ? [...value] : value;
const rejects = (source,code='E_TYPE') => assert.throws(()=>compile(source),e=>e.code===code);
const numeric = {mass:4,position:{x:2,y:3}};

const cases = [
  ['scalar',main('product_map 3 (x -> x*2)'),[{}],6],
  ['nested mapping',main('product_map {b:{x:2,y:3},a:1} (x -> x*x)'),[{}],{a:1,b:{x:4,y:9}}],
  ['exact zip',main('product_zip {a:1,b:(2,3)} {b:(5,7),a:4} (x -> y -> x+2*y)'),[{}],{a:9,b:{_0:12,_1:17}}],
  ['empty mapping',main('product_map {a:{},b:()} (x -> x+1)'),[{}],{a:{},b:{}}],
  ['empty fold',main('product_fold {a:{},b:{}} 13 (+)'),[{}],13],
  ['boolean accumulator',main('product_fold (1,2,3) true (ok -> x -> ok && x>0)'),[{}],true],
  ['record accumulator',main('product_fold (1,2,3) {n:0,s:0} (a -> x -> {n:a.n+1,s:a.s+x})'),[{}],{n:3,s:6}],
  ['function accumulator',main('do {let f=product_fold (2,3,4) (x -> x) (f -> gain -> x -> gain*(f x)+1);f 1}'),[{}],41],
  ['stream accumulator',main('product_fold (2,3,1) (range 0) (out -> n -> concat out (range n)) |> scan 0 (+)'),[{}],[0,1,1,2,4,4]],
];
for (const [name,source,args,expected] of cases) test(`numeric products: ${name}`,async()=>{
  for (const options of modes) {
    const c=compile(source,options);
    assert(verifyCertificate(c.certificate.steps));
    assert.deepEqual(normalize((await createRuntime(c)).call('main',args)),expected);
    assert.deepEqual(reference(source,'main',args),expected);
    assert.equal(c.stats.intermediateBufferBytes,0);
  }
});

test('field order is canonical and positional products follow numeric positions past nine',async()=>{
  for (const options of modes) {
    const source=main('product_fold {z:3,a:{q:2,b:1}} 0 (s -> x -> 10*s+x)');
    assert.equal((await createRuntime(compile(source,options))).call('main',[{}]),123);
    assert.deepEqual(compile(source,options).bytes,compile(source.replace('{z:3,a:{q:2,b:1}}','{a:{b:1,q:2},z:3}'),options).bytes);
    // Only positions 9 and 10 differ; alphabetical ordering would yield 21.
    const tuple=Array(9).fill('0').concat(['1','2','0']).join(',');
    const c=compile(main(`product_fold (${tuple}) 0 (s -> x -> 10*s+x)`),options);
    assert.equal((await createRuntime(c)).call('main',[{}]),120);
    const structural=Array.from({length:12},(_,i)=>`_${11-i}:${11-i===9?1:11-i===10?2:0}`).join(',');
    assert.deepEqual(c.bytes,compile(main(`product_fold {${structural}} 0 (s -> x -> 10*s+x)`),options).bytes);
  }
});

test('generic shape constraints survive aliases, helper construction, open tails and unused callers',()=>{
  const bad=[
    'fn use = p -> product_fold p 0 (s -> x -> s);fn unused = () -> use {a:true};',
    'fn use = a -> b -> product_fold {a,b} 0 (s -> x -> s);fn unused = () -> use 1 true;',
    'fn use = a -> product_fold {a} 0 (s -> x -> s);fn unused = () -> use {b:true};',
    'fn use = p -> do {let z=p.z;product_fold p 0 (s -> x -> s)};fn unused = () -> use {z:0,extra:true};',
    'fn use = p -> do {let {fold}={fold:product_fold};fold p 0 (s -> x -> s)};fn unused = () -> use (range 1);',
    'fn use = xs -> product_map xs;fn unused = () -> (use {a:1}) (x -> false);',
    'fn use = f -> product_map {a:1} f;fn unused = () -> use (x -> (x,x));',
  ];
  for (const code of bad) {
    const checked=check(code+'export fn main = () -> 7;');
    assert.equal(checked.ok,false,code);assert.equal(checked.diagnostics[0].code,'E_TYPE');
    assert.equal(checked.diagnostics[0].phase,'infer');
  }
});

test('shape polymorphism, partial application and monomorphic captures retain their boundaries',async()=>{
  const source=`fn total = p -> product_fold p 0 (+);
    fn twice = p -> product_map p (x -> 2*x);
    export fn main = () -> do {
      let {total:reduce,twice:scale}={total,twice};
      let add_to=product_zip {a:1};
      {scalar:reduce 3,nested:reduce {a:1,b:{x:2}},scaled:scale (2,3),added:add_to {a:4} (+)}
    };`;
  assert.deepEqual((await createRuntime(compile(source))).call('main',[{}]),
    {scalar:3,nested:3,scaled:{_0:4,_1:6},added:{a:5}});
  rejects('fn bad = f -> do {let a=f 3;let b=product_map (f true) (x -> x);a};export fn main = () -> 1;');
  const p=parse('export fn main = (p:{x:Num}) -> product_map p (x -> x+1);');
  const before=structuredClone(p);infer(p);assert.deepEqual(p,before);
  assert.equal(check('export fn main = p -> product_fold p 0 (+);').diagnostics[0].code,'E_ABI');
  assert.equal(check('export fn main = p -> product_map p (x -> x);').diagnostics[0].code,'E_ABI');
  rejects(main('product_fold (1,2) (x -> x) (f -> n -> x -> f x+n)'),'E_ABI');
});

test('wrong leaves and exact shape mismatches fail before staging even when results are unused',()=>{
  for (const product of ['true','range 2','x -> x','{a:1,b:true}','{a:{b:() -> 2}}'])
    rejects(`fn bad = () -> product_fold (${product}) 0 (s -> x -> s);export fn main = () -> 1;`);
  for (const [a,b] of [['{a:1}','{b:2}'],['{a:1}','{a:2,b:3}'],['(1,2)','(3,)'],['1','{a:1}'],['{a:{x:1}}','{a:{y:1}}']])
    rejects(main(`do {let unused=product_zip ${a} ${b} (+);7}`));
  rejects('symbol secret;fn unused = () -> product_map {[secret]:1} (x -> x);export fn main = () -> 7;');
  rejects(main('product_map {} (x -> false)'));
  rejects(main('product_fold () 1 (s -> x -> true)'));
});

test('empty shapes and ignored witness data retain ordinary lazy runtime demand',async()=>{
  const variants=[
    [main('product_map {a:require false 1} (ignored -> 7)'),{a:7}],
    [main('product_zip {a:require false 1} {a:9} (ignored -> value -> value)'),{a:9}],
    [main('product_fold {a:require false 1} 7 (s -> ignored -> s)'),7],
    [main('product_map {} (x -> require false x)'),{}],
    [main('product_fold () 7 (s -> x -> require false s)'),7],
    [main('product_map {a:require false 1} (x -> x)'),null],
    [main('(product_map {a:3,b:require false 1} (x -> x+1)).a'),4],
    [main('product_fold (require false 1,2) 0 (previous -> current -> current)'),2],
    [main('if false then product_fold {a:require false 1} 0 (+) else 9'),9],
  ];
  for (const options of modes) for (const [source,expected] of variants) {
    const r=await createRuntime(compile(source,options));
    if (expected===null) assert.throws(()=>r.call('main',[{}]),WebAssembly.RuntimeError);
    else assert.deepEqual(r.call('main',[{}]),expected);
  }
});

test('shape-derived algebras reuse Horner source with no runtime reflection or arrays',async()=>{
  const source='export fn main = (coefficients:[Num]) -> (p:{mass:Num,position:{x:Num,y:Num}}) -> polynomial_with (numeric_algebra p) coefficients p;';
  const args=[[2,3,5],numeric],expected={mass:49,position:{x:19,y:32}};
  for (const options of modes) {
    const c=compileSources([library,poly,{name:'app.ass',source}],{...options,maxLoopIterations:3});
    assert.equal(c.stats.functions[0].loops,1);assert.equal(c.abi.version,1);
    assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)).map(i=>i.kind),['memory']);
    const r=await createRuntime(c);assert.deepEqual(r.call('main',args,{outputBytes:0}),expected);
    assert.deepEqual(r.call('main',[[],numeric]),{mass:0,position:{x:0,y:0}});
    const small=await createRuntime(compileSources([library,poly,{name:'app.ass',source}],{...options,maxLoopIterations:2}));
    assert.throws(()=>small.call('main',args),WebAssembly.RuntimeError);
    assert.deepEqual(small.call('main',[[5],numeric]),{mass:5,position:{x:5,y:5}});
    const renamed=[{name:'library.ass',source:library.source.replaceAll('numeric_algebra','user_algebra')},poly,
      {name:'app.ass',source:source.replace('numeric_algebra','user_algebra')}];
    assert.deepEqual(c.bytes,compileSources(renamed,{...options,maxLoopIterations:3}).bytes);
  }
});

test('unrolled arithmetic differentiates through existing forward and reverse graph transforms',async()=>{
  const source=`export fn main = (p:{a:Num,b:{x:Num,y:Num}}) -> do {
    let objective = p -> product_dot p p;
    let direction = product_map p (ignored -> 1);
    let pushed = jvp (p -> product_map p (x -> x*x)) p direction;
    let pulled = vjp (p -> product_map p (x -> x*x)) p direction;
    {gradient:grad objective p,pushed:pushed.tangent,pulled:pulled.cotangent}
  };`;
  for (const options of modes) {
    const c=compileSources(files(source),options),r=await createRuntime(c);
    for (const x of [-3,0,2]) {
      const point={a:x,b:{x:x+1,y:x+2}},derivative={a:2*x,b:{x:2*(x+1),y:2*(x+2)}};
      assert.deepEqual(r.call('main',[point]),{gradient:derivative,pushed:derivative,pulled:derivative});
    }
    assert.equal(c.stats.functions[0].loops,0);
  }
  rejects('export fn main = (n:Num) -> grad (x -> product_fold {n:x} 0 (s -> v -> s+sum (range v))) n;','E_DIFF_UNSUPPORTED');
});

test('source operators specialize product callbacks without leaking their bindings',async()=>{
  const source=`export fn main = () -> do {
    let primitive_add=(+);
    infixl (+) = x -> y -> x-y;
    {local:product_zip (7,9) (2,3) (+),original:product_zip (7,9) (2,3) primitive_add}
  };`;
  assert.deepEqual((await createRuntime(compile(source))).call('main',[{}]),
    {local:{_0:5,_1:6},original:{_0:9,_1:12}});
});

test('shape folds construct array plans without forged alignment or new scratch lifetime',async()=>{
  const source=`export fn main = (n:{a:Num,b:{c:Num,d:Num}}) ->
    product_fold n (range 0) (out -> size -> concat out (range size)) |> scan 0 (+);`;
  for (const options of modes) {
    const c=compile(source,{...options,maxLoopIterations:6}),r=await createRuntime(c);
    assert.equal(c.stats.functions[0].loops,1);assert.equal(c.stats.intermediateBufferBytes,0);
    assert.deepEqual([...r.call('main',[{a:2,b:{c:3,d:1}}],{outputBytes:48})],[0,1,1,2,4,4]);
    assert.throws(()=>r.call('main',[{a:2,b:{c:3,d:1}}],{outputBytes:47}),WebAssembly.RuntimeError);
    assert.throws(()=>r.call('main',[{a:2,b:{c:-1,d:1}}]),WebAssembly.RuntimeError);
    assert.deepEqual([...r.call('main',[{a:0,b:{c:0,d:0}}],{outputBytes:0})],[]);
    const small=await createRuntime(compile(source,{...options,maxLoopIterations:5}));
    assert.throws(()=>small.call('main',[{a:2,b:{c:3,d:1}}]),WebAssembly.RuntimeError);
  }
  const noAlignment=`export fn main = (xs:[Num]) -> do {
    let rebuilt=product_fold {length:count xs} (range 0) (out -> n -> concat out (range n));
    zip xs rebuilt (+)
  };`;
  rejects(noAlignment,'E_DOMAIN');
  rejects('export fn main = (xs:[Num]) -> map xs (x -> product_fold {a:x} 0 (s -> n -> count (sort_by xs (x -> x))));','E_ORDER_SCOPE');
});

test('products inside block scans retain state resets, original event alignment and exact work',async()=>{
  const source=`export fn main = (xs:[Num]) -> (width:Num) -> do {
    let history = xs |> chunks width |> map (b ->
      scan b {sum:0,squares:0} (s -> x -> product_zip s {sum:x,squares:x*x} (+))) |> flatten;
    zip xs history (x -> state -> state.sum+x)
  };`;
  for (const options of modes) {
    const c=compile(source,{...options,maxLoopIterations:5}),r=await createRuntime(c);
    assert.deepEqual([...r.call('main',[[1,2,3,4,5],2])],[2,5,6,11,10]);
    assert.equal(c.stats.functions[0].runtimeZipChecks,0);assert.equal(c.stats.functions[0].loops,1);
    assert.deepEqual([...r.call('main',[[],2])],[]);
    assert.throws(()=>r.call('main',[[1,2,3,4,5,6],2]),WebAssembly.RuntimeError);
  }
});

test('step function code construction retains lexical captures and old program stage order',async()=>{
  const source=`export fn main = (gains:{a:Num,b:{c:Num,d:Num}}) -> (x:Num) -> do {
    let transform=product_fold gains (x -> x) (previous -> gain -> x -> gain*(previous x)+1);
    {first:transform x,second:transform (x+1)}
  };`;
  for (const options of modes) {
    const c=compile(source,{...options,maxLoopIterations:0});
    assert.equal(c.stats.functions[0].loops,0);
    const r=await createRuntime(c);
    assert.deepEqual(r.call('main',[{a:2,b:{c:3,d:4}},1]),{first:41,second:65});
    assert.deepEqual(r.call('main',[{a:1,b:{c:1,d:1}},1]),{first:4,second:5});
  }
});

test('structural elaboration has explicit leaf, depth and empty-node limits',async()=>{
  assert(Object.isFrozen(PRODUCT_LIMITS));assert.deepEqual(PRODUCT_LIMITS,{leaves:128,depth:16,nodes:4096});
  const wide=n=>main(`product_fold (${Array(n).fill('1').join(',')}) 0 (+)`);
  assert.equal((await createRuntime(compile(wide(128)))).call('main',[{}]),128);
  rejects(wide(129),'E_LIMIT');
  const deep=n=>main(`product_fold ${'{a:'.repeat(n)}1${'}'.repeat(n)} 0 (+)`);
  assert.equal((await createRuntime(compile(deep(16)))).call('main',[{}]),1);
  rejects(deep(17),'E_LIMIT');
  const empty=n=>main(`product_fold {${Array.from({length:n},(_,i)=>`f${i}:{}`).join(',')}} 7 (s -> x -> s)`);
  assert.equal((await createRuntime(compile(empty(4095)))).call('main',[{}]),7);
  rejects(empty(4096),'E_LIMIT');
  assert.throws(()=>compile(wide(16),{maxExpansion:10}),e=>e.code==='E_LIMIT');
});

test('stage rechecks aggregate helper limits and exact paths before invoking callbacks',()=>{
  const scalar=n=>({kind:'scalar',type:'Num',id:n});
  const record=fields=>({kind:'record',fields:new Map(fields)});
  let calls=0;const api={invoke(){calls++;return scalar(1)},fail(message,node,code){throw Object.assign(new Error(message),{code})}};
  assert.throws(()=>stageProduct('product_zip',[record([['a',scalar(0)]]),record([['b',scalar(0)]]),{}],api,{pos:0}),e=>e.code==='E_TYPE');
  assert.equal(calls,0);
  const two=n=>`{${Array.from({length:n},(_,i)=>`f${i}:1`).join(',')}}`;
  const source=`fn collect = x -> y -> product_fold {x,y} 0 (+);export fn main = () -> collect ${two(65)} ${two(65)};`;
  rejects(source,'E_LIMIT');
});

test('nonfinite values and signed zeros use the selected operations, not implicit validation',async()=>{
  const source='export fn main = (p:{a:Num,b:Num}) -> product_map p (x -> x);';
  const c=compile(source,{maxLoopIterations:0}),r=await createRuntime(c);
  const result=r.call('main',[{a:-0,b:NaN}]);assert(Object.is(result.a,-0));assert(Number.isNaN(result.b));
  assert.deepEqual(r.call('main',[{a:Infinity,b:-Infinity}]),{a:Infinity,b:-Infinity});
  const s=await createRuntime(compile('export fn main = (p:(Num,Num,Num,Num)) -> product_fold p 0 (+);'));
  assert.equal(s.call('main',[{_0:1e16,_1:1,_2:-1e16,_3:1}]),1);
});

test('record identity uses normal raw ABI storage and preserves payload bits and canaries',async()=>{
  const c=compile('export fn main = (p:{a:Num,b:Num}) -> product_map p (x -> x);',{maxLoopIterations:0});
  const memory=new WebAssembly.Memory({initial:1,maximum:1});new Uint8Array(memory.buffer).fill(0xa5);
  const frame=prepareCall(new Arena(memory),c.abi.exports[0],[{a:-0,b:NaN}],{outputBytes:0});
  const i=await instantiate(c,{memory});const end=i.exports.main(...frame.slots);const result=frame.lift(end);
  assert(Object.is(result.a,-0));assert(Number.isNaN(result.b));
  assert(new Uint8Array(memory.buffer,end,16).every(v=>v===0xa5));
});

test('compiler caches and prepared calls retain snapshots, fresh data and result ownership',async()=>{
  const source='export fn main = (p:{a:Num,b:Num}) -> (scale:Num) -> product_map p (x -> scale*x);';
  const compiler=createCompiler();compiler.compile(source).bytes.fill(0);
  const c=compiler.compile(source);assert(c.cache.hit);
  const r=await createRuntime(c),point={a:2,b:3},lease=r.prepare('main',[point,2]);
  try {point.a=99;assert.deepEqual(lease.run(),{a:4,b:6});assert.deepEqual(lease.run({scale:3}),{a:6,b:9});
    const out=lease.run();assert.equal(Object.getOwnPropertyDescriptor(out,'a').writable,false);assert.throws(()=>out.a=0,TypeError);assert.deepEqual(lease.run(),{a:4,b:6});}
  finally {lease.dispose()}
  assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
});

test('source locations, effect authority and reserved primitive names remain explicit',async()=>{
  const lib='fn total = value -> product_fold value 0 (s -> x -> s);';
  const client='fn unused = () -> total {a:false};export fn main = () -> 7;';
  const d=checkSources([{name:'library.ass',source:lib},{name:'client.ass',source:client}]).diagnostics[0];
  assert.equal(d.code,'E_TYPE');assert.equal(d.sourceName,'client.ass');assert(d.range.start.offset>=client.indexOf('total'));
  const missing=main('product_map {a:missing} (x -> x)');
  const m=checkSources([{name:'missing.ass',source:missing}]).diagnostics[0];
  assert.equal(m.code,'E_NAME');assert.equal(m.sourceName,'missing.ass');assert.equal(m.range.start.offset,missing.indexOf('missing'));
  rejects('host fn read:Num -> Num;export fn main = () -> product_map {a:1} read;','E_EFFECT');
  const effect='host fn read:Num -> Num;export fn main = () -> effect {let x=perform read 3;product_map {a:x,b:x} (x -> x+1)};';
  const r=await createRuntime(compile(effect,{maxLoopIterations:0})),seen=[];
  assert.throws(()=>r.call('main',[{}]),e=>e.code==='E_CAPABILITY');
  const cap=createCapability({read:{parameters:['Num'],result:'Num',call:x=>(seen.push(x),x)}},{maxCalls:1});
  assert.deepEqual(r.call('main',[{}],{capability:cap}),{a:4,b:4});assert.deepEqual(seen,[3]);assert.equal(cap.remaining,0);
  for (const name of Object.keys(productArities)) {
    assert.equal(primitiveArities[name],productArities[name]);rejects(`fn ${name} = x -> x;export fn main = () -> 7;`,'E_NAME');
  }
});

test('seeded nested products match independent pathwise and left-fold oracles',async t=>{
  const source=`export fn main = (a:{p:Num,q:{x:Num,y:Num}}) -> (b:{p:Num,q:{x:Num,y:Num}}) -> {
    mapped:product_map a (x -> x*x+1),
    zipped:product_zip a b (x -> y -> 2*x-y),
    folded:product_fold a 0 (s -> x -> 3*s+x)
  };`;
  let seed=3479,cases=0;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%17-8};
  for (const options of modes) {
    const r=await createRuntime(compile(source,options));
    for(let i=0;i<60;i++){
      const av=[next(),next(),next()],bv=[next(),next(),next()];
      const make=v=>({p:v[0],q:{x:v[1],y:v[2]}}),a=make(av),b=make(bv);
      const expected={mapped:make(av.map(x=>x*x+1)),zipped:make(av.map((x,i)=>2*x-bv[i])),folded:av.reduce((s,x)=>3*s+x,0)};
      assert.deepEqual(r.call('main',[a,b]),expected);cases++;
    }
  }
  t.diagnostic(JSON.stringify({seededProducts:cases}));
});

test('derived and explicit field programs have identical bytecode in every lowering mode',()=>{
  const source='export fn main = (a:{x:Num,y:{z:Num}}) -> (b:{x:Num,y:{z:Num}}) -> product_zip a b (x -> y -> x+2*y);';
  const explicit=source.replace('product_zip a b (x -> y -> x+2*y)','{x:a.x+2*b.x,y:{z:a.y.z+2*b.y.z}}');
  for (const options of modes) {
    const c=compile(source,options),e=compile(explicit,options);
    assert.deepEqual(c.bytes,e.bytes);assert.deepEqual(c.abi,e.abi);assert.deepEqual(c.certificate,e.certificate);
  }
});

test('documentation, example driver and public CLI execute the registered source',async()=>{
  const run=(args,input)=>spawnSync(process.execPath,args,{cwd:root,input,encoding:'utf8',timeout:20000});
  const r=run(['examples/interop/type-programming.mjs']);assert.equal(r.status,0,r.stderr);
  const reports=JSON.parse(r.stdout).reports;assert.deepEqual(reports.map(r=>r.loopUnits),[3,0,6]);
  for (const [name,args,expected] of [['shape-polynomial',[[2,3,5],numeric],{mass:49,position:{x:19,y:32}}],
    ['shape-stages',[{a:2,b:{c:3,d:4}},1],41],['shape-ranges',[{a:2,b:{c:3,d:1}}],[0,1,1,2,4,4]]]) {
    const c=run(['examples/case-studies/app.mjs',name],JSON.stringify(args));assert.equal(c.status,0,c.stderr);assert.deepEqual(JSON.parse(c.stdout),expected);
  }
  const doc=await readFile(new URL('../docs/TYPE-PROGRAMMING.md',import.meta.url),'utf8');
  const snippets=[...doc.matchAll(/<!-- product-example: (\w+) -->\n```ass\n([\s\S]*?)\n```/g)];
  assert.equal(snippets.length,3);
  for (const [,name,source] of snippets) assert.equal(source+'\n',await readFile(new URL(`../examples/case-studies/products/${name}.ass`,import.meta.url),'utf8'));
});


test('browser product checks also run as a Node regression',async()=>{
  const {runTypeProgrammingBrowserChecks}=await import('./type-programming-browser.mjs');
  const report={checks:0,cases:[]};await runTypeProgrammingBrowserChecks({compile,check},createRuntime,report);
  assert.equal(report.checks,64);assert.equal(report.cases.length,1);
});
