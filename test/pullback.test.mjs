import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile,compileSources,check,checkSources,createCompiler,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime,createCapability} from '../src/abi.mjs';
import {parse,infer} from '../src/frontend.mjs';
import {stage} from '../src/jte.mjs';
import {reusablePullback} from '../src/reverse.mjs';

const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const run=async(source,args,options={})=>(await createRuntime(compile(source,options))).call('main',args);
const response=p=>({energy:p.x*p.x*p.x+3*p.x*p.y+p.y*p.z,balance:p.x-2*p.y+p.z*p.z});
const weighted=(p,w)=>{const r=response(p);return r.energy*w.energy+r.balance*w.balance;};
const analytic=(p,w)=>({x:(3*p.x*p.x+3*p.y)*w.energy+w.balance,
  y:(3*p.x+p.z)*w.energy-2*w.balance,z:p.y*w.energy+2*p.z*w.balance});
const productSource=`fn response = p -> {energy:p.x*p.x*p.x+3*p.x*p.y+p.y*p.z,
  balance:p.x-2*p.y+p.z*p.z};
  export fn main = (p:{x:Num,y:Num,z:Num}) -> (a:{energy:Num,balance:Num}) ->
    (b:{energy:Num,balance:Num}) -> do {
      let local=pullback response p;
      {value:local.value,first:local.pullback a,second:local.pullback b,again:local.pullback a}
    };`;

for(const options of modes)test(`reused pullbacks match analytic derivatives and finite differences ${JSON.stringify(options)}`,async()=>{
  const c=compile(productSource,options),runtime=await createRuntime(c);
  assert.equal(c.stats.kernelHeapAllocationSites,0);
  assert.equal(c.stats.intermediateBufferBytes,0);
  assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes))
    .some(i=>i.kind==='table'||i.kind==='function'),false);
  let seed=359;
  const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<100;i++) {
    const p={x:random()%21-10,y:random()%19-9,z:random()%17-8};
    const a={energy:i%7-3,balance:i%5-2},b={energy:i%9-4,balance:i%3-1};
    const actual=runtime.call('main',[p,a,b]);
    assert.deepEqual(actual.value,response(p));
    assert.deepEqual(actual.again,actual.first);
    for(const [name,w] of [['first',a],['second',b]])for(const key of ['x','y','z']) {
      assert.ok(actual[name][key]===analytic(p,w)[key],`${name} ${key} case ${i}`);
      const h=1e-4,plus={...p,[key]:p[key]+h},minus={...p,[key]:p[key]-h};
      assert.ok(Math.abs(actual[name][key]-(weighted(plus,w)-weighted(minus,w))/(2*h))<1e-4);
    }
  }
});

test('multiple applications prepare the objective once, unlike repeated VJPs',async()=>{
  const f='fn objective = x -> do {let witness=range 1; x*x};';
  const shared=compile(f+`export fn main = (x:Num) -> do {
    let local=pullback objective x; local.pullback 1+local.pullback 2+local.pullback 3
  };`);
  const repeated=compile(f+`export fn main = (x:Num) ->
    (vjp objective x 1).cotangent+(vjp objective x 2).cotangent+(vjp objective x 3).cotangent;`);
  assert.equal(shared.certificate.steps.filter(s=>s.rule==='source').length,1);
  assert.equal(repeated.certificate.steps.filter(s=>s.rule==='source').length,3);
  assert.equal(verifyCertificate(shared.certificate.steps),true);
  assert.equal((await createRuntime(shared)).call('main',[3]),36);
  assert.equal((await createRuntime(repeated)).call('main',[3]),36);
});

