import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compileSources,checkSources,createCompiler,instantiate,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime,Arena,prepareCall} from '../src/abi.mjs';
import {reference} from './reference.mjs';
import {operatorCalibrationSource} from '../examples/case-studies/operators/calibration-kernel.mjs';
const libraries=await Promise.all(['lib/operators.ass','lib/krylov.ass'].map(async name=>({name,source:await readFile(new URL('../'+name,import.meta.url),'utf8')})));
const files=source=>[...libraries,{name:'client.ass',source}];
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const close=(a,b,tol=1e-9)=>assert(Math.abs(a-b)<=tol*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const matvec=(a,x)=>a.map(row=>dot(row,x));
const transpose=a=>a[0].map((_,i)=>a.map(row=>row[i]));
const norm=x=>dot(x,x);
const sourceFixture=async name=>readFile(new URL(`../examples/case-studies/operators/${name}.ass`,import.meta.url),'utf8');
const chainSource=`
  fn first = p -> {a:2*p.x-p.y,b:p.x+3*p.y,c:p.x-p.y};
  fn second = p -> {u:p.a*p.a+p.b,v:p.c*p.b};
  export fn main = (point:{x:Num,y:Num}) -> (v:{x:Num,y:Num}) -> (w:{u:Num,v:Num}) -> do {
    let {value,linear}=operator_at first point |> operator_chain second;
    let normal=operator_normal linear;
    {value,forward:linear.apply v,back:linear.adjoint w,normal:normal.apply v}
  };`;

for(const mode of modes)test(`rectangular nonlinear composition and dense oracle ${JSON.stringify(mode)}`,async()=>{
  const c=compileSources(files(chainSource),mode),r=await createRuntime(c);
  assert.equal(c.stats.intermediateBufferBytes,0);assert.equal(c.abi.version,1);
  assert.equal(c.stats.functions[0].loops,0);assert(verifyCertificate(c.certificate.steps));
  assert(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)).every(i=>i.kind==='memory'));
  const result=r.call('main',[{x:2,y:1},{x:1,y:2},{u:3,v:-1}]);
  assert.deepEqual(result,{value:{u:14,v:5},forward:{u:7,v:2},back:{x:33,y:-7},normal:{x:103,y:-25}});
  let seed=951;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<40;i++){
    const p={x:(rand()%17-8)/4,y:(rand()%17-8)/4};
    const v=[(rand()%9-4)/2,(rand()%9-4)/2],w=[(rand()%9-4)/2,(rand()%9-4)/2];
    const q={a:2*p.x-p.y,b:p.x+3*p.y,c:p.x-p.y};
    const j=[[4*q.a+1,-2*q.a+3],[q.b+q.c,-q.b+3*q.c]];
    const got=r.call('main',[p,{x:v[0],y:v[1]},{u:w[0],v:w[1]}]);
    const f=matvec(j,v),b=matvec(transpose(j),w),n=matvec(transpose(j),f);
    [got.forward.u,got.forward.v].forEach((x,i)=>close(x,f[i]));
    [got.back.x,got.back.y].forEach((x,i)=>close(x,b[i]));
    [got.normal.x,got.normal.y].forEach((x,i)=>close(x,n[i]));
    close(dot(f,w),dot(v,b));close(dot(v,n),norm(f));
    const evalAt=t=>{const x=p.x+t*v[0],y=p.y+t*v[1],a=2*x-y,b=x+3*y,c=x-y;return [a*a+b,c*b];};
    const h=1e-5,plus=evalAt(h),minus=evalAt(-h);
    f.forEach((x,i)=>close(x,(plus[i]-minus[i])/(2*h),1e-7));
  }
});

test('identity, transposition, associativity and block products compose in ordinary source',async()=>{
  const source=`export fn main = (x:Num) -> do {
    let a={apply:x -> 2*x,adjoint:x -> 2*x};
    let b={apply:x -> 3*x,adjoint:x -> 3*x};
    let c={apply:x -> 5*x,adjoint:x -> 5*x};
    let lhs=operator_then (operator_then a b) c;
    let rhs=operator_then a (operator_then b c);
    let twice=operator_transpose (operator_transpose lhs);
    let id=operator_then lhs (operator_identity ());
    let reverse=operator_then (operator_transpose c) (operator_transpose (operator_then a b));
    let product=operator_product a (operator_product b c);
    {a:lhs.apply x,b:rhs.apply x,c:twice.apply x,d:id.apply x,e:reverse.apply x,
      pair:product.apply {left:x,right:{left:x,right:x}},
      back:product.adjoint {left:x,right:{left:x,right:x}}}
  };`;
  for(const mode of modes){
    const r=await createRuntime(compileSources(files(source),mode));
    const got=r.call('main',[2]);
    assert.deepEqual(got,{a:60,b:60,c:60,d:60,e:60,pair:{left:4,right:{left:6,right:10}},back:{left:4,right:{left:6,right:10}}});
  }
});

