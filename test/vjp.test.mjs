import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile,compileSources,check,checkSources,createCompiler,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime,createCapability} from '../src/abi.mjs';
import {parse,infer} from '../src/frontend.mjs';
import {stage} from '../src/jte.mjs';

const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const run=async(source,args,options={})=>(await createRuntime(compile(source,options))).call('main',args);
const response=p=>({energy:p.x*p.x*p.x+3*p.x*p.y+p.y*p.z,
  balance:p.x-2*p.y+p.z*p.z,nested:{_0:p.y*p.y,_1:p.x*p.z}});
const weighted=(p,w)=>{
  const r=response(p);
  return r.energy*w.energy+r.balance*w.balance+r.nested._0*w.nested._0+r.nested._1*w.nested._1;
};
const analytic=(p,w)=>({x:(3*p.x*p.x+3*p.y)*w.energy+w.balance+p.z*w.nested._1,
  y:(3*p.x+p.z)*w.energy-2*w.balance+2*p.y*w.nested._0,
  z:p.y*w.energy+2*p.z*w.balance+p.x*w.nested._1});
const dot=(a,b)=>Object.keys(a).reduce((s,k)=>s+(typeof a[k]==='number'?a[k]*b[k]:dot(a[k],b[k])),0);
const productSource=`fn response = p -> {energy:p.x*p.x*p.x+3*p.x*p.y+p.y*p.z,
  balance:p.x-2*p.y+p.z*p.z,nested:(p.y*p.y,p.x*p.z)};
  export fn main = (p:{x:Num,y:Num,z:Num}) ->
    (w:{energy:Num,balance:Num,nested:(Num,Num)}) -> (v:{x:Num,y:Num,z:Num}) ->
    {reverse:vjp response p w,forward:(jvp response p v).tangent};`;

for(const options of modes)test(`VJP analytic, finite differences, and adjoint identity ${JSON.stringify(options)}`,async()=>{
  const compiled=compile(productSource,options),runtime=await createRuntime(compiled);
  assert.equal(compiled.stats.kernelHeapAllocationSites,0);
  assert.equal(compiled.stats.intermediateBufferBytes,0);
  assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(compiled.bytes))
    .some(i=>i.kind==='table'||i.kind==='function'),false);
  let seed=293;
  const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<100;i++) {
    const p={z:random()%17-8,y:random()%19-9,x:random()%21-10};
    const w={energy:i%7-3,balance:i%5-2,nested:{_0:i%3-1,_1:i%9-4}};
    const v={x:random()%9-4,y:random()%7-3,z:random()%5-2};
    const actual=runtime.call('main',[p,w,v]),expected=analytic(p,w);
    assert.deepEqual(actual.reverse.value,response(p));
    for(const k of ['x','y','z']) {
      assert.ok(actual.reverse.cotangent[k]===expected[k],`${k}: analytic case ${i}`);
      const h=1e-4,plus={...p,[k]:p[k]+h},minus={...p,[k]:p[k]-h};
      assert.ok(Math.abs(actual.reverse.cotangent[k]-(weighted(plus,w)-weighted(minus,w))/(2*h))<1e-4);
    }
    assert.ok(dot(actual.reverse.cotangent,v)===dot(w,actual.forward));
  }
});

for(const options of modes)test(`VJP rational and square-root rules ${JSON.stringify(options)}`,async()=>{
  const source=`export fn main = (p:{x:Num,y:Num}) -> vjp
    (q -> {ratio:q.x/(q.y+5),root:sqrt (q.x*q.x+q.y*q.y+1)}) p {ratio:2,root:3};`;
  const runtime=await createRuntime(compile(source,options));
  for(let i=0;i<80;i++) {
    const p={x:(i%19-9)/3,y:(i%13-6)/4},r=runtime.call('main',[p]);
    const root=Math.sqrt(p.x*p.x+p.y*p.y+1);
    assert.ok(Math.abs(r.cotangent.x-(2/(p.y+5)+3*p.x/root))<1e-12);
    assert.ok(Math.abs(r.cotangent.y-(-2*p.x/((p.y+5)*(p.y+5))+3*p.y/root))<1e-12);
  }
});