test('checked topology is analyzed lazily once, independently of numeric equality',()=>{
  // A small staging-API double observes an independent terminal: graph analysis
  // visits it, whereas seeded accumulation has no root-reaching edge through it.
  let id=0,terminalReads=0,preparations=0;
  const scalar=(op,type,args=[],data)=>({kind:'scalar',id:id++,op,type,args,data});
  const shape=(v,fn)=>v.kind==='record'?{kind:'record',fields:new Map([...v.fields].map(([k,x])=>[k,shape(x,fn)]))}:fn(v);
  const leaves=v=>v.kind==='record'?[...v.fields.values()].flatMap(leaves):[v];
  const api={scalar,shape,leaves,num:n=>scalar('const','Num',[],n),boolean:b=>scalar('const','Bool',[],+b),
    invoke:(f,args)=>{preparations++;return f(...args);},substitute:v=>v,
    fail:(message,at,code)=>{throw Object.assign(new Error(message),{at,code});}};
  const terminal=scalar('wire','Num');
  Object.defineProperty(terminal,'op',{get(){terminalReads++;return 'wire';}});
  const local=reusablePullback(x=>scalar('+','Num',[x,terminal]),api.num(3),api,{offset:10});
  assert.equal(preparations,1);assert.equal(terminalReads,0);
  const apply=local.fields.get('pullback').apply;
  apply(api.num(1),{offset:20});
  assert.ok(terminalReads>0);
  const reads=terminalReads;
  apply(api.num(2),{offset:30});apply(api.num(0),{offset:40});
  assert.equal(terminalReads,reads);assert.equal(preparations,1);
  assert.throws(()=>apply(scalar('const','Bool',[],1),{offset:50}),
    e=>e.code==='E_DIFF_TYPE'&&e.at.offset===50);
});

test('aliased inputs and nested numeric products preserve shapes and independent weights',async()=>{
  const source=`export fn main = (x:Num) -> do {
    let local=pullback (p -> {mixed:p.z*p.a._0,square:p.a._1.inner*p.a._1.inner,empty:()})
      {z:x,a:(x,{inner:x,empty:()})};
    {value:local.value,first:local.pullback {mixed:2,square:3,empty:()},
     second:local.pullback {mixed:3,square:2,empty:()}}
  };`;
  for(const options of modes)assert.deepEqual(await run(source,[3],options),{
    value:{mixed:9,square:9,empty:{}},
    first:{z:6,a:{_0:6,_1:{inner:18,empty:{}}}},
    second:{z:9,a:{_0:9,_1:{inner:12,empty:{}}}},
  });
  const seed=Array.from({length:12},(_,i)=>i===2?2:i===10?3:0).join(',');
  assert.equal(await run(`export fn main = () ->
    (pullback (x -> (${Array.from({length:12},(_,i)=>`x*${i+1}`).join(',')})) 4).pullback (${seed});`,[{}]),39);
});

test('empty products and legacy unit applications follow VJP rules',async()=>{
  for(const options of modes) {
    assert.deepEqual(await run('export fn main = () -> (pullback (u -> 7) ()).pullback 1;',[{}],options),{});
    assert.deepEqual(await run('export fn main = () -> (pullback (p -> ()) {x:3,y:4}).pullback ();',[{}],options),{x:0,y:0});
    assert.equal(await run('export fn main()={let l=pullback(x=>{},3); l.pullback()};',[],options),0);
  }
});

test('partial intrinsics, polymorphic helpers, and returned pullbacks compose',async()=>{
  const source=`fn prepare = f -> pullback f;
    fn derivative = f -> x -> (prepare f x).pullback;
    fn twice = f -> x -> f (f x);
    export fn main = (x:Num) -> do {
      let scalar=derivative (y -> y*y) x;
      let product=derivative (p -> {left:p.a*p.b,right:p.a+p.b}) {a:x,b:x};
      {repeated:twice scalar 1,product:product {left:2,right:3},builtin:(pullback (max 2) x).pullback 2}
    };`;
  for(const options of modes)assert.deepEqual(await run(source,[3],options),{repeated:36,product:{a:9,b:9},builtin:2});
});

