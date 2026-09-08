import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile,compileSources,check,checkSources,createCompiler,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime,createCapability} from '../src/abi.mjs';

const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const run=async(source,args,options={})=>(await createRuntime(compile(source,options))).call('main',args);
const plain=v=>ArrayBuffer.isView(v)?Array.from(v):v&&typeof v==='object'
  ?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
const flatten=v=>typeof v==='number'?[v]:Object.keys(v).sort().flatMap(k=>flatten(v[k]));
const response=p=>({energy:p.x*p.x*p.x+3*p.x*p.y,balance:p.x-2*p.y,
  nested:{_0:p.y*p.y,_1:p.x*p.y}});
const derivative=(p,v)=>({energy:(3*p.x*p.x+3*p.y)*v.x+3*p.x*v.y,
  balance:v.x-2*v.y,nested:{_0:2*p.y*v.y,_1:v.x*p.y+p.x*v.y}});
const productSource=`fn response = p -> {energy:p.x*p.x*p.x+3*p.x*p.y,
  balance:p.x-2*p.y,nested:(p.y*p.y,p.x*p.y)};
  export fn main = (p:{x:Num,y:Num}) -> (v:{x:Num,y:Num}) -> (w:{x:Num,y:Num}) -> do {
    let local=linearize response p;
    {value:local.value,first:local.pushforward v,second:local.pushforward w,
     basis:local.pushforward {x:1,y:0}}
  };`;

for(const options of modes)test(`reusable product linearization analytic and finite differences ${JSON.stringify(options)}`,async()=>{
  const compiled=compile(productSource,options),runtime=await createRuntime(compiled);
  assert.equal(compiled.stats.kernelHeapAllocationSites,0);
  assert.equal(compiled.stats.intermediateBufferBytes,0);
  assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(compiled.bytes))
    .some(i=>i.kind==='table'||i.kind==='function'),false);
  let seed=197;
  const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<100;i++) {
    const p={y:random()%19-9,x:random()%21-10},v={x:random()%9-4,y:random()%7-3},w={x:i%7-3,y:i%5-2};
    const result=runtime.call('main',[p,v,w]);
    assert.deepEqual(result.value,response(p));
    for(const [field,direction] of [['first',v],['second',w],['basis',{x:1,y:0}]]) {
      const actual=flatten(result[field]),analytic=flatten(derivative(p,direction));
      const h=1e-4,plus=flatten(response({x:p.x+h*direction.x,y:p.y+h*direction.y})),
        minus=flatten(response({x:p.x-h*direction.x,y:p.y-h*direction.y}));
      actual.forEach((x,j)=>{
        // Analytic factoring does not preserve every IEEE zero sign.
        assert.ok(x===analytic[j],`${field}, case ${i}, component ${j}`);
        assert.ok(Math.abs(x-(plus[j]-minus[j])/(2*h))<1e-4);
      });
    }
  }
});

test('preparation stages the objective once, not once per pushforward application',async()=>{
  // A dead range leaves an observation step every time the objective is staged,
  // but performs no runtime work. It is an independent preparation-count witness.
  const prelude='fn objective = x -> do {let witness=range 1; x*x};';
  const shared=compile(prelude+`export fn main = (x:Num) -> do {
    let local=linearize objective x;
    local.pushforward 1+local.pushforward 2+local.pushforward 3
  };`);
  const repeated=compile(prelude+`export fn main = (x:Num) ->
    (jvp objective x 1).tangent+(jvp objective x 2).tangent+(jvp objective x 3).tangent;`);
  assert.equal(shared.certificate.steps.filter(s=>s.rule==='source').length,1);
  assert.equal(repeated.certificate.steps.filter(s=>s.rule==='source').length,3);
  assert.equal(verifyCertificate(shared.certificate.steps),true);
  assert.equal((await createRuntime(shared)).call('main',[3]),36);
  assert.equal((await createRuntime(repeated)).call('main',[3]),36);
});