test('reverse accumulation merges diamond paths and repeated output nodes',async()=>{
  const programs=[
    ['vjp (x -> do {let a=x*x; let b=a+a; b*b+b}) 3 1',{value:342,cotangent:444}],
    ['vjp (p -> do {let shared=p.x*p.y; {a:shared,b:shared}}) {x:3,y:4} {a:2,b:3}',
      {value:{a:12,b:12},cotangent:{x:20,y:15}}],
    ['vjp (x -> {a:x,b:x}) 3 {a:2,b:3}',{value:{a:3,b:3},cotangent:5}],
  ];
  for(const options of modes)for(const [expression,expected] of programs)
    assert.deepEqual(await run(`export fn main = () -> ${expression};`,[{}],options),expected);
});

test('VJP preserves aliased coordinates, nested tuple shapes, and empty fields',async()=>{
  const source=`export fn main = (x:Num) -> vjp
    (p -> {mixed:p.z*p.a._0,square:p.a._1.inner*p.a._1.inner,empty:()})
    {z:x,a:(x,{inner:x,empty:()})} {mixed:2,square:3,empty:()};`;
  for(const options of modes)assert.deepEqual(await run(source,[3],options),{
    value:{mixed:9,square:9,empty:{}},cotangent:{z:6,a:{_0:6,_1:{inner:18,empty:{}}}},
  });
  const tuple=Array.from({length:12},(_,i)=>i+1).join(',');
  const seed=Array.from({length:12},(_,i)=>i===2?2:i===10?3:0).join(',');
  assert.equal(await run(`export fn main = () -> (vjp (x -> (${Array.from({length:12},(_,i)=>`x*${i+1}`).join(',')})) 4 (${seed})).cotangent;`,[{}]),39);
  const c=await run(`export fn main = () -> (vjp (p -> p._2*p._10) (${tuple}) 2).cotangent;`,[{}]);
  for(let i=0;i<12;i++)assert.equal(c['_'+i],i===2?22:i===10?6:0);
});

test('empty input/output products and legacy unit application are supported',async()=>{
  for(const options of modes) {
    assert.deepEqual(await run('export fn main = () -> vjp (u -> 7) () 1;',[{}],options),{value:7,cotangent:{}});
    assert.deepEqual(await run('export fn main = () -> vjp (x -> ()) {a:3,b:4} ();',[{}],options),{value:{},cotangent:{a:0,b:0}});
    assert.deepEqual(await run('fn constant()=7; export fn main()=vjp(constant,{},1);',[],options),{value:7,cotangent:{}});
  }
});

test('partial intrinsic applications, polymorphic helpers, and finite choices compose',async()=>{
  const source=`fn reverse = f -> x -> vjp f x;
    export fn main = (flag:Bool) -> (x:Num) -> do {
      let selected=if flag then (y -> y*y) else (y -> 3*y);
      let scalar=reverse selected x;
      let product=reverse (p -> {a:p.x*p.y,b:p.x+p.y}) {x,y:x};
      {scalar:scalar 2,product:product {a:2,b:3},builtin:vjp (max 2) x 1}
    };`;
  for(const options of modes)for(const flag of [false,true])assert.deepEqual(await run(source,[flag,4],options),{
    scalar:{value:flag?16:12,cotangent:flag?16:6},
    product:{value:{a:16,b:8},cotangent:{x:11,y:11}},builtin:{value:4,cotangent:1},
  });
});