test('finite choices can select objectives, saved records, and mixed callable kinds',async()=>{
  const source=`export fn main = (flag:Bool) -> (x:Num) -> do {
    let a=pullback (y -> y*y) x;
    let b=pullback (y -> 3*y) x;
    let selected=if flag then a else b;
    let mixed=if flag then a.pullback else (w -> 5*w);
    let objective=pullback (if flag then (y -> y*y) else (y -> 3*y)) x;
    let forward=linearize (y -> y*y) x;
    {value:selected.value,a:selected.pullback 2,b:selected.pullback 3,
     mixed:mixed 2,objective:objective.pullback 2,
     modes:(if flag then a.pullback else forward.pushforward) 2}
  };`;
  for(const options of modes)for(const flag of [false,true])assert.deepEqual(await run(source,[flag,4],options),{
    value:flag?16:12,a:flag?16:6,b:flag?24:9,mixed:flag?16:10,objective:flag?16:6,modes:16,
  });
});

for(const options of modes)test(`nested AD and weight sensitivity ${JSON.stringify(options)}`,async()=>{
  const programs=[
    ['grad (y -> (pullback (z -> y*z) y).pullback 1) x',1],
    ['grad (y -> (pullback (z -> y*z) y).value) x',6],
    ['(pullback (y -> x*y) x).pullback 2',6],
    ['grad (y -> (pullback (z -> y*z) x).pullback y) x',6],
    ['(pullback (y -> (jvp (z -> z*z) y 2).tangent) x).pullback 3',12],
    ['(jvp (y -> (pullback (z -> z*z) y).pullback 2) x 3).tangent',12],
    ['(pullback (y -> (pullback (z -> z*z) y).pullback 2) x).pullback 3',12],
    ['grad (grad (y -> (pullback (z -> z*z*z*z) y).pullback 1)) x',72],
    ['(linearize (y -> (pullback (z -> z*z*z) y).pullback 2) x).pushforward 3',108],
    ['(pullback (linearize (y -> y*y) x).pushforward x).pullback 2',12],
    ['do {let local=pullback (y -> y*y) x; grad local.pullback 2}',6],
    ['do {let local=pullback (y -> y*y) x; grad (grad local.pullback) 2}',0],
    ['do {let local=pullback (y -> y*y) x; (vjp local.pullback 2 3).cotangent}',18],
    ['do {let local=pullback (y -> y*y) x; (pullback local.pullback 2).pullback 3}',18],
    ['do {let local=pullback (y -> y*y*y) x; let d=grad local.pullback 2; d+local.pullback 3}',108],
    ['grad (y -> do {let local=pullback (z -> y*z*z) y; let d=grad local.pullback 2; d+local.pullback 3}) x',48],
    ['grad (y -> (pullback (z -> z*stop_gradient z) y).pullback 1) x',0],
  ];
  for(const [expression,expected] of programs)
    assert.equal(await run(`export fn main = (x:Num) -> ${expression};`,[3],options),expected,expression);
});

test('saved derivatives yield independent analytic Hessian-vector products',async()=>{
  const source=`fn objective = p -> p.x*p.x*p.x+p.x*p.y+2*p.y*p.y;
    export fn main = (p:{x:Num,y:Num}) -> (v:{x:Num,y:Num}) -> do {
      let reverse=pullback (grad objective) p;
      let forward=linearize (q -> (pullback objective q).pullback 1) p;
      {a:reverse.pullback v,b:forward.pushforward v}
    };`;
  for(const options of modes) {
    const runtime=await createRuntime(compile(source,options));
    for(let i=0;i<80;i++) {
      const p={x:i%9-4,y:i%7-3},v={x:i%5-2,y:i%11-5},r=runtime.call('main',[p,v]);
      for(const key of ['a','b']) {
        assert.ok(r[key].x===6*p.x*v.x+v.y);assert.ok(r[key].y===v.x+4*v.y);
      }
    }
  }
});

