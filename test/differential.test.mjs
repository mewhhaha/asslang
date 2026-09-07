import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileSources,check,createCompiler} from '../src/compiler.mjs';
import {createRuntime,createCapability} from '../src/abi.mjs';
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const run=async(source,args,options={})=>(await createRuntime(compile(source,options))).call('main',args);
for(const options of modes)test(`automatic JVP analytic and finite-difference checks ${JSON.stringify(options)}`,async()=>{
  const source=`export fn main = (x:Num) -> (a:Num) -> (b:Num) -> (v:Num) ->
    jvp (y -> a*y*y*y+b*y*y+7*y-2) x v;`;
  const r=await createRuntime(compile(source,options));let seed=71;
  for(let i=0;i<100;i++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const x=(seed%31)-15,a=i%7-3,b=i%5-2,v=i%3-1;
    const out=r.call('main',[x,a,b,v]);
    assert.equal(out.value,a*x*x*x+b*x*x+7*x-2);
    assert.ok(out.tangent===(3*a*x*x+2*b*x+7)*v); // Algebraic comparison treats signed zeros alike.
    const f=y=>a*y*y*y+b*y*y+7*y-2,h=1e-4;
    assert.ok(Math.abs(out.tangent-(f(x+h*v)-f(x-h*v))/(2*h))<1e-4);
  }
});
test('nested differentiation does not capture an outer perturbation through an equal primal',async()=>{
  const source=`export fn main = (x:Num) -> jvp (y ->
    (jvp (z -> y*z) y 1).tangent) x 1;`;
  assert.deepEqual(await run(source,[3]),{value:3,tangent:1});
  const third=`fn f = x -> x*x*x*x; fn d = f -> x -> (jvp f x 1).tangent;
    export fn main = (x:Num) -> d (d (d f)) x;`;
  assert.equal(await run(third,[3]),72);
});
test('derivatives through selected callables and lexical record fields',async()=>{
  const source=`export fn main = (b:Bool) -> (x:Num) ->
    jvp (if b then (y -> {a:y*y,b:y+1}) else (y -> {a:3*y,b:y/2})) x 2;`;
  assert.deepEqual(await run(source,[true,3]),{value:{a:9,b:4},tangent:{a:12,b:2}});
  assert.deepEqual(await run(source,[false,3]),{value:{a:9,b:1.5},tangent:{a:6,b:1}});
});
test('declared nonsmooth pathwise conventions and elementary rules',async()=>{
  const s=`export fn main = (x:Num) -> jvp (y ->
    {a:abs y,f:floor y,lo:min y 2,hi:max y 2,root:sqrt (y*y+1),ratio:y/(y+5)}) x 1;`;
  const at0=await run(s,[0]);assert.equal(at0.tangent.a,0);assert.equal(at0.tangent.f,0);
  const at2=await run(s,[2]);assert.equal(at2.tangent.lo,1);assert.equal(at2.tangent.hi,1);
  assert.ok(Math.abs(at2.tangent.root-2/Math.sqrt(5))<1e-15);
  assert.ok(Math.abs(at2.tangent.ratio-5/49)<1e-15);
});
test('stop_gradient blocks nested derivatives without suppressing primal contracts',async()=>{
  assert.equal(await run(`fn d=f -> x -> (jvp f x 1).tangent;
    export fn main = (x:Num) -> d (d (y -> y*stop_gradient y)) x;`,[3]),0);
  await assert.rejects(()=>run('export fn main = () -> (jvp (x -> stop_gradient (require false x)) 2 1).tangent;',[{}]),WebAssembly.RuntimeError);
});
test('JVP is usable inside causal transitions with event-local captures',async()=>{
  const source=`export fn main = (xs:[Num]) -> scan xs 0 (s -> x ->
    (jvp (y -> s*y+y*y) x 1).tangent);`;
  for(const options of modes)assert.deepEqual(Array.from(await run(source,[[1,2,3]],options)),[2,6,12]);
});
test('undemanded output fields do not acquire another field\'s primal trap',async()=>{
  const source='export fn main = (x:Num) -> (jvp (y -> {safe:y*y,bad:require false y}) x 1).tangent.safe;';
  assert.equal(await run(source,[3]),6);
});
test('active memory addresses are rejected and independent loads are constants',async()=>{
  assert.equal(await run('export fn main = (xs:[Num]) -> (x:Num) -> (jvp (y -> (at xs 0)*y) x 1).tangent;',[[7],3]),7);
  const source='export fn main = (xs:[Num]) -> (x:Num) -> jvp (y -> at xs y) x 1;';
  assert.equal(check(source).diagnostics[0].code,'E_DIFF_CONTROL');
  assert.throws(()=>compileSources([{name:'diff.ass',source}]),e=>e.code==='E_DIFF_CONTROL'&&e.sourceName==='diff.ass'&&e.offset>0);
});
test('differentiation respects compiler sessions, source linking and expansion limits',()=>{
  const source='export fn main = (x:Num) -> jvp (y -> y*y*y*y*y) x 1;';
  assert.throws(()=>compile(source,{maxExpansion:20}),e=>e.code==='E_LIMIT');
  const c=createCompiler();assert.deepEqual(c.compile(source).bytes,c.compile(source).bytes);
  assert.equal(check('export fn main = () -> jvp (x -> x.a) {a:1} {a:true};').diagnostics[0].code,'E_TYPE');
});

test('JVP preserves the signed zero of its generated derivative expression',async()=>{
  assert.ok(Object.is((await run('export fn main = (x:Num) -> jvp (y -> -y) x 0;',[2])).tangent,-0));
  const identity=await run('export fn main = (x:Num) -> (v:Num) -> jvp (y -> y) x v;',[-0,-0]);
  assert.ok(Object.is(identity.value,-0));assert.ok(Object.is(identity.tangent,-0));
});

test('performed results remain atomic through AD substitution and stop-gradient',async()=>{
  for(const options of modes)for(const [expression,expected] of [
    ['(jvp (z -> z*z) y 1).tangent',12],
    ['(jvp (z -> z*y) x 1).tangent',6],
    ['(jvp (z -> z*stop_gradient y) x 1).tangent',6],
  ]) {
    const source=`host fn h: Num -> Num; export fn main = (x:Num) -> effect {
      let y=perform h x; ${expression}
    };`;
    let calls=0;
    const capability=createCapability({h:{parameters:['Num'],result:'Num',call:x=>{calls++;return x*3;}}},{maxCalls:1});
    const runtime=await createRuntime(compile(source,options));
    assert.equal(runtime.call('main',[2],{capability}),expected);
    assert.equal(calls,1);assert.equal(capability.remaining,0);
  }
});