for(const options of modes)test(`nested forward/reverse AD and weight sensitivity ${JSON.stringify(options)}`,async()=>{
  const programs=[
    ['grad (y -> (vjp (z -> y*z) y 1).cotangent) x',1],
    ['grad (y -> (vjp (z -> y*z) y 1).value) x',6],
    ['(vjp (y -> x*y) x 2).cotangent',6],
    ['grad (y -> (vjp (z -> y*z) x y).cotangent) x',6],
    ['(vjp (y -> (jvp (z -> z*z) y 2).tangent) x 3).cotangent',12],
    ['(jvp (y -> (vjp (z -> z*z) y 2).cotangent) x 3).tangent',12],
    ['(vjp (y -> (vjp (z -> z*z) y 2).cotangent) x 3).cotangent',12],
    ['grad (grad (y -> (vjp (z -> z*z*z*z) y 1).cotangent)) x',72],
    ['(linearize (y -> (vjp (z -> z*z*z) y 2).cotangent) x).pushforward 3',108],
    ['(vjp (linearize (y -> y*y) x).pushforward x 2).cotangent',12],
    ['grad (w -> (vjp (y -> y*y) x w).cotangent) 2',6],
    ['(vjp (w -> (vjp (y -> y*y) x w).cotangent) 2 3).cotangent',18],
    ['grad (y -> (vjp (z -> z*stop_gradient z) y 1).cotangent) x',0],
    ['(vjp (y -> (vjp (z -> z*stop_gradient z) y 1).cotangent) x 1).cotangent',0],
  ];
  for(const [expression,expected] of programs)
    assert.equal(await run(`export fn main = (x:Num) -> ${expression};`,[3],options),expected,expression);
});

test('reverse-over-forward and forward-over-reverse yield analytic Hessian-vector products',async()=>{
  const source=`fn objective = p -> p.x*p.x*p.x+p.x*p.y+2*p.y*p.y;
    export fn main = (p:{x:Num,y:Num}) -> (v:{x:Num,y:Num}) ->
      {reverse:(vjp (grad objective) p v).cotangent,
       forward:(jvp (q -> (vjp objective q 1).cotangent) p v).tangent};`;
  for(const options of modes) {
    const runtime=await createRuntime(compile(source,options));
    for(let i=0;i<100;i++) {
      const p={x:i%9-4,y:i%7-3},v={x:i%5-2,y:i%11-5},actual=runtime.call('main',[p,v]);
      for(const key of ['reverse','forward']) {
        assert.ok(actual[key].x===6*p.x*v.x+v.y);
        assert.ok(actual[key].y===v.x+4*v.y);
      }
    }
  }
});

test('inactive singular coefficients, shared guards, and nested predicates stay inactive',async()=>{
  const programs=[
    ['vjp (y -> if y>0 then y*y else sqrt (require false y)) 3 1',6],
    ['vjp (y -> if y>0 then y*y else sqrt (-y)) 3 1',6],
    ['vjp (y -> do {let z=sqrt (require false y); if flag then y*y else z*z+z}) 3 1',6],
    ['vjp (y -> if flag then y*y*y else (if require false true then y*y else y)) 3 1',27],
    ['vjp (y -> do {let z=require (y<0) y; {a:if flag then y else z*z,b:if flag then y*y else z}}) 3 {a:1,b:1}',7],
  ];
  for(const options of modes)for(const [expression,expected] of programs)
    assert.equal((await run(`export fn main = (flag:Bool) -> ${expression};`,[true],options)).cotangent,expected,expression);
  for(const options of modes)for(const flag of [false,true]) {
    const source='export fn main = (flag:Bool) -> (vjp (y -> do {let z=y*y; if flag then z else z*z}) 3 1).cotangent;';
    assert.equal(await run(source,[flag],options),flag?6:108);
  }
});

test('overlapping branch activities on shared intermediates match independent derivatives',async()=>{
  const source=`export fn main = (p:{x:Num,y:Num}) -> (flag:Bool) -> (a:Num) -> (b:Num) ->
    vjp (q -> do {let shared=q.x*q.y;
      {left:if flag then shared*shared else q.x+q.y,
       right:if q.x>0 then shared+q.y*q.y else -shared}
    }) p {left:a,right:b};`;
  const objective=(p,flag,a,b)=>{
    const shared=p.x*p.y;
    return a*(flag?shared*shared:p.x+p.y)+b*(p.x>0?shared+p.y*p.y:-shared);
  };
  for(const options of modes) {
    const runtime=await createRuntime(compile(source,options));
    for(let i=0;i<100;i++) {
      const p={x:(i%2?1:-1)*(1+i%7),y:i%11-5},flag=i%3===0,a=i%5-2,b=i%7-3;
      const r=runtime.call('main',[p,flag,a,b]),shared=p.x*p.y;
      const expected={x:a*(flag?2*shared*p.y:1)+b*(p.x>0?p.y:-p.y),
        y:a*(flag?2*shared*p.x:1)+b*(p.x>0?p.x+2*p.y:-p.x)};
      for(const k of ['x','y']) {
        assert.ok(r.cotangent[k]===expected[k]);
        const h=1e-4;
        assert.ok(Math.abs(r.cotangent[k]-(objective({...p,[k]:p[k]+h},flag,a,b)
          -objective({...p,[k]:p[k]-h},flag,a,b))/(2*h))<1e-5);
      }
    }
  }
});