test('reused pullbacks preserve shared branch activity without leaking previous weights',async()=>{
  const source=`export fn main = (x:Num) -> (flag:Bool) -> do {
    let local=pullback (y -> do {let shared=y*y;
      {a:if flag then shared*shared else y,
       b:if y>0 then shared else -shared}}) x;
    {a:local.pullback {a:1,b:0},b:local.pullback {a:0,b:1},
     both:local.pullback {a:2,b:3},again:local.pullback {a:1,b:0}}
  };`;
  for(const options of modes) {
    const runtime=await createRuntime(compile(source,options));
    for(let i=0;i<60;i++) {
      const x=i%11-5,flag=i%2===0,r=runtime.call('main',[x,flag]);
      const a=flag?4*x*x*x:1,b=x>0?2*x:-2*x;
      assert.ok(r.a===a);assert.ok(r.b===b);assert.ok(r.both===2*a+3*b);assert.ok(r.again===a);
    }
  }
});

test('inactive guards and singular coefficients remain inactive across repeated applications',async()=>{
  const programs=[
    ['y -> if y>0 then y*y else sqrt (-y)',6],
    ['y -> do {let z=sqrt (require false y); if flag then y*y else z*z+z}',6],
    ['y -> if flag then y*y*y else (if require false true then y*y else y)',27],
  ];
  for(const options of modes)for(const [objective,d] of programs)assert.deepEqual(await run(`
    export fn main = (flag:Bool) -> do {let local=pullback (${objective}) 3;
    {a:local.pullback 1,b:local.pullback 2}};`,[true],options),{a:d,b:2*d});
});

test('cotangents retain all primal output guards even with zero weights and ignored inputs',async()=>{
  const programs=[
    '(pullback (x -> require false 7) 2).pullback 0',
    '((pullback (p -> require false p.x) {x:2,y:3}).pullback 0).y',
    '(pullback (x -> {safe:x*x,bad:require false x}) 3).pullback {safe:1,bad:0}',
    '(pullback (x -> floor (require false x)) 2).pullback 1',
    '(pullback (x -> stop_gradient (require false x)) 2).pullback 1',
    '(pullback (require false (x -> x*x)) 2).pullback 1',
    '(require false (pullback (x -> x*x) 2).pullback) 1',
    '(require false (pullback (x -> x*x) 2)).pullback 1',
    '(pullback (x -> {a:x/x,b:require false x}) 0).pullback {a:0,b:0}',
  ];
  for(const options of modes)for(const expression of programs)
    await assert.rejects(()=>run(`export fn main = () -> ${expression};`,[{}],options),WebAssembly.RuntimeError);
});

test('unused fields, weights, bindings, and value projections keep their demand behavior',async()=>{
  const programs=[
    ['do {let unused=pullback (x -> require false x) 3; 7}',7],
    ['do {let local=pullback (x -> require false x) 3; let unused=local.pullback 1; 7}',7],
    ['(pullback (x -> {safe:x*x,bad:require false x}) 3).value.safe',9],
    ['((pullback (p -> p.x*p.x) {x:3,bad:require false 4}).pullback 1).bad',0],
    ['((pullback (p -> p.x*p.x) {x:3,bad:require false 4}).pullback 1).x',6],
    ['(pullback (x -> {active:x*x,constant:7}) 3).pullback {active:1,constant:require false 1}',6],
    ['(pullback (x -> 7) (require false 2)).pullback (require false 1)',0],
    ['(pullback (x -> floor x) 3).pullback (require false 1)',0],
    ['(pullback (x -> stop_gradient (x*x)) 3).pullback (require false 1)',0],
    [`do {let a=pullback (x -> x*x) 3; let b=pullback (x -> require false x) 3;
      (if true then a.pullback else b.pullback) 1}`,6],
  ];
  for(const options of modes)for(const [expression,expected] of programs)
    assert.equal(await run(`export fn main = () -> ${expression};`,[{}],options),expected,expression);
});