test('nonlinear stage point differs observably from composing derivatives at an unrelated point',async()=>{
  const s=`export fn main = (x:Num) -> do {
    let first=operator_at (x -> x*x) x;
    let chain=operator_chain first (x -> x*x);
    let wrong=operator_then first.linear (operator_at (x -> x*x) x).linear;
    {correct:chain.linear.apply 1,wrong:wrong.apply 1}
  };`;
  const r=await createRuntime(compileSources(files(s)));
  assert.deepEqual(r.call('main',[3]),{correct:108,wrong:36});
});

test('rectangular block products infer distinct domains and codomains',async()=>{
  const s=`export fn main = () -> do {
    let a=(operator_at (x -> {u:x*x,v:3*x}) 2).linear;
    let b=(operator_at (p -> p.x+2*p.y) {x:1,y:2}).linear;
    let both=operator_product a b;
    {forward:both.apply {left:2,right:{x:3,y:4}},
     back:both.adjoint {left:{u:2,v:3},right:5}}
  };`;
  assert.deepEqual((await createRuntime(compileSources(files(s)))).call('main',[{}]),
    {forward:{left:{u:8,v:6},right:11},back:{left:17,right:{x:5,y:10}}});
});

test('source definitions need no new primitive or privileged names; explicit core-only linkage works',async()=>{
  const source=await sourceFixture('product_solve');
  const normal=compileSources(files(source));
  const explicit=compileSources(files(source),{prelude:false});
  assert.deepEqual(normal.bytes,explicit.bytes);
  const names=['operator_identity','operator_then','operator_transpose','operator_product','operator_normal','operator_shift','operator_at','operator_chain','krylov_finite','scalar_vector','vector_product','cg_solve'];
  const rename=text=>names.reduce((s,n)=>s.replaceAll(new RegExp(`\\b${n}\\b`,'g'),`private_${n}`),text);
  const renamed=compileSources(files(source).map(f=>({...f,source:rename(f.source)})),{prelude:false});
  assert.deepEqual(normal.bytes,renamed.bytes);
  assert.deepEqual(normal.abi,renamed.abi);assert.deepEqual(normal.certificate,renamed.certificate);
});

for(const mode of modes)test(`matrix-free damped calibration and exact iteration allowance ${JSON.stringify(mode)}`,async()=>{
  const c=compileSources(files(operatorCalibrationSource),{...mode,maxLoopIterations:2});
  assert.equal(c.stats.functions[0].loops,1);assert.equal(c.stats.intermediateBufferBytes,0);
  const r=await createRuntime(c);
  const args=[[0,1,2],[1,3,5],{gain:0,bias:0},1];
  const got=r.call('calibration_step',args,{outputBytes:0});
  close(got.solution.gain,5/3);close(got.solution.bias,1);
  assert(got.converged&&!got.breakdown);assert.equal(got.iterations,2);assert(got.residualSquared<=1e-20);
  // Independent 2x2 system: damping penalizes the correction, not the final point.
  for(const [xs,ys,p,lambda] of [args, [[-1,0,2],[2,4,-1],{gain:0.5,bias:1},0.25]]){
    const residual=xs.map((x,i)=>p.gain*x+p.bias-ys[i]);
    const aa=dot(xs,xs)+lambda,ab=xs.reduce((a,b)=>a+b,0),bb=3+lambda;
    const u=-dot(xs,residual),v=-residual.reduce((a,b)=>a+b,0),det=aa*bb-ab*ab;
    const actual=r.call('calibration_step',[xs,ys,p,lambda]);
    close(actual.solution.gain,(u*bb-v*ab)/det);
    close(actual.solution.bias,(v*aa-u*ab)/det);
  }
  const small=await createRuntime(compileSources(files(operatorCalibrationSource),{...mode,maxLoopIterations:1}));
  assert.throws(()=>small.call('calibration_step',args),WebAssembly.RuntimeError);
  for(const bad of [[[],[],{gain:0,bias:0},1],[[0,1,2],[1,3,5],{gain:0,bias:0},0],[[0,1,2],[1,NaN,5],{gain:0,bias:0},1]])
    assert.throws(()=>r.call('calibration_step',bad),WebAssembly.RuntimeError);
  assert(r.call('calibration_step',args).converged);
});

