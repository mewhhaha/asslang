import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile,compileSources,check,checkSources,createCompiler} from '../src/compiler.mjs';
import {createRuntime,createCapability} from '../src/abi.mjs';

const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const run=async(source,args,options={})=>(await createRuntime(compile(source,options))).call('main',args);
const polynomial=`export fn main = (p:{x:Num,y:Num,z:Num}) -> (a:Num) -> (b:Num) ->
  value_and_grad (q -> a*q.x*q.x*q.x+b*q.x*q.y+2*q.y*q.y+q.x*q.z-q.z) p;`;
const value=(p,a,b)=>a*p.x*p.x*p.x+b*p.x*p.y+2*p.y*p.y+p.x*p.z-p.z;
const gradient=(p,a,b)=>({x:3*a*p.x*p.x+b*p.y+p.z,y:b*p.x+4*p.y,z:p.x-1});

for(const options of modes)test(`gradient analytic and finite-difference checks ${JSON.stringify(options)}`,async()=>{
  const compiled=compile(polynomial,options),runtime=await createRuntime(compiled);
  assert.equal(compiled.stats.kernelHeapAllocationSites,0);
  assert.equal(compiled.stats.intermediateBufferBytes,0);
  let seed=173;
  const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<100;i++) {
    const p={z:random()%17-8,y:random()%19-9,x:random()%21-10},a=i%7-3,b=i%5-2;
    const actual=runtime.call('main',[p,a,b]),expected=gradient(p,a,b);
    assert.equal(actual.value,value(p,a,b));
    for(const key of ['x','y','z']) {
      // Algebraically factored analytic values need not preserve a zero sign.
      assert.ok(actual.gradient[key]===expected[key],`${key}: analytic case ${i}`);
      const h=1e-4,plus={...p,[key]:p[key]+h},minus={...p,[key]:p[key]-h};
      assert.ok(Math.abs(actual.gradient[key]-(value(plus,a,b)-value(minus,a,b))/(2*h))<1e-4,
        `${key}: finite-difference case ${i}`);
    }
  }
});

test('gradient shapes preserve nested records, tuples, empty fields and lexical field order',async()=>{
  const source=`export fn main = (x:Num) -> value_and_grad
    (p -> p.z*p.a._0+p.a._1.inner*p.a._1.inner)
    {z:x,a:(x,{inner:x,empty:()})};`;
  for(const options of modes)assert.deepEqual(await run(source,[3],options),{
    value:18,gradient:{z:3,a:{_0:3,_1:{inner:6,empty:{}}}},
  });
  const tuple=Array.from({length:12},(_,i)=>i+1).join(',');
  const expected=Object.fromEntries(Array.from({length:12},(_,i)=>['_'+i,i===2?11:i===10?3:0]));
  assert.deepEqual(await run(`export fn main = () -> grad (p -> p._2*p._10) (${tuple});`,[{}]),expected);
});

test('nested gradients and JVPs retain separate perturbations and captures',async()=>{
  for(const options of modes) {
    assert.equal(await run('export fn main = (x:Num) -> grad (grad (grad (y -> y*y*y*y))) x;',[3],options),72);
    assert.equal(await run('export fn main = (x:Num) -> grad (y -> (jvp (z -> y*z) y 1).tangent) x;',[3],options),1);
    assert.equal(await run('export fn main = (x:Num) -> grad (y -> grad (z -> y*z) y) x;',[3],options),1);
    assert.equal(await run('export fn main = (x:Num) -> grad (y -> (value_and_grad (z -> y*z) y).value) x;',[3],options),6);
    assert.equal(await run('export fn main = (x:Num) -> grad (y -> x*y) x;',[3],options),3);
  }
});