test('shared nonlinear chains under dynamic branches retain bounded staged graphs',async()=>{
  for(const options of modes)for(const depth of [4,8,16]) {
    const source=`export fn main = (x:Num) -> (flag:Bool) -> (vjp (y -> do {
      let t0=y*y;
      ${Array.from({length:depth},(_,i)=>`let t${i+1}=t${i}*t${i};`).join('')}
      if flag then t${depth} else y
    }) x 1).cotangent;`;
    const c=compile(source,options),runtime=await createRuntime(c);
    assert.ok(c.stats.scalarNodes<15*depth+40);
    assert.equal(runtime.call('main',[1,true]),2**(depth+1));
    assert.equal(runtime.call('main',[1,false]),1);
  }
});

test('every numeric objective output is demanded by each input cotangent, even at zero weights',async()=>{
  const programs=[
    '(vjp (x -> require false 7) 2 0).cotangent',
    '(vjp (p -> require false p.x) {x:2,y:3} 0).cotangent.y',
    '(vjp (x -> {safe:x*x,bad:require false x}) 3 {safe:1,bad:0}).cotangent',
    '(vjp (x -> floor (require false x)) 2 1).cotangent',
    '(vjp (x -> stop_gradient (require false x)) 2 1).cotangent',
    '(vjp (require false (x -> x*x)) 2 1).cotangent',
    '(vjp (x -> if require false true then 7 else 8) 2 1).cotangent',
  ];
  for(const options of modes)for(const expression of programs)
    await assert.rejects(()=>run(`export fn main = () -> ${expression};`,[{}],options),WebAssembly.RuntimeError);
  // A NaN in the first output cannot short-circuit the later primal guard.
  const nan='export fn main = (x:Num) -> (vjp (y -> {a:y/y,b:require false y}) x {a:0,b:0}).cotangent;';
  for(const options of modes)await assert.rejects(()=>run(nan,[0],options),WebAssembly.RuntimeError);
});

test('unused results, input fields, independent weights, and value projections remain lazy',async()=>{
  const programs=[
    ['do {let unused=vjp (x -> require false x) 3 1; 7}',7],
    ['(vjp (x -> {safe:x*x,bad:require false x}) 3 {safe:require false 1,bad:1}).value.safe',9],
    ['(vjp (p -> p.x*p.x) {x:3,bad:require false 4} 1).cotangent.bad',0],
    ['(vjp (p -> p.x*p.x) {x:3,bad:require false 4} 1).cotangent.x',6],
    ['(vjp (x -> {active:x*x,constant:7}) 3 {active:1,constant:require false 1}).cotangent',6],
    ['(vjp (x -> 7) (require false 2) (require false 1)).cotangent',0],
    ['(vjp (x -> floor x) 3 (require false 1)).cotangent',0],
    ['(vjp (x -> stop_gradient (x*x)) 3 (require false 1)).cotangent',0],
    ['(vjp (x -> x*x) 3 (require false 1)).value',9],
  ];
  for(const options of modes)for(const [expression,expected] of programs)
    assert.equal(await run(`export fn main = () -> ${expression};`,[{}],options),expected,expression);
});