test('nested tuples, aliased coordinates and empty product fields retain their shapes',async()=>{
  const source=`export fn main = (x:Num) -> do {
    let local=linearize (p -> {mixed:p.z*p.a._0,square:p.a._1.inner*p.a._1.inner,empty:()})
      {z:x,a:(x,{inner:x,empty:()})};
    {value:local.value,left:local.pushforward {z:1,a:(0,{inner:0,empty:()})},
     right:local.pushforward {z:0,a:(1,{inner:2,empty:()})}}
  };`;
  for(const options of modes)assert.deepEqual(await run(source,[3],options),{
    value:{mixed:9,square:9,empty:{}},left:{mixed:3,square:0,empty:{}},right:{mixed:3,square:12,empty:{}},
  });
});

test('tuple directions use lexical field ordering consistently past index nine',async()=>{
  const tuple=Array.from({length:12},(_,i)=>i+1).join(',');
  const seed=Array.from({length:12},(_,i)=>i===2?2:i===10?3:0).join(',');
  assert.equal(await run(`export fn main = () -> do {
    let local=linearize (p -> p._2*p._10) (${tuple}); local.pushforward (${seed})
  };`,[{}]),31);
});

test('empty products and legacy zero-argument application follow JVP unit rules',async()=>{
  for(const options of modes) {
    assert.equal(await run('export fn main = () -> (linearize (u -> 7) ()).pushforward ();',[{}],options),0);
    assert.deepEqual(await run('export fn main = (x:Num) -> (linearize (y -> ()) x).pushforward 1;',[3],options),{});
    assert.equal(await run('fn constant()=7; export fn main()={let l=linearize(constant,{}); l.pushforward()};',[],options),0);
  }
});

test('partial intrinsics, returned pushforwards and polymorphic helpers compose',async()=>{
  const source=`fn prepare = f -> linearize f;
    fn derivative = f -> x -> (prepare f x).pushforward;
    fn twice = f -> x -> f (f x);
    export fn main = (x:Num) -> do {
      let scalar=derivative (y -> y*y) x;
      let product=derivative (p -> {left:p.a*p.b,right:p.a+p.b}) {a:x,b:x};
      {repeated:twice scalar 1,product:product {a:1,b:2}}
    };`;
  for(const options of modes)assert.deepEqual(await run(source,[3],options),{
    repeated:36,product:{left:9,right:3},
  });
});

test('prepared callables and complete linearization records support finite choices',async()=>{
  const source=`export fn main = (flag:Bool) -> (x:Num) -> do {
    let a=linearize (y -> y*y) x;
    let b=linearize (y -> 3*y) x;
    let selected=if flag then a else b;
    let mixed=if flag then a.pushforward else (v -> 5*v);
    {value:selected.value,tangent:selected.pushforward 2,mixed:mixed 2}
  };`;
  for(const options of modes)for(const flag of [false,true])
    assert.deepEqual(await run(source,[flag,4],options),{
      value:flag?16:12,tangent:flag?16:6,mixed:flag?16:10,
    });
});

for(const options of modes)test(`nested AD and direction sensitivity ${JSON.stringify(options)}`,async()=>{
  const programs=[
    ['grad (y -> (linearize (z -> z*z*z) y).pushforward 2) x',36],
    ['(linearize (grad (y -> y*y*y)) x).pushforward 2',36],
    ['(linearize (y -> (linearize (z -> y*z) y).pushforward 1) x).pushforward 1',1],
    ['(linearize (y -> (jvp (z -> z*z) y 2).tangent) x).pushforward 3',12],
    ['(jvp (y -> (linearize (z -> z*z) y).pushforward 2) x 3).tangent',12],
    ['grad (grad (y -> (linearize (z -> z*z*z*z) y).pushforward 1)) x',72],
    ['do {let local=linearize (y -> y*y) x; grad local.pushforward x}',6],
    ['do {let local=linearize (y -> y*y) x; grad (grad local.pushforward) x}',0],
    ['grad (y -> (linearize (z -> y*z) x).pushforward y) x',6],
    ['(linearize (y -> x*y) x).pushforward 2',6],
    ['grad (y -> (linearize (z -> z*stop_gradient z) y).pushforward 1) x',0],
  ];
  for(const [expression,expected] of programs)
    assert.equal(await run(`export fn main = (x:Num) -> ${expression};`,[3],options),expected,expression);
});