test('value-only preparation defers reverse validation but ordinary VJP remains eager',async()=>{
  const objective='x -> sum (map (range 3) (i -> i*x))';
  for(const options of modes) {
    assert.equal(await run(`export fn main = () -> (pullback (${objective}) 4).value;`,[{}],options),12);
    assert.equal(check(`export fn main = () -> (vjp (${objective}) 4 1).value;`,options).diagnostics[0].code,'E_DIFF_UNSUPPORTED');
    assert.equal(check(`export fn main = () -> do {let local=pullback (${objective}) 4;
      if false then local.pullback 1 else local.value};`,options).diagnostics[0].code,'E_DIFF_UNSUPPORTED');
  }
});

test('saved pullbacks work in streams, nested traversals, and causal callbacks',async()=>{
  const mapped='export fn main = (xs:[Num]) -> do {let local=pullback (y -> y*y) 4; map xs local.pullback};';
  const causal='export fn main = (xs:[Num]) -> scan xs 0 (s -> x -> (pullback (y -> s*y+y*y) x).pullback 1);';
  const nested='export fn main = (xs:[Num]) -> map xs (x -> do {let local=pullback (y -> x*y+y*y) x; sum (map xs local.pullback)});';
  for(const options of modes) {
    const c=compile(mapped,options);
    assert.equal(c.observations.main.access,'indexed');assert.equal(verifyCertificate(c.certificate.steps),true);
    assert.deepEqual(Array.from((await createRuntime(c)).call('main',[[1,2,3]])),[8,16,24]);
    const scan=compile(causal,options);assert.equal(scan.observations.main.access,'sequential');
    assert.deepEqual(Array.from((await createRuntime(scan)).call('main',[[1,2,3]])),[2,6,12]);
    assert.deepEqual(Array.from(await run(nested,[[1,2,3]],options)),[18,36,54]);
  }
});

test('empty streams do not demand trapping callbacks or causal initialization',async()=>{
  for(const options of modes)for(const expression of [
    'do {let local=pullback (x -> require false x) 3; map xs local.pullback}',
    'scan xs (require false 0) (s -> x -> (pullback (y -> s*y) x).pullback 1)',
  ]) {
    const source=`export fn main = (xs:[Num]) -> ${expression};`;
    assert.deepEqual(Array.from(await run(source,[[]],options)),[]);
    await assert.rejects(()=>run(source,[[1]],options),WebAssembly.RuntimeError);
  }
});

test('reused pullbacks preserve the VJP f64 schedule and pathwise conventions',async()=>{
  const source=`fn f = x -> {identity:x,negative:-x,square:x*x,ratio:5/x,
    absolute:abs x,rounded:floor x,lo:min x 2,hi:max x 2,root:sqrt (x*x+1),stopped:x*stop_gradient x};
    export fn main = (x:Num) -> (w:Num) -> do {
      let local=pullback f x;
      let a={identity:w,negative:2,square:w,ratio:1,absolute:2,rounded:1,lo:w,hi:1,root:2,stopped:3};
      let b={identity:1,negative:w,square:2,ratio:w,absolute:0,rounded:0,lo:1,hi:w,root:1,stopped:0};
      {a:local.pullback a,b:local.pullback b,again:local.pullback a,
       va:(vjp f x a).cotangent,vb:(vjp f x b).cotangent}
    };`;
  for(const options of modes) {
    const runtime=await createRuntime(compile(source,options));
    for(const x of [-0,0,1,-1,2,Infinity,-Infinity,NaN])for(const w of [-0,0,1,-2,Infinity,NaN]) {
      const r=runtime.call('main',[x,w]);
      assert.ok(Object.is(r.a,r.va));assert.ok(Object.is(r.b,r.vb));assert.ok(Object.is(r.again,r.a));
    }
    const identity=await run('export fn main = (w:Num) -> (pullback (x -> x) 3).pullback w;',[-0],options);
    assert.ok(Object.is(identity,-0));
    assert.ok(Number.isNaN(await run('export fn main = () -> (pullback sqrt 0).pullback 0;',[{}],options)));
    assert.equal(await run('export fn main = () -> (pullback (max 2) 2).pullback 1;',[{}],options),0);
    assert.equal(await run('export fn main = () -> (pullback abs 0).pullback 1;',[{}],options),0);
  }
});