const scalarSolve=`export fn main = (a:Num) -> (rhs:Num) -> (initial:Num) ->
 (tolerance:Num) -> (maxSteps:Num) -> cg_solve (x -> a*x) (scalar_vector ()) rhs initial {tolerance,maxSteps};`;
test('CG reports zero work, bounded nonconvergence and numerical breakdown without invented success',async()=>{
  for(const mode of modes){
    const r=await createRuntime(compileSources(files(scalarSolve),mode));
    const zero=r.call('main',[2,0,0,1e-8,16]);assert.equal(zero.iterations,0);assert(zero.converged);
    const solved=r.call('main',[2,6,3,1e-8,16]);assert.equal(solved.iterations,0);assert(solved.converged);
    const capped=r.call('main',[2,6,0,1e-8,0]);assert(!capped.converged&&!capped.breakdown);assert.equal(capped.iterations,0);assert.equal(capped.solution,0);
    for(const a of [-1,0]){
      const b=r.call('main',[a,1,0,1e-8,16]);assert(b.breakdown&&!b.converged);assert.equal(b.iterations,1);assert.equal(b.solution,0);
    }
    for(const [tol,limit] of [[0,3],[-1,3],[NaN,3],[Infinity,3],[1e-200,3],[1e200,3],[1e-8,-1],[1e-8,1.5],[1e-8,257],[1e-8,NaN]])
      assert.throws(()=>r.call('main',[2,0,0,tol,limit]),WebAssembly.RuntimeError);
    assert.throws(()=>r.call('main',[2,NaN,0,1e-8,3]),WebAssembly.RuntimeError);
    assert.throws(()=>r.call('main',[2,1,Infinity,1e-8,3]),WebAssembly.RuntimeError);
    assert(r.call('main',[2,6,0,1e-8,3]).converged);
  }
});

test('the returned residual is recomputed, not copied from the recurrence',async()=>{
  const source=await sourceFixture('product_solve');
  const r=await createRuntime(compileSources(files(source)));
  const result=r.call('product_solve',[{left:4,right:18}]);
  const residual=[4-4*result.solution.left,18-9*result.solution.right];
  assert.equal(result.residualSquared,norm(residual));
  assert.notEqual(result.residualSquared,result.recurrenceResidualSquared);
});

test('one source action per CG iteration shares a nested reduction and the global budget',async()=>{
  const source=`export fn main = (n:Num) -> cg_solve
    (x -> x * sum (range n)) (scalar_vector ()) 6 0 {tolerance:1e-8,maxSteps:4};`;
  for(const mode of modes){
    // Initial action + one search direction + true-residual action, each 3 steps.
    // Three distinct source calls; one additional iterate step.
    const r=await createRuntime(compileSources(files(source),{...mode,maxLoopIterations:10}));
    const result=r.call('main',[3]);assert(result.converged);close(result.solution,2);assert.equal(result.iterations,1);
    const s=await createRuntime(compileSources(files(source),{...mode,maxLoopIterations:9}));
    assert.throws(()=>s.call('main',[3]),WebAssembly.RuntimeError);
  }
});