test('a prepared gradient supplies reusable analytic Hessian-vector products',async()=>{
  const source=`export fn main = (p:{x:Num,y:Num}) -> (v:{x:Num,y:Num}) -> (w:{x:Num,y:Num}) -> do {
    let local=linearize (grad (q -> q.x*q.x*q.x+q.x*q.y+2*q.y*q.y)) p;
    {gradient:local.value,first:local.pushforward v,second:local.pushforward w}
  };`;
  for(const options of modes) {
    const runtime=await createRuntime(compile(source,options));
    for(let i=0;i<100;i++) {
      const p={x:i%9-4,y:i%7-3},v={x:i%5-2,y:i%11-5},w={x:i%3-1,y:i%7-3};
      const actual=runtime.call('main',[p,v,w]);
      assert.ok(actual.gradient.x===3*p.x*p.x+p.y);
      assert.ok(actual.gradient.y===p.x+4*p.y);
      for(const [key,d] of [['first',v],['second',w]]) {
        assert.ok(actual[key].x===6*p.x*d.x+d.y);
        assert.ok(actual[key].y===d.x+4*d.y);
      }
    }
  }
});

test('one saved pushforward is usable as a stream callback without changing observations',async()=>{
  const source=`export fn main = (xs:[Num]) -> (x:Num) -> do {
    let local=linearize (y -> y*y) x;
    map xs local.pushforward
  };`;
  for(const options of modes) {
    const c=compile(source,options);
    assert.equal(c.observations.main.access,'indexed');
    assert.equal(c.observations.main.dense,true);
    assert.equal(verifyCertificate(c.certificate.steps),true);
    const runtime=await createRuntime(c);
    assert.deepEqual(Array.from(runtime.call('main',[[1,2,3],4])),[8,16,24]);
    assert.deepEqual(Array.from(runtime.call('main',[[],4])),[]);
  }
});

test('captures in causal transitions and nested traversals keep lexical identities',async()=>{
  const causal=`export fn main = (xs:[Num]) -> scan xs 0 (s -> x -> do {
    let local=linearize (y -> s*y+y*y) x; local.pushforward 1
  });`;
  const nested=`export fn main = (xs:[Num]) -> map xs (x -> do {
    let local=linearize (y -> x*y+y*y) x;
    sum (map xs local.pushforward)
  });`;
  for(const options of modes) {
    assert.deepEqual(Array.from(await run(causal,[[1,2,3]],options)),[2,6,12]);
    assert.deepEqual(Array.from(await run(nested,[[1,2,3]],options)),[18,36,54]);
  }
});

test('primal guards survive zero tangents and guarded returned callables',async()=>{
  const expressions=[
    '(linearize (x -> require false 7) 2).pushforward 0',
    '(linearize (x -> floor (require false x)) 2).pushforward 1',
    '(linearize (x -> stop_gradient (require false x)) 2).pushforward 1',
    '(linearize (require false (x -> x*x)) 2).pushforward 1',
    '(require false (linearize (x -> x*x) 2).pushforward) 1',
    '(require false (linearize (x -> x*x) 2)).pushforward 1',
  ];
  for(const options of modes)for(const expression of expressions)
    await assert.rejects(()=>run(`export fn main = () -> ${expression};`,[{}],options),WebAssembly.RuntimeError);
});