test('independent memory loads retain bounds demand',async()=>{
  for(const options of modes) {
    const source='export fn main = (xs:[Num]) -> (pullback (x -> (at xs 0)*x) 3).pullback 2;';
    assert.equal(await run(source,[[7]],options),14);
    await assert.rejects(()=>run(source,[[]],options),WebAssembly.RuntimeError);
    await assert.rejects(()=>run('export fn main = (xs:[Num]) -> (pullback (x -> at xs 0) 3).pullback 1;',[[]],options),WebAssembly.RuntimeError);
  }
});

test('performed results are atomic under reuse, nesting, and stopped captures',async()=>{
  const programs=[
    ['let local=pullback (p -> {a:p.x*p.x,b:p.x*p.y}) {x:y,y:y};',
      '{value:local.value,a:local.pullback {a:1,b:0},b:local.pullback {a:2,b:3}}',
      {value:{a:36,b:36},a:{x:12,y:0},b:{x:42,y:18}}],
    ['let local=pullback (z -> z*y) x;',
      '{a:local.pullback 1,b:local.pullback 2,nested:grad local.pullback 3}',{a:6,b:12,nested:6}],
    ['let local=pullback (z -> z*stop_gradient y) x;',
      '{a:local.pullback 1,b:local.pullback 2}',{a:6,b:12}],
  ];
  for(const options of modes)for(const [binding,result,expected] of programs) {
    const source=`host fn h: Num -> Num; export fn main = (x:Num) -> effect {
      let y=perform h x; ${binding} ${result}
    };`;
    let calls=0;
    const capability=createCapability({h:{parameters:['Num'],result:'Num',call:x=>{calls++;return 3*x;}}},{maxCalls:1});
    assert.deepEqual((await createRuntime(compile(source,options))).call('main',[2],{capability}),expected);
    assert.equal(calls,1);assert.equal(capability.remaining,0);
  }
});

test('type, shape, ABI, and authority errors remain structured and source-local',()=>{
  const bad=[
    ['export fn main = () -> (pullback (x -> 1) true).value;','E_DIFF_TYPE'],
    ['export fn main = () -> (pullback (x -> true) 1).value;','E_DIFF_TYPE'],
    ['export fn main = () -> (pullback (x -> {a:x,b:false}) 1).value.a;','E_DIFF_TYPE'],
    ['export fn main = () -> (pullback (p -> p.a) {a:1,b:false}).value;','E_DIFF_TYPE'],
    ['export fn main = () -> (pullback (x -> {a:x}) 1).pullback {b:1};','E_TYPE'],
    ['export fn main = () -> (pullback (x -> x) 1).pullback false;','E_TYPE'],
    ['export fn main = () -> (pullback (x -> x) 1).pullback 1 2;','E_TYPE'],
    ['export fn main = () -> (pullback (x -> 1) (range 3)).value;','E_LOWER'],
    ['export fn main = () -> (pullback (x -> range 3) 1).value;','E_LOWER'],
    ['export fn main = () -> (pullback (x -> y -> x+y) 1).pullback (y -> y);','E_LOWER'],
    ['export fn main = (x:Num) -> pullback (y -> y*y) x;','E_ABI'],
    ['export fn main = (x:Num) -> (pullback (y -> y*y) x).pullback;','E_ABI'],
    ['fn pullback = x -> x; export fn main = () -> pullback 1;','E_NAME'],
    ['host fn pullback: Num -> Num; export fn main = () -> 1;','E_NAME'],
    ['host fn h: Num -> Num; export fn main = (x:Num) -> (pullback h x).pullback 1;','E_EFFECT'],
  ];
  for(const options of modes)for(const [source,code] of bad) {
    const files=[{name:'helper.ass',source:'fn id = x -> x;'},{name:'pullback.ass',source:'// fixture\n'+source}];
    const d=checkSources(files,options).diagnostics[0];
    assert.equal(d?.code,code,source);assert.equal(d.sourceName,'pullback.ass');assert.equal(d.range.start.line,2);
    assert.throws(()=>compileSources(files,options),e=>e.code===code&&e.sourceName===d.sourceName&&e.offset===d.range.start.offset);
  }
});