for(const options of modes)test(`Hessian-vector products ${JSON.stringify(options)}`,async()=>{
  const source=`export fn main = (p:{x:Num,y:Num}) -> (v:{x:Num,y:Num}) ->
    jvp (grad (q -> q.x*q.x*q.x+q.x*q.y+2*q.y*q.y)) p v;`;
  const runtime=await createRuntime(compile(source,options));
  for(let i=0;i<50;i++) {
    const p={x:i%9-4,y:i%7-3},v={x:i%5-2,y:i%11-5};
    const actual=runtime.call('main',[p,v]);
    assert.ok(actual.value.x===3*p.x*p.x+p.y);
    assert.ok(actual.value.y===p.x+4*p.y);
    assert.ok(actual.tangent.x===6*p.x*v.x+v.y);
    assert.ok(actual.tangent.y===v.x+4*v.y);
  }
});

test('partial intrinsics, polymorphic helpers, builtin objectives and finite callable choices',async()=>{
  const source=`fn differentiate = f -> grad f;
    export fn main = (b:Bool) -> (x:Num) -> do {
      let policy=if b then (y -> y*y) else (y -> 3*y);
      let both=value_and_grad policy;
      {scalar:differentiate policy x,product:differentiate (p -> p.a*p.b) {a:x,b:x},both:both x}
    };`;
  for(const options of modes)for(const b of [false,true])assert.deepEqual(await run(source,[b,3],options),{
    scalar:b?6:3,product:{a:3,b:3},both:{value:9,gradient:b?6:3},
  });
  assert.equal(await run('export fn main = (x:Num) -> grad (max 2) x;',[3]),1);
  assert.equal(await run('export fn main = (x:Num) -> grad (max 2) x;',[2]),0);
});

test('gradients inside stream callbacks and causal transitions preserve empty-stream demand',async()=>{
  for(const options of modes) {
    const source='export fn main = (xs:[Num]) -> scan xs 0 (s -> x -> (grad (p -> p.a*p.b+p.b*p.b) {a:s,b:x}).b);';
    assert.deepEqual(Array.from(await run(source,[[1,2,3]],options)),[2,6,12]);
    const trapped='export fn main = (xs:[Num]) -> map xs (grad (x -> require false x));';
    assert.deepEqual(Array.from(await run(trapped,[[]],options)),[]);
    await assert.rejects(()=>run(trapped,[[1]],options),WebAssembly.RuntimeError);
    assert.deepEqual(Array.from(await run('export fn main = (xs:[Num]) -> map xs (grad (x -> x*x));',[[1,2,3]],options)),[2,4,6]);
  }
});

test('constant and unused-coordinate derivatives retain primal contracts',async()=>{
  const expressions=[
    'grad (x -> require false 7) 2',
    '(value_and_grad (x -> require false 7) 2).gradient',
    '(grad (p -> require false p.x) {x:2,y:3}).y',
    'grad (x -> floor (require false x)) 2',
    'grad (x -> stop_gradient (require false x)) 2',
    'grad (require false (x -> x*x)) 2',
  ];
  for(const options of modes)for(const expression of expressions)
    await assert.rejects(()=>run(`export fn main = () -> ${expression};`,[{}],options),WebAssembly.RuntimeError);
});

test('inactive branches, unused bindings and unused input fields remain lazy',async()=>{
  for(const options of modes) {
    assert.equal(await run('export fn main = (x:Num) -> grad (y -> if y>0 then y*y else require false y) x;',[3],options),6);
    assert.equal(await run('export fn main = () -> do {let unused=grad (x -> require false x) 2; 7};',[{}],options),7);
    assert.equal(await run('export fn main = () -> (grad (p -> p.x*p.x) {x:3,bad:require false 4}).x;',[{}],options),6);
    assert.equal(await run('export fn main = () -> (value_and_grad (x -> 7) (require false 2)).value;',[{}],options),7);
  }
});