test('captured source operator action composes with block resets and output fusion',async()=>{
  const source=await sourceFixture('operator_blocks'),xs=[1,2,3,4,5,6,7];
  for(const mode of modes){
    const limit=mode.reductionFusion?7:14;
    const c=compileSources(files(source),{...mode,maxLoopIterations:limit});
    assert.equal(c.stats.functions[0].loops,mode.reductionFusion?1:2);
    assert.equal(c.stats.intermediateBufferBytes,0);
    const r=await createRuntime(c),got=r.call('operator_blocks',[xs,3],{outputBytes:112});
    assert.deepEqual([...got.local],[4,12,24,16,36,60,28]);
    assert.deepEqual([...got.correction],[3,10,21,12,31,54,21]);
    assert.deepEqual({local:[...got.local],correction:[...got.correction]},reference(libraries.map(x=>x.source).join('\n')+'\n'+source,'operator_blocks',[xs,3]));
    assert.throws(()=>r.call('operator_blocks',[xs,3],{outputBytes:111}),WebAssembly.RuntimeError);
    assert.deepEqual([...r.call('operator_blocks',[[],3],{outputBytes:0}).local],[]);
    const short=await createRuntime(compileSources(files(source),{...mode,maxLoopIterations:limit-1}));
    assert.throws(()=>short.call('operator_blocks',[xs,3]),WebAssembly.RuntimeError);
  }
});

test('operator scopes, unsupported AD, authority and source-local errors remain explicit',async()=>{
  const bad='export fn main = () -> (operator_at (x -> missing x) 1).value;';
  const d=checkSources(files(bad)).diagnostics[0];
  assert.equal(d.code,'E_NAME');assert.equal(d.sourceName,'client.ass');assert.equal(d.range.start.offset,bad.indexOf('missing'));
  for(const source of [
    'export fn main = () -> (operator_at (x -> x*x) 1).linear.apply true;',
    'export fn main = () -> (operator_then {apply:x -> x+1,adjoint:x -> x+1} {apply:p -> p.x,adjoint:x -> {x}}).apply 1;',
  ])assert.equal(checkSources(files(source)).diagnostics[0].code,'E_TYPE');
  assert.equal(checkSources(files('export fn main = () -> (operator_at (x -> x*x) 1).linear;')).diagnostics[0].code,'E_ABI');
  const unsupported='export fn main = (x:Num) -> (operator_at (n -> sum (range n)) x).linear.apply 1;';
  assert.equal(checkSources(files(unsupported)).diagnostics[0].code,'E_DIFF_UNSUPPORTED');
  assert.equal((await createRuntime(compileSources(files(unsupported.replace('.linear.apply 1','.value'))))).call('main',[3]),3);
  const effect='host fn read:Num -> Num;export fn main = () -> (operator_at (x -> read x) 1).linear.apply 1;';
  assert.equal(checkSources(files(effect)).diagnostics[0].code,'E_EFFECT');
  const guarded='export fn main = (x:Num) -> (operator_at (x -> require (x>0) (x*x)) x).linear.apply 0;';
  const r=await createRuntime(compileSources(files(guarded)));assert.throws(()=>r.call('main',[-1]),WebAssembly.RuntimeError);assert.equal(r.call('main',[2]),0);
});

test('raw calls, cache isolation, prepared input snapshots and returned ownership remain intact',async()=>{
  const source=await sourceFixture('operator_blocks'),compiler=createCompiler();
  compiler.compileSources(files(source)).bytes.fill(0);const c=compiler.compileSources(files(source));assert(c.cache.hit);
  const r=await createRuntime(c),xs=[1,2,3],lease=r.prepare('operator_blocks',[xs,2],{outputBytes:48});
  try{const first=lease.run();xs[0]=99;assert.deepEqual([...lease.run().local],[4,12,12]);first.local[0]=999;assert.equal(lease.run().local[0],4);}
  finally{lease.dispose();}
  assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
  const memory=new WebAssembly.Memory({initial:1}),arena=new Arena(memory);
  const frame=prepareCall(arena,c.abi.exports[0],[[1,2,3],2],{outputBytes:48});
  const inst=await instantiate(c,{memory});
  const value=frame.lift(inst.exports.operator_blocks(...frame.slots));assert.deepEqual([...value.local],[4,12,12]);
});