test('local VJPs preserve stream observations, causal captures, and empty-stream demand',async()=>{
  const mapped='export fn main = (xs:[Num]) -> map xs (x -> (vjp (y -> y*y) x 1).cotangent);';
  const causal='export fn main = (xs:[Num]) -> scan xs 0 (s -> x -> (vjp (y -> s*y+y*y) x 1).cotangent);';
  const trapped='export fn main = (xs:[Num]) -> map xs (x -> (vjp (y -> require false y) x 1).cotangent);';
  const nested=`export fn main = (xs:[Num]) -> map xs (x ->
    sum (map xs (w -> (vjp (y -> x*y+y*y) x w).cotangent)));`;
  for(const options of modes) {
    const c=compile(mapped,options);
    assert.equal(verifyCertificate(c.certificate.steps),true);
    assert.equal(c.observations.main.access,'indexed');
    assert.deepEqual(Array.from((await createRuntime(c)).call('main',[[1,2,3]])),[2,4,6]);
    const scan=compile(causal,options);
    assert.equal(scan.observations.main.access,'sequential');
    assert.deepEqual(Array.from((await createRuntime(scan)).call('main',[[1,2,3]])),[2,6,12]);
    assert.deepEqual(Array.from(await run(nested,[[1,2,3]],options)),[18,36,54]);
    assert.deepEqual(Array.from(await run(trapped,[[]],options)),[]);
    await assert.rejects(()=>run(trapped,[[1]],options),WebAssembly.RuntimeError);
  }
});

test('nonsmooth conventions follow selected primal paths without differentiating predicates',async()=>{
  const source=`export fn main = (x:Num) -> {
    absolute:(vjp abs x 2).cotangent,rounded:(vjp floor x 2).cotangent,
    lo:(vjp (y -> min y 2) x 2).cotangent,hi:(vjp (y -> max y 2) x 2).cotangent,
    stopped:(vjp (y -> y*stop_gradient y) x 2).cotangent,
    predicate:(vjp (y -> if y>0 then 7 else 8) x 2).cotangent
  };`;
  for(const options of modes) {
    const runtime=await createRuntime(compile(source,options));
    const z=runtime.call('main',[0]),n=runtime.call('main',[-3]),p=runtime.call('main',[2]);
    assert.equal(z.absolute,0);assert.equal(n.absolute,-2);assert.equal(p.absolute,2);
    assert.equal(p.lo,2);assert.equal(p.hi,2);assert.equal(p.rounded,0);
    assert.equal(p.stopped,4);assert.equal(p.predicate,0);
    assert.equal(runtime.call('main',[NaN]).absolute,0);
    assert.equal(await run('export fn main = () -> (vjp (max 2) 2 1).cotangent;',[{}],options),0);
  }
});

test('reverse f64 arithmetic has explicit zero, singularity, and structural-independence behavior',async()=>{
  const source=`export fn main = (x:Num) -> (w:Num) -> (k:Num) -> {
    identity:(vjp (y -> y) x w).cotangent,negative:(vjp (y -> -y) x w).cotangent,
    square:(vjp (y -> y*y) x w).cotangent,quotient:(vjp (y -> k/y) x w).cotangent
  };`;
  for(const options of modes) {
    const runtime=await createRuntime(compile(source,options));
    for(const x of [-0,0,2,-3,Infinity,-Infinity,NaN])for(const w of [-0,0,1,-2,Infinity,NaN]) {
      const k=5,r=runtime.call('main',[x,w,k]);
      assert.ok(Object.is(r.identity,w));assert.ok(Object.is(r.negative,-w));
      assert.ok(Object.is(r.square,w*x+w*x));
      assert.ok(Object.is(r.quotient,-(w*k)/(x*x)));
    }
    assert.ok(Number.isNaN(await run('export fn main = () -> (vjp sqrt 0 0).cotangent;',[{}],options)));
    const difference=await run(`export fn main = (x:Num) -> (c:Num) -> {
      reverse:(vjp (y -> y+c*c) x 1).cotangent,forward:grad (y -> y+c*c) x
    };`,[2,Infinity],options);
    assert.equal(difference.reverse,1);assert.ok(Number.isNaN(difference.forward));
  }
});