test('gradient pathwise conventions and stop-gradient agree with declared rules',async()=>{
  const source=`export fn main = (x:Num) -> {
    absolute:grad abs x,rounded:grad floor x,lo:grad (y -> min y 2) x,
    hi:grad (y -> max y 2) x,root:grad (y -> sqrt (y*y+1)) x,
    ratio:grad (y -> y/(y+5)) x,stopped:grad (y -> y*stop_gradient y) x,
    nested:grad (grad (y -> y*stop_gradient y)) x
  };`;
  for(const options of modes) {
    const zero=await run(source,[0],options);
    assert.equal(zero.absolute,0);assert.equal(zero.rounded,0);
    const two=await run(source,[2],options);
    assert.equal(two.lo,1);assert.equal(two.hi,1);
    assert.ok(Math.abs(two.root-2/Math.sqrt(5))<1e-15);
    assert.ok(Math.abs(two.ratio-5/49)<1e-15);
    assert.equal(two.stopped,2);assert.equal(two.nested,0);
  }
});

test('exceptional f64 coordinate derivatives preserve explicit unit-basis JVP behavior',async()=>{
  const source=`fn f = p -> p.x*p.y+p.x/p.y;
    export fn main = (x:Num) -> (y:Num) -> do {
      let p={x,y};
      {g:grad f p,x:(jvp f p {x:1,y:0}).tangent,y:(jvp f p {x:0,y:1}).tangent}
    };`;
  for(const options of modes) {
    const r=await createRuntime(compile(source,options));
    for(const x of [-0,0,1,-1,Infinity,-Infinity,NaN])for(const y of [-0,0,2,Infinity,NaN]) {
      const actual=r.call('main',[x,y]);
      assert.ok(Object.is(actual.g.x,actual.x));assert.ok(Object.is(actual.g.y,actual.y));
    }
    const identity=await run('export fn main = (x:Num) -> value_and_grad (y -> y) x;',[-0],options);
    assert.ok(Object.is(identity.value,-0));assert.equal(identity.gradient,1);
  }
});

test('independent memory reads retain demand and active addressing is rejected',async()=>{
  const source='export fn main = (xs:[Num]) -> (x:Num) -> grad (y -> (at xs 0)*y) x;';
  for(const options of modes) {
    assert.equal(await run(source,[[7],3],options),7);
    await assert.rejects(()=>run(source,[[],3],options),WebAssembly.RuntimeError);
    await assert.rejects(()=>run('export fn main = (xs:[Num]) -> (x:Num) -> grad (y -> at xs 0) x;',[[],3],options),WebAssembly.RuntimeError);
    assert.equal(check('export fn main = (xs:[Num]) -> (x:Num) -> grad (y -> at xs y) x;',options).diagnostics[0].code,'E_DIFF_CONTROL');
  }
});

test('performed results are reused once across coordinates, nesting and stop-gradient',async()=>{
  const expressions=[
    ['value_and_grad (p -> p.a*p.a+p.a*p.b) {a:y,b:y}',{value:72,gradient:{a:18,b:6}}],
    ['grad (p -> p.a*y+p.b*stop_gradient y) {a:x,b:x}',{a:6,b:6}],
    ['grad (grad (z -> z*z*y)) x',12],
  ];
  for(const options of modes)for(const [expression,expected] of expressions) {
    const source=`host fn h: Num -> Num; export fn main = (x:Num) -> effect {
      let y=perform h x; ${expression}
    };`;
    let calls=0;
    const capability=createCapability({h:{parameters:['Num'],result:'Num',call:x=>{calls++;return x*3;}}},{maxCalls:1});
    const r=await createRuntime(compile(source,options));
    assert.deepEqual(r.call('main',[2],{capability}),expected);
    assert.equal(calls,1);assert.equal(capability.remaining,0);
  }
});