test('deferred graph errors point to the first application rather than preparation',()=>{
  for(const options of modes)for(const [objective,code] of [
    ['y -> sum (range y)','E_DIFF_UNSUPPORTED'],
    ['y -> at xs y','E_DIFF_CONTROL'],
  ]) {
    const source=`export fn main = (xs:[Num]) -> (x:Num) -> do {\n  let local=pullback (${objective}) x;\n  local.pullback 1\n};`;
    const d=checkSources([{name:'apply.ass',source}],options).diagnostics[0];
    assert.equal(d.code,code);assert.equal(d.sourceName,'apply.ass');assert.equal(d.range.start.line,3);
    assert.equal(d.range.start.offset,source.lastIndexOf('pullback'));
  }
});

const wide=n=>`export fn main = (x:Num) -> do {
  let local=pullback (p -> ${Array.from({length:n},(_,i)=>`p.f${i}*p.f${i}`).join('+')})
    {${Array.from({length:n},(_,i)=>`f${i}:x`).join(',')}};
  {a:local.pullback 1,b:local.pullback 2}
};`;
test('wide shapes and repeated interned applications remain within existing budgets',async()=>{
  for(const options of modes) {
    const r=await run(wide(65),[3],options);
    for(let i=0;i<65;i++) {assert.equal(r.a['f'+i],6);assert.equal(r.b['f'+i],12);}
  }
  assert.equal(check(wide(16),{maxExpansion:40}).diagnostics[0].code,'E_LIMIT');
  const repeated=n=>`export fn main = (x:Num) -> do {let local=pullback (y -> y*y) x;
    ${Array.from({length:n},(_,i)=>`let unused${i}=local.pullback 1;`).join('\n')} local.value};`;
  assert.equal(check(repeated(5),{maxExpansion:200}).ok,true);
  assert.equal(check(repeated(80),{maxExpansion:200}).diagnostics[0].code,'E_LIMIT');
});

test('saved nested derivatives erase temporary tags before emission',()=>{
  const source=`export fn main = (x:Num) -> grad (y -> do {
    let local=pullback (z -> y*z*z) y; local.pullback 1+local.pullback 2
  }) x;`;
  const program=parse(source),staged=stage(program,infer(program)),seen=new Set();
  function visit(n) {
    if(n.kind==='record') {for(const v of n.fields.values())visit(v);return;}
    if(seen.has(n.id))return;seen.add(n.id);
    assert.equal(n.data?.differentialSeed,undefined);
    for(const a of n.args)visit(a);
  }
  visit(staged.kernels[0].result);
});

test('compiler sessions and linked legacy helpers have independent snapshots',async()=>{
  const files=[{name:'legacy.ass',source:'fn square(x)=x*x;'},
    {name:'reuse.ass',source:'export fn main = (x:Num) -> do {let l=pullback square x;{a:l.pullback 1,b:l.pullback 2}};'}];
  const compiler=createCompiler(),first=compiler.compileSources(files),second=compiler.compileSources(files);
  assert.deepEqual(first.bytes,second.bytes);first.bytes.fill(0);
  assert.ok(WebAssembly.validate(compiler.compileSources(files).bytes));
  assert.deepEqual((await createRuntime(second)).call('main',[3]),{a:6,b:12});
});

test('the documentation sensitivity example executes in every configuration',async()=>{
  const doc=await readFile(new URL('../docs/PULLBACK.md',import.meta.url),'utf8');
  const source=doc.match(/```ass\n([\s\S]*?)\n```/)[1];
  for(const options of modes)assert.deepEqual((await createRuntime(compile(source,options))).call('sensitivities',[{x:2,y:4}]),{
    value:{energy:28,balance:-2},energy:{x:16,y:6},weighted:{x:37,y:7},
  });
});