test('independent memory loads retain bounds demand and unsupported graphs require explicit stops',async()=>{
  for(const options of modes) {
    const source='export fn main = (xs:[Num]) -> (vjp (x -> (at xs 0)*x) 3 1).cotangent;';
    assert.equal(await run(source,[[7]],options),7);
    await assert.rejects(()=>run(source,[[]],options),WebAssembly.RuntimeError);
    await assert.rejects(()=>run('export fn main = (xs:[Num]) -> (vjp (x -> at xs 0) 3 1).cotangent;',[[]],options),WebAssembly.RuntimeError);
    assert.equal(await run('export fn main = () -> (vjp (x -> stop_gradient (sum (map (range 3) (i -> i*x)))) 3 1).cotangent;',[{}],options),0);
    assert.equal(await run('export fn main = () -> (vjp (x -> floor (sum (range x))) 3 1).cotangent;',[{}],options),0);
  }
});

test('performed values remain atomic across reverse sweeps, nested transforms, and product seeds',async()=>{
  const programs=[
    ['vjp (p -> {a:p.x*p.x,b:p.x*p.y}) {x:y,y:y} {a:2,b:3}',
      {value:{a:36,b:36},cotangent:{x:42,y:18}}],
    ['vjp (p -> p.x*y+p.y*stop_gradient y) {x,y:x} 2',
      {value:24,cotangent:{x:12,y:12}}],
    ['(vjp (z -> (vjp (w -> w*w*y) z 1).cotangent) x 1).cotangent',12],
  ];
  for(const options of modes)for(const [expression,expected] of programs) {
    const source=`host fn h: Num -> Num; export fn main = (x:Num) -> effect {let y=perform h x; ${expression}};`;
    let calls=0;
    const capability=createCapability({h:{parameters:['Num'],result:'Num',call:x=>{calls++;return x*3;}}},{maxCalls:1});
    assert.deepEqual((await createRuntime(compile(source,options))).call('main',[2],{capability}),expected);
    assert.equal(calls,1);assert.equal(capability.remaining,0);
  }
});

test('numeric, shape, authority, and unsupported-operation failures stay structured and source-local',()=>{
  const bad=[
    ['export fn main = () -> vjp (x -> 1) true 1;','E_DIFF_TYPE'],
    ['export fn main = () -> vjp (x -> true) 1 true;','E_DIFF_TYPE'],
    ['export fn main = () -> (vjp (x -> {a:x,b:false}) 1 {a:1,b:false}).cotangent;','E_DIFF_TYPE'],
    ['export fn main = () -> vjp (p -> p.a) {a:1,b:false} 1;','E_DIFF_TYPE'],
    ['export fn main = () -> vjp (x -> {a:x}) 1 {b:1};','E_TYPE'],
    ['export fn main = () -> vjp (x -> x) 1 false;','E_TYPE'],
    ['export fn main = () -> vjp (x -> x) 1 1 2;','E_TYPE'],
    ['export fn main = () -> (vjp (x -> 1) (range 3) 1).cotangent;','E_LOWER'],
    ['export fn main = () -> (vjp (x -> range 3) 1 (range 3)).cotangent;','E_LOWER'],
    ['export fn main = () -> (vjp (x -> y -> x+y) 1 (y -> y)).cotangent;','E_LOWER'],
    ['export fn main = (x:Num) -> vjp (y -> y*y) x;','E_ABI'],
    ['fn vjp = x -> x; export fn main = () -> vjp 1;','E_NAME'],
    ['host fn vjp: Num -> Num; export fn main = () -> 1;','E_NAME'],
    ['host fn h: Num -> Num; export fn main = (x:Num) -> vjp h x 1;','E_EFFECT'],
    ['export fn main = () -> (vjp (x -> sum (map (range 3) (i -> i*x))) 2 1).value;','E_DIFF_UNSUPPORTED'],
    ['export fn main = () -> (vjp (x -> if false then sum (range x) else x) 2 1).cotangent;','E_DIFF_UNSUPPORTED'],
    ['export fn main = () -> (vjp (x -> sum (scan (range 3) x (s -> i -> s+i))) 2 1).cotangent;','E_DIFF_UNSUPPORTED'],
    ['export fn main = (xs:[Num]) -> (vjp (x -> at xs x) 0 1).cotangent;','E_DIFF_CONTROL'],
    ['export fn main = (xs:[Num]) -> (vjp (x -> at xs (if x>0 then 0 else 1)) 0 1).cotangent;','E_DIFF_CONTROL'],
  ];
  for(const options of modes)for(const [source,code] of bad) {
    const files=[{name:'helper.ass',source:'fn id = x -> x;'},{name:'reverse.ass',source:'// fixture\n'+source}];
    const d=checkSources(files,options).diagnostics[0];
    assert.equal(d?.code,code,source);assert.equal(d.sourceName,'reverse.ass');
    assert.equal(d.range.start.line,2);
    assert.throws(()=>compileSources(files,options),e=>e.code===code&&e.sourceName===d.sourceName&&e.offset===d.range.start.offset);
  }
});