test('gradient inference and staging failures remain structured, source-local diagnostics',()=>{
  const bad=[
    ['grad (x -> 1) true','E_DIFF_TYPE'],
    ['grad (p -> p.x) {x:1,bad:false}','E_DIFF_TYPE'],
    ['grad (x -> 1) ()','E_DIFF_TYPE'],
    ['value_and_grad (x -> 1) {empty:()}','E_DIFF_TYPE'],
    ['grad (x -> {x}) 1','E_TYPE'],
    ['value_and_grad (x -> true) 1','E_TYPE'],
    ['grad (x -> y -> x+y) 1','E_TYPE'],
    ['grad (x -> sum (map (range 3) (i -> i*x))) 1','E_DIFF_UNSUPPORTED'],
    ['value_and_grad (x -> sum (scan (range 3) x (s -> i -> s+i))) 1','E_DIFF_UNSUPPORTED'],
    ['grad (x -> 1) (range 3)','E_LOWER'],
  ];
  for(const options of modes)for(const [expression,code] of bad) {
    const source='// gradient fixture\nexport fn main = () -> '+expression+';';
    const files=[{name:'helpers.ass',source:'fn id = x -> x;'},{name:'gradient.ass',source}];
    const d=checkSources(files,options).diagnostics[0];
    assert.equal(d.code,code,expression);assert.equal(d.sourceName,'gradient.ass');
    assert.equal(d.range.start.line,2);
    assert.ok(d.range.start.offset>=source.indexOf('->')&&d.range.start.offset<source.length);
    assert.throws(()=>compileSources(files,options),e=>e.code===code&&e.sourceName==='gradient.ass'&&e.offset===d.range.start.offset);
  }
});

const wideSource=n=>`export fn main = (x:Num) -> grad (p -> p.f0+2*p.f${n-1})
  {${Array.from({length:n},(_,i)=>`f${i}:x`).join(',')}};`;
test('64 independent input leaves work and 65 fail before derivative expansion',async()=>{
  for(const options of modes) {
    const result=await run(wideSource(64),[3],options);
    assert.deepEqual(result,Object.fromEntries(Array.from({length:64},(_,i)=>[`f${i}`,i===0?1:i===63?2:0])));
    const d=checkSources([{name:'wide.ass',source:wideSource(65)}],options).diagnostics[0];
    assert.equal(d.code,'E_LIMIT');assert.match(d.message,/64 input leaves/);
    assert.equal(d.sourceName,'wide.ass');assert.equal(d.range.start.line,1);
    // This cap is separate from the ordinary scalar node budget.
    assert.equal(check(wideSource(65),{...options,maxExpansion:1_000_000}).diagnostics[0].code,'E_LIMIT');
  }
});

test('existing expansion limits, compiler sessions and linked legacy helpers remain supported',async()=>{
  assert.throws(()=>compile(polynomial,{maxExpansion:40}),e=>e.code==='E_LIMIT');
  const files=[{name:'legacy.ass',source:'fn square(x)=x*x;'},
    {name:'gradient.ass',source:'export fn main = (x:Num) -> value_and_grad square x;'}];
  const compiler=createCompiler(),first=compiler.compileSources(files),second=compiler.compileSources(files);
  assert.deepEqual(first.bytes,second.bytes);
  first.bytes.fill(0);assert.ok(WebAssembly.validate(compiler.compileSources(files).bytes));
  assert.deepEqual((await createRuntime(second)).call('main',[3]),{value:9,gradient:6});
});

test('the documented quadratic update executes and rejects negative step sizes',async()=>{
  const doc=await readFile(new URL('../docs/GRADIENTS.md',import.meta.url),'utf8');
  const source=doc.match(/```ass\n([\s\S]*?)\n```/)[1];
  for(const options of modes) {
    const runtime=await createRuntime(compile(source,options));
    assert.deepEqual(runtime.call('step',[{x:5,y:2},0.25]),{value:22,gradient:{x:4,y:12},next:{x:4,y:-1}});
    assert.throws(()=>runtime.call('step',[{x:5,y:2},-1]),WebAssembly.RuntimeError);
  }
});