test('unused bindings, independent fields, ignored seeds and inactive branches stay lazy',async()=>{
  const programs=[
    ['do {let local=linearize (x -> require false x) 2; 7}',7],
    ['(linearize (x -> {safe:x*x,bad:require false x}) 3).pushforward 1',null],
    ['((linearize (x -> {safe:x*x,bad:require false x}) 3).pushforward 1).safe',6],
    ['(linearize (p -> p.x*p.x) {x:3,bad:require false 4}).pushforward {x:1,bad:require false 1}',6],
    ['(linearize (x -> 7) (require false 2)).value',7],
    ['(linearize (x -> 7) 2).pushforward (require false 1)',0],
    ['(linearize (x -> if x>0 then x*x else require false x) 3).pushforward 1',6],
    ['do {let d=require false (linearize (x -> x*x) 3).pushforward; 7}',7],
    ['do {let a=linearize (x -> x*x) 3; let b=linearize (x -> require false x) 3; (if true then a.pushforward else b.pushforward) 1}',6],
  ];
  for(const options of modes)for(const [expression,expected] of programs) {
    const source=`export fn main = () -> ${expression};`;
    if(expected===null)await assert.rejects(()=>run(source,[{}],options),WebAssembly.RuntimeError);
    else assert.equal(await run(source,[{}],options),expected);
  }
});

test('empty streams do not apply trapping pushforwards or initialize their causal state',async()=>{
  const expressions=[
    'do {let local=linearize (x -> require false x) 3; map xs local.pushforward}',
    'scan xs (require false 0) (s -> x -> (linearize (y -> s*y) x).pushforward 1)',
  ];
  for(const options of modes)for(const expression of expressions) {
    const source=`export fn main = (xs:[Num]) -> ${expression};`;
    assert.deepEqual(Array.from(await run(source,[[]],options)),[]);
    await assert.rejects(()=>run(source,[[1]],options),WebAssembly.RuntimeError);
  }
});

test('value-only projections do not run the derivative transform',async()=>{
  const source='export fn main = (x:Num) -> (linearize (y -> sum (map (range 3) (i -> i*y))) x).value;';
  for(const options of modes) {
    assert.equal(await run(source,[4],options),12);
    assert.equal(check(source.replace('.value','.pushforward 1'),options).diagnostics[0].code,'E_DIFF_UNSUPPORTED');
    assert.equal(check(`export fn main = (x:Num) -> do {
      let local=linearize (y -> sum (range y)) x;
      if false then local.pushforward 1 else local.value
    };`,options).diagnostics[0].code,'E_DIFF_UNSUPPORTED');
  }
});

test('independent memory loads retain bounds checks on value and tangent demand',async()=>{
  const source='export fn main = (xs:[Num]) -> (x:Num) -> (linearize (y -> (at xs 0)*y) x).pushforward 1;';
  for(const options of modes) {
    assert.equal(await run(source,[[7],3],options),7);
    await assert.rejects(()=>run(source,[[],3],options),WebAssembly.RuntimeError);
    const ignored='export fn main = (xs:[Num]) -> (linearize (y -> at xs 0) 3).pushforward 1;';
    await assert.rejects(()=>run(ignored,[[]],options),WebAssembly.RuntimeError);
  }
});