const wide=n=>`export fn main = (x:Num) -> vjp (p -> do {let witness=range 1;
  ${Array.from({length:n},(_,i)=>`p.f${i}*p.f${i}`).join('+')}
}) {${Array.from({length:n},(_,i)=>`f${i}:x`).join(',')}} 1;`;
test('one objective preparation and bounded graph growth replace input-coordinate enumeration',async()=>{
  let previous;
  for(const n of [16,32,64,96]) {
    const c=compile(wide(n));
    assert.equal(c.certificate.steps.filter(s=>s.rule==='source').length,1);
    assert.ok(c.stats.scalarNodes<60*n,`graph nodes for ${n} inputs`);
    if(previous)assert.ok(c.stats.scalarNodes/previous.nodes<1.1*n/previous.n);
    previous={n,nodes:c.stats.scalarNodes};
    const result=(await createRuntime(c)).call('main',[3]);
    assert.equal(result.value,9*n);
    assert.deepEqual(result.cotangent,Object.fromEntries(Array.from({length:n},(_,i)=>['f'+i,6])));
  }
  for(const options of modes)assert.equal(Object.keys((await run(wide(65),[2],options)).cotangent).length,65);
});

test('scalar expansion limits still apply to reverse graphs',()=>{
  assert.equal(check(wide(16),{maxExpansion:40}).diagnostics[0].code,'E_LIMIT');
  const source='export fn main = (x:Num) -> (vjp (y -> y*y*y*y*y) x 1).cotangent;';
  assert.equal(check(source,{maxExpansion:20}).diagnostics[0].code,'E_LIMIT');
});

test('nested transform roots are erased before scalar emission',()=>{
  const source='export fn main = (x:Num) -> grad (y -> (vjp (z -> y*z*z) y 1).cotangent) x;';
  const program=parse(source),staged=stage(program,infer(program)),seen=new Set();
  function visit(n) {
    if(n.kind==='record') {for(const v of n.fields.values())visit(v);return;}
    if(seen.has(n.id))return;seen.add(n.id);
    assert.equal(n.data?.differentialSeed,undefined);
    for(const a of n.args)visit(a);
  }
  visit(staged.kernels[0].result);
});

test('linked legacy helpers and compiler sessions preserve snapshot isolation',async()=>{
  const files=[{name:'legacy.ass',source:'fn square(x)=x*x;'},
    {name:'reverse.ass',source:'export fn main = (x:Num) -> vjp square x 2;'}];
  const compiler=createCompiler(),first=compiler.compileSources(files),second=compiler.compileSources(files);
  assert.deepEqual(first.bytes,second.bytes);first.bytes.fill(0);
  assert.ok(WebAssembly.validate(compiler.compileSources(files).bytes));
  assert.deepEqual((await createRuntime(second)).call('main',[3]),{value:9,cotangent:12});
});

test('the documented weighted sensitivity example executes in every configuration',async()=>{
  const doc=await readFile(new URL('../docs/VJP.md',import.meta.url),'utf8');
  const source=doc.match(/```ass\n([\s\S]*?)\n```/)[1];
  for(const options of modes)
    assert.deepEqual((await createRuntime(compile(source,options))).call('weighted_sensitivity',[{x:2,y:4}]),{
      value:{energy:28,balance:-2},cotangent:{x:37,y:7},
    });
});