test('source CG agrees with independent solutions across seeded positive definite systems',async t=>{
  const source=`export fn main = (a:Num) -> (b:Num) -> (c:Num) -> (rhs:{left:Num,right:Num}) -> do {
    let vector=vector_product (scalar_vector ()) (scalar_vector ());
    let apply=x -> {left:a*x.left+b*x.right,right:b*x.left+c*x.right};
    cg_solve apply vector rhs vector.zero {tolerance:1e-8,maxSteps:16}
  };`;
  let seed=1603,cases=0;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(const mode of modes){
    const r=await createRuntime(compileSources(files(source),mode));
    for(let i=0;i<60;i++){
      const u=1+rand()%5,v=rand()%7-3,w=1+rand()%5;
      const a=u*u+v*v+1,b=v*w,c=w*w+1;
      const expected=[(rand()%17-8)/4,(rand()%17-8)/4];
      const rhs={left:a*expected[0]+b*expected[1],right:b*expected[0]+c*expected[1]};
      const got=r.call('main',[a,b,c,rhs]);
      assert(got.converged&&!got.breakdown);assert(got.iterations<=16);
      close(got.solution.left,expected[0]);close(got.solution.right,expected[1]);
      const residual=[rhs.left-a*got.solution.left-b*got.solution.right,rhs.right-b*got.solution.left-c*got.solution.right];
      assert(norm(residual)<1e-14);cases++;
    }
  }
  t.diagnostic(JSON.stringify({seededSPDSystems:cases}));
});

test('a stopped recurrence cannot manufacture true-residual convergence',async()=>{
  const source=(await sourceFixture('product_solve')).replace('tolerance:1e-10','tolerance:1e-15');
  const r=await createRuntime(compileSources(files(source)));
  const got=r.call('product_solve',[{left:4,right:18}]);
  assert.equal(got.iterations,2);assert(got.recurrenceResidualSquared<=1e-30);
  assert(got.residualSquared>1e-30);assert(!got.converged&&!got.breakdown);
});

test('nonfinite trial arithmetic preserves the last accepted finite solution',async()=>{
  const r=await createRuntime(compileSources(files(scalarSolve)));
  const got=r.call('main',[Number.MIN_VALUE,1,0,1e-8,16]);
  assert(got.breakdown&&!got.converged);assert.equal(got.solution,0);assert.equal(got.iterations,1);assert.equal(got.residualSquared,1);
});

test('nested source product spaces feed the same solver without shape-specific compiler support',async()=>{
  const source=`export fn main = () -> do {
    let s=scalar_vector ();let v=vector_product (vector_product s s) (vector_product s s);
    let a={apply:x -> 1*x,adjoint:x -> 1*x};let b={apply:x -> 2*x,adjoint:x -> 2*x};
    let c={apply:x -> 3*x,adjoint:x -> 3*x};let d={apply:x -> 4*x,adjoint:x -> 4*x};
    let op=operator_product (operator_product a b) (operator_product c d) |> operator_normal;
    cg_solve op.apply v {left:{left:1,right:4},right:{left:9,right:16}} v.zero {tolerance:1e-8,maxSteps:16}
  };`;
  for(const mode of modes){
    const c=compileSources(files(source),mode);assert.equal(c.stats.intermediateBufferBytes,0);assert.equal(c.stats.functions[0].loops,1);
    const got=(await createRuntime(c)).call('main',[{}]);assert(got.converged&&!got.breakdown);
    for(const value of [got.solution.left.left,got.solution.left.right,got.solution.right.left,got.solution.right.right])close(value,1);
  }
});

test('complete source driver and registered command-line examples execute',()=>{
  const run=spawnSync(process.execPath,['examples/interop/source-operators.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:20000});
  assert.equal(run.status,0,run.stderr);const {reports}=JSON.parse(run.stdout);
  assert.deepEqual(reports.map(r=>r.loopUnits),[2,7,2]);assert(reports.every(r=>r.intermediateBufferBytes===0));
  const cli=spawnSync(process.execPath,['examples/case-studies/app.mjs','operator-blocks'],{cwd:new URL('../',import.meta.url),encoding:'utf8',input:'[[1,2,3,4,5,6,7],3]',timeout:15000});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout).local,[4,12,24,16,36,60,28]);
});

test('browser source-operator checks execute under Node too',async()=>{
  const {runSourceOperatorBrowserChecks}=await import('./source-operators-browser.mjs');
  const {compile}=await import('../src/compiler.mjs');
  const report={checks:0,cases:[]};await runSourceOperatorBrowserChecks({compile,compileSources},createRuntime,report,libraries);
  assert.equal(report.checks,64);
});

test('published source blocks match the executed library-backed fixtures',async()=>{
  const guide=await readFile(new URL('../docs/SOURCE-OPERATORS.md',import.meta.url),'utf8');
  const blocks=[...guide.matchAll(/<!-- operator-example: (\w+) -->\n```ass\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length,2);
  for(const [,name,source] of blocks)assert.equal(source+'\n',await sourceFixture(name));
});