test('pathwise conventions and exceptional f64 values match explicit JVP applications',async()=>{
  const source=`fn f = x -> {identity:x,negative:-x,square:x*x,ratio:x/(x+5),
    absolute:abs x,rounded:floor x,lo:min x 2,hi:max x 2,root:sqrt (x*x+1),stopped:x*stop_gradient x};
    export fn main = (x:Num) -> (v:Num) -> do {
      let local=linearize f x;
      {value:local.value,tangent:local.pushforward v,reference:jvp f x v}
    };`;
  for(const options of modes) {
    const runtime=await createRuntime(compile(source,options));
    for(const x of [-0,0,1,-1,2,Infinity,-Infinity,NaN])for(const v of [-0,0,1,-2,Infinity,NaN]) {
      const actual=runtime.call('main',[x,v]);
      for(const key of Object.keys(actual.value)) {
        assert.ok(Object.is(actual.value[key],actual.reference.value[key]),`value ${key}`);
        assert.ok(Object.is(actual.tangent[key],actual.reference.tangent[key]),`tangent ${key}`);
      }
    }
    const at0=runtime.call('main',[0,1]),at2=runtime.call('main',[2,1]);
    assert.equal(at0.tangent.absolute,0);assert.equal(at0.tangent.rounded,0);
    assert.equal(at2.tangent.lo,1);assert.equal(at2.tangent.hi,1);
    assert.equal(at2.tangent.stopped,2);
    assert.ok(Object.is(runtime.call('main',[-0,-0]).tangent.identity,-0));
  }
});

test('performed results remain atomic across reused pushforwards and nested AD',async()=>{
  const programs=[
    ['let local=linearize (p -> p.a*p.a+p.a*p.b) {a:y,b:y};',
      '{value:local.value,a:local.pushforward {a:1,b:0},b:local.pushforward {a:0,b:1}}',{value:72,a:18,b:6}],
    ['let local=linearize (z -> z*y) x;',
      '{first:local.pushforward 1,second:local.pushforward 2,nested:grad local.pushforward x}',{first:6,second:12,nested:6}],
    ['let local=linearize (z -> z*stop_gradient y) x;',
      '{first:local.pushforward 1,second:local.pushforward 2}',{first:6,second:12}],
  ];
  for(const options of modes)for(const [binding,result,expected] of programs) {
    const source=`host fn h: Num -> Num; export fn main = (x:Num) -> effect {
      let y=perform h x; ${binding} ${result}
    };`;
    let calls=0;
    const capability=createCapability({h:{parameters:['Num'],result:'Num',call:x=>{calls++;return x*3;}}},{maxCalls:1});
    assert.deepEqual((await createRuntime(compile(source,options))).call('main',[2],{capability}),expected);
    assert.equal(calls,1);assert.equal(capability.remaining,0);
  }
});

test('numeric validation, shape errors, ABI escapes and authority failures are structured',()=>{
  const bad=[
    ['export fn main = () -> (linearize (x -> 1) true).value;','E_DIFF_TYPE'],
    ['export fn main = () -> (linearize (x -> true) 1).value;','E_DIFF_TYPE'],
    ['export fn main = () -> (linearize (x -> {a:x,b:false}) 1).value.a;','E_DIFF_TYPE'],
    ['export fn main = () -> (linearize (x -> 1) (range 3)).value;','E_LOWER'],
    ['export fn main = () -> (linearize (x -> range 3) 1).value;','E_LOWER'],
    ['export fn main = () -> (linearize (x -> x.a) {a:1}).pushforward {a:false};','E_TYPE'],
    ['export fn main = () -> (linearize (x -> x.a) {a:1}).pushforward {b:1};','E_TYPE'],
    ['export fn main = () -> (linearize (x -> x) 1).pushforward 1 2;','E_TYPE'],
    ['export fn main = (x:Num) -> linearize (y -> y*y) x;','E_ABI'],
    ['export fn main = (x:Num) -> (linearize (y -> y*y) x).pushforward;','E_ABI'],
    ['export fn main = () -> (linearize (x -> y -> x+y) 1).pushforward 2 3;','E_LOWER'],
    ['fn linearize = x -> x; export fn main = () -> linearize 1;','E_NAME'],
    ['host fn linearize: Num -> Num; export fn main = () -> 1;','E_NAME'],
    ['host fn h: Num -> Num; export fn main = (x:Num) -> (linearize h x).pushforward 1;','E_EFFECT'],
  ];
  for(const [source,code] of bad) {
    const files=[{name:'helper.ass',source:'fn id = x -> x;'},{name:'linearization.ass',source:'// fixture\n'+source}];
    const d=checkSources(files).diagnostics[0];
    assert.equal(d?.code,code,source);assert.equal(d.sourceName,'linearization.ass');
    assert.equal(d.range.start.line,2);
    assert.throws(()=>compileSources(files),e=>e.code===code&&e.sourceName===d.sourceName&&e.offset===d.range.start.offset);
  }
});

test('deferred derivative errors report the application site rather than preparation',()=>{
  const sources=[
    ['export fn main = (x:Num) -> do {\n  let local=linearize (y -> sum (range y)) x;\n  local.pushforward 1\n};','E_DIFF_UNSUPPORTED'],
    ['export fn main = (xs:[Num]) -> (x:Num) -> do {\n  let local=linearize (y -> at xs y) x;\n  local.pushforward 1\n};','E_DIFF_CONTROL'],
  ];
  for(const options of modes)for(const [source,code] of sources) {
    const d=checkSources([{name:'derivative.ass',source}],options).diagnostics[0];
    assert.equal(d.code,code);assert.equal(d.sourceName,'derivative.ass');
    assert.equal(d.range.start.line,3);assert.equal(d.range.start.offset,source.indexOf('pushforward'));
  }
});

test('reusable single directions are not subject to the gradient coordinate cap',async()=>{
  const fields=Array.from({length:65},(_,i)=>'f'+i);
  const source=`export fn main = (x:Num) -> do {
    let local=linearize (p -> p.f0*p.f64) {${fields.map(f=>f+':x').join(',')}};
    local.pushforward {${fields.map((f,i)=>f+':'+(i===0?2:i===64?3:0)).join(',')}}
  };`;
  for(const options of modes)assert.equal(await run(source,[4],options),20);
});

test('repeated saved-graph application and low scalar budgets remain bounded',()=>{
  const source='export fn main = (x:Num) -> (linearize (y -> y*y*y*y*y) x).pushforward 1;';
  assert.equal(check(source,{maxExpansion:20}).diagnostics[0].code,'E_LIMIT');
  const repeated=n=>`export fn main = (x:Num) -> do {let local=linearize (y -> y*y) x;
    ${Array.from({length:n},(_,i)=>`let unused${i}=local.pushforward 1;`).join('\n')}
    local.value};`;
  assert.equal(check(repeated(5),{maxExpansion:200}).ok,true);
  // Identical derivative nodes intern, but every application still costs work.
  assert.equal(check(repeated(80),{maxExpansion:200}).diagnostics[0].code,'E_LIMIT');
});

test('linked legacy helpers and compiler sessions retain independent snapshots',async()=>{
  const files=[{name:'legacy.ass',source:'fn square(x)=x*x;'},
    {name:'reuse.ass',source:'export fn main = (x:Num) -> do {let l=linearize square x;{value:l.value,a:l.pushforward 1,b:l.pushforward 2}};'}];
  const compiler=createCompiler(),first=compiler.compileSources(files),second=compiler.compileSources(files);
  assert.deepEqual(first.bytes,second.bytes);
  first.bytes.fill(0);
  assert.ok(WebAssembly.validate(compiler.compileSources(files).bytes));
  assert.deepEqual((await createRuntime(second)).call('main',[3]),{value:9,a:6,b:12});
});

test('the documented sensitivity example executes under every lowering configuration',async()=>{
  const doc=await readFile(new URL('../docs/LINEARIZE.md',import.meta.url),'utf8');
  const source=doc.match(/```ass\n([\s\S]*?)\n```/)[1];
  for(const options of modes)assert.deepEqual(plain((await createRuntime(compile(source,options))).call('sensitivities',[{x:2,y:4}])),{
    value:{energy:28,balance:-2},along_x:{energy:16,balance:1},along_y:{energy:6,balance:-1},
  });
});
