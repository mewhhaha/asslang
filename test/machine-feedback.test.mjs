import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compileSources,checkSources,createCompiler,instantiate,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime,createCapability,Arena,prepareCall} from '../src/abi.mjs';
import {primitiveArities} from '../src/frontend.mjs';
import {reference} from './reference.mjs';
import {feedbackSensitivitySource} from '../examples/case-studies/feedback/sensitivity-kernel.mjs';
const libraries=await Promise.all(['reducers','machines','machine-feedback'].map(async name=>({name:name+'.ass',
  source:await readFile(new URL('../lib/'+name+'.ass',import.meta.url),'utf8')})));
const differential={name:'machine-differentials.ass',source:await readFile(new URL('../lib/machine-differentials.ass',import.meta.url),'utf8')};
const quantizer={name:'quantize.ass',source:await readFile(new URL('../examples/case-studies/feedback/quantize.ass',import.meta.url),'utf8')};
const tracker={name:'tracking.ass',source:await readFile(new URL('../examples/case-studies/feedback/tracking.ass',import.meta.url),'utf8')};
const files=source=>[...libraries,{name:'client.ass',source}];
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>[false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const plain=x=>Array.isArray(x)||ArrayBuffer.isView(x)?Array.from(x,plain):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const close=(a,b,tol=1e-9)=>assert(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tol*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const zero=()=>({left:0,right:0});
const tangentZero=()=>({value:zero(),tangent:zero()});
const run=async(source,options={})=>createRuntime(compileSources(files(source),options));
const assertError=(source,code)=>assert.equal(checkSources(files(source)).diagnostics[0]?.code,code);
function quantize(xs,unit,saved=zero()) {
  let c=saved.left,q=saved.right;const values=[];
  for(const x of xs){const e=c-q;c=x+e;q=unit*Math.floor(c/unit+0.5);values.push(q);}
  return {values,state:{left:c,right:q}};
}

for(const mode of modes)test(`feedback quantization is one native stateful pass ${JSON.stringify(mode)}`,async()=>{
  const units=mode.reductionFusion?8:16;
  const c=compileSources([...libraries,quantizer],{...mode,maxLoopIterations:units});
  const stats=c.stats.functions.find(f=>f.name==='quantize');
  assert.equal(stats.loops,mode.reductionFusion?1:2);assert.equal(stats.stateSlots,mode.reductionFusion?2:4);
  assert.equal(c.stats.intermediateBufferBytes,0);assert.equal(c.abi.version,1);
  assert(verifyCertificate(c.certificate.steps));assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)).map(i=>i.kind),['memory']);
  const r=await createRuntime(c),xs=Array(8).fill(0.25),args=[xs,1,zero()];
  assert.deepEqual(plain(r.call('quantize',args,{outputBytes:64})),quantize(xs,1));
  assert.deepEqual([...r.call('quantize',args).values],[0,1,0,0,0,1,0,0]);
  const referenceSource=[...libraries,quantizer].map(f=>f.source).join('\n');
  assert.deepEqual(plain(r.call('quantize',args)),reference(referenceSource,'quantize',args));
  assert.throws(()=>r.call('quantize',args,{outputBytes:63}),WebAssembly.RuntimeError);
  const short=await createRuntime(compileSources([...libraries,quantizer],{...mode,maxLoopIterations:units-1}));
  assert.throws(()=>short.call('quantize',args),WebAssembly.RuntimeError);
  assert.deepEqual(plain(short.call('quantize',[[],1,zero()],{outputBytes:0})),{values:[],state:zero()});
});

test('small dyadic words preserve every prefix total within half a quantum',async t=>{
  const r=await createRuntime(compileSources([...libraries,quantizer]));let cases=0;
  const alphabet=[-0.75,-0.25,0.25,0.75];
  for(let n=0;n<=6;n++)for(let word=0;word<4**n;word++){
    let code=word;const xs=Array.from({length:n},()=>{const x=alphabet[code%4];code=Math.floor(code/4);return x;});
    const actual=plain(r.call('quantize',[xs,1,zero()]));assert.deepEqual(actual,quantize(xs,1));
    let a=0,b=0;
    actual.values.forEach((q,i)=>{a+=xs[i];b+=q;assert(a-b>=-0.5&&a-b<0.5);});
    assert.equal(a-b,actual.state.left-actual.state.right);cases++;
  }
  assert.equal(cases,5461);t.diagnostic(JSON.stringify({dyadicWords:cases}));
});

test('seeded signed inputs, units and nonzero residual checkpoints follow an independent recurrence',async t=>{
  let seed=92017,cases=0;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(const mode of modes){const r=await createRuntime(compileSources([...libraries,quantizer],mode));
    for(let i=0;i<40;i++){
      const xs=Array.from({length:rand()%40},()=>rand()%33/8-2),unit=[0.5,1,2,4][rand()%4];
      const saved={left:0.25,right:-0.5},got=plain(r.call('quantize',[xs,unit,saved]));
      assert.deepEqual(got,quantize(xs,unit,saved));
      const total=xs.reduce((s,x)=>s+x,0)-got.values.reduce((s,x)=>s+x,0);
      assert.equal(total,(got.state.left-got.state.right)-(saved.left-saved.right));cases++;
    }
  }t.diagnostic(JSON.stringify({seededCases:cases}));
});

test('feedback state resumes at every split; output and checkpoint storage do not alias',async()=>{
  const xs=[0.25,0.25,-0.75,0.5,0.25,0.75,-0.25],saved={left:0.125,right:0};
  for(const mode of modes){const r=await createRuntime(compileSources([...libraries,quantizer],mode));
    const whole=plain(r.call('quantize',[xs,1,saved]));
    for(let split=0;split<=xs.length;split++){
      const a=r.call('quantize',[xs.slice(0,split),1,saved]);
      const checkpoint=JSON.parse(JSON.stringify(a.state));
      assert.deepEqual(r.call('quantize',[[],1,checkpoint]).state,checkpoint);
      const b=r.call('quantize',[xs.slice(split),1,checkpoint]);
      assert.deepEqual({values:[...a.values,...b.values],state:b.state},whole);
      if(a.values.length){a.values[0]=99;assert.notEqual(b.state.left,99);}
    }
  }
});

test('block-local feedback resets while continuous checkpoints retain the residual',async()=>{
  for(const mode of modes){const c=compileSources([...libraries,quantizer],{...mode,maxLoopIterations:8}),r=await createRuntime(c);
    assert.equal(c.stats.functions.find(f=>f.name==='quantize_blocks').loops,1);
    const xs=Array(8).fill(0.25);
    assert.deepEqual([...r.call('quantize_blocks',[xs,1,3],{outputBytes:64})],[0,1,0,0,1,0,0,1]);
    assert.throws(()=>r.call('quantize_blocks',[xs,1,0]),WebAssembly.RuntimeError);
    assert.deepEqual([...r.call('quantize_blocks',[[],1,3],{outputBytes:0})],[]);
  }
});

const sumBody='{initial:0,step:s -> ports -> ports.input+ports.feedback,finish:s -> s}';
test('feedback is the previous state; new-state feedthrough remains serial only',async()=>{
  const source=`export fn main = (xs:[Num]) -> scan_with xs (machine_feedback ${sumBody} (s -> s));`;
  for(const mode of modes)assert.deepEqual([...(await run(source,mode)).call('main',[[1,2,3]])],[1,3,6]);
});

test('cross-coupled product lanes read one old snapshot, never a partially updated state',async()=>{
  const source=`export fn main = (xs:[Num]) -> do {
    let a={initial:1,step:s -> p -> p.feedback.right,finish:s -> s};
    let b={initial:2,step:s -> p -> p.feedback.left,finish:s -> s};
    let m=machine_feedback (reducer_product a b) (s -> s);
    let h=machine_states xs m;
    {left:map h (s -> s.left),right:map h (s -> s.right)}
  };`;
  for(const mode of modes)assert.deepEqual(plain((await run(source,mode)).call('main',[[0,0,0]])),{left:[2,1,2],right:[1,2,1]});
});

test('outer resets precede feedback, while resetting only the open body is different',async()=>{
  const outer=`export fn main = (xs:[Num]) -> do {
    let body=${sumBody};
    let m=machine_reset_when (machine_feedback body (s -> s)) (x -> x<0);
    scan_with xs m
  };`;
  const inner=outer.replace('machine_reset_when (machine_feedback body (s -> s)) (x -> x<0)',
    'machine_feedback (machine_reset_when body (p -> p.input<0)) (s -> s)');
  for(const mode of modes){assert.deepEqual([...(await run(outer,mode)).call('main',[[2,-1,3]])],[2,-1,2]);
    assert.deepEqual([...(await run(inner,mode)).call('main',[[2,-1,3]])],[2,1,4]);}
  const held=outer.replace('machine_reset_when','reducer_filter').replace('(x -> x<0)','(x -> x>=0)');
  assert.deepEqual([...(await run(held)).call('main',[[2,-99,3]])],[2,2,5]);
});

test('unused observers and empty seeds are lazy; strict state and stopped suffixes stay explicit',async()=>{
  const ignored=`export fn main = (xs:[Num]) -> scan_with xs
    (machine_feedback {initial:0,step:s -> p -> p.input,finish:s -> s} (s -> require false s));`;
  for(const mode of modes){assert.deepEqual([...(await run(ignored,mode)).call('main',[[1,2]])],[1,2]);
    const used=ignored.replace('p -> p.input','p -> p.feedback+p.input');const r=await run(used,mode);
    assert.deepEqual([...r.call('main',[[]])],[]);assert.throws(()=>r.call('main',[[1]]),WebAssembly.RuntimeError);
    const stopped=`export fn main = (xs:[Num]) -> do {
      let m=machine_feedback ${sumBody} (s -> require (s<3) s);
      machine_states xs m |> fold_until 0 (s -> x -> {state:x,done:x>=3})
    };`;
    const sr=await run(stopped,{...mode,maxLoopIterations:1});
    assert.deepEqual(sr.call('main',[[3,1]]),{state:3,steps:1,done:true});
    const strict=`export fn main = (xs:[Num]) -> do {
      let m=machine_feedback {initial:{x:0,y:0},step:s -> p -> {x:p.input,y:p.feedback},finish:s -> s.x} (s -> require false s.y);
      scan_with xs m
    };`;
    const tr=await run(strict,mode);assert.throws(()=>tr.call('main',[[1]]),WebAssembly.RuntimeError);
    const empty=ignored.replace('initial:0','initial:require false 0');
    assert.deepEqual([...(await run(empty,mode)).call('main',[[]])],[]);
  }
});

test('observer work is metered per event, not assumed constant or hoisted across changed state',async()=>{
  const source=`export fn main = (xs:[Num]) -> scan_with xs
    (machine_feedback ${sumBody} (s -> sum (range s)));`;
  for(const mode of modes){const c=compileSources(files(source),{...mode,maxLoopIterations:9});
    assert.equal(c.stats.functions[0].loops,2);
    assert.deepEqual([...(await createRuntime(c)).call('main',[[2,3,1]])],[2,4,7]);
    const short=await run(source,{...mode,maxLoopIterations:8});assert.throws(()=>short.call('main',[[2,3,1]]),WebAssembly.RuntimeError);
    assert.deepEqual([...short.call('main',[[2]])],[2]);
  }
});

test('ordinary source expansion, renaming and core-only mode preserve bytes and state shape',()=>{
  const expanded=libraries.map(f=>f.name==='machine-feedback.ass'?{...f,source:f.source.replace(
    'body.step state {input, feedback:observe state}',
    'do { let feedback=observe state; body.step state {input,feedback} }')}:f);
  assert.equal(Object.keys(primitiveArities).length,33);
  for(const mode of modes){const all=[...libraries,quantizer],c=compileSources(all,mode);
    assert.deepEqual(c.bytes,compileSources(all,{...mode,prelude:false}).bytes);
    assert.deepEqual(c.bytes,compileSources(all.map(f=>({...f,source:f.source.replaceAll('machine_feedback','close_previous')})),mode).bytes);
    assert.deepEqual(c.bytes,compileSources([...expanded,quantizer],mode).bytes);
  }
});

test('types, source positions, authority and the recursion boundary are not relaxed',async()=>{
  assertError(`export fn main = (xs:[Num]) -> scan_with xs (machine_feedback ${sumBody} (s -> true));`,'E_TYPE');
  assertError('export fn main = (xs:[Num]) -> scan_with xs (machine_feedback {initial:0,step:s -> p -> p.missing+1,finish:s -> s} (s -> s));','E_TYPE');
  assertError('export fn main = () -> machine_feedback {initial:0,step:s -> p -> s,finish:s -> s} (s -> s);','E_ABI');
  assertError(`host fn get:Num -> Num;export fn main = (xs:[Num]) -> scan_with xs (machine_feedback ${sumBody} (s -> get s));`,'E_EFFECT');
  assertError('fn cyclic = x -> cyclic x;export fn main = () -> 0;','E_RECURSION');
  const bad=`export fn main = (xs:[Num]) -> scan_with xs (machine_feedback ${sumBody} (s -> unknown s));`;
  const d=checkSources(files(bad)).diagnostics[0];assert.equal(d.code,'E_NAME');assert.equal(d.sourceName,'client.ass');assert.equal(d.range.start.offset,bad.indexOf('unknown'));
  const effect=`host fn audit:Num -> Bool;export fn main = (xs:[Num]) -> effect {
    perform audit 1;scan_with xs (machine_feedback ${sumBody} (s -> s))
  };`;
  const r=await run(effect,{maxLoopIterations:0}),seen=[];
  assert.throws(()=>r.call('main',[[1]]),e=>e.code==='E_CAPABILITY');
  const capability=createCapability({audit:{parameters:['Num'],result:'Bool',call:x=>(seen.push(x),true)}},{maxCalls:1});
  assert.throws(()=>r.call('main',[[1]],{capability}),WebAssembly.RuntimeError);assert.deepEqual(seen,[1]);
});

test('raw calls respect exact output bounds and do not allocate feedback storage',async()=>{
  const c=compileSources([...libraries,quantizer],{maxLoopIterations:8});
  const memory=new WebAssembly.Memory({initial:1,maximum:1});new Uint8Array(memory.buffer).fill(0xa5);
  const frame=prepareCall(new Arena(memory),c.abi.exports.find(e=>e.name==='quantize'),[Array(8).fill(.25),1,zero()],{outputBytes:64});
  const instance=await instantiate(c,{memory}),end=instance.exports.quantize(...frame.slots);
  assert.deepEqual(plain(frame.lift(end)),quantize(Array(8).fill(.25),1));
  assert(new Uint8Array(memory.buffer,end,16).every(v=>v===0xa5));
  assert(c.abi.exports.every(e=>!Object.hasOwn(e,'scratch')));
  assert.equal(c.stats.intermediateBufferBytes,0);
});

test('prepared calls snapshot inputs, recompute feedback and reset after traps',async()=>{
  const compiler=createCompiler(),sources=[...libraries,quantizer];compiler.compileSources(sources).bytes.fill(0);
  const c=compiler.compileSources(sources);assert(c.cache.hit);const r=await createRuntime(c),xs=Array(8).fill(.25);
  const lease=r.prepare('quantize',[xs,1,zero()],{outputBytes:64});
  try{xs[0]=99;assert.deepEqual(plain(lease.run()),quantize(Array(8).fill(.25),1));
    assert.throws(()=>lease.run({unit:0}),WebAssembly.RuntimeError);
    assert.deepEqual(plain(lease.run()),quantize(Array(8).fill(.25),1));
  }finally{lease.dispose();}assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
});

test('invalid quantizer requests fail without claiming a floating-point conservation theorem',async()=>{
  const r=await createRuntime(compileSources([...libraries,quantizer]));
  for(const unit of [0,-1,Infinity,NaN])assert.throws(()=>r.call('quantize',[[],unit,zero()]),WebAssembly.RuntimeError);
  for(const xs of [[NaN],[Infinity],[Number.MAX_VALUE]])assert.throws(()=>r.call('quantize',[xs,Number.MIN_VALUE,zero()]),WebAssembly.RuntimeError);
  assert.throws(()=>r.call('quantize',[[],1,{left:Infinity,right:0}]),WebAssembly.RuntimeError);
  assert.throws(()=>r.call('quantize',[[],1,{left:Number.MAX_VALUE,right:-Number.MAX_VALUE}]),WebAssembly.RuntimeError);
  assert.deepEqual([...r.call('quantize',[[-0,0],1,zero()]).values],[0,0]);
});

const nonlinear=`
  fn loop_body = () -> {initial:{p:0.25,q:-0.5},
    step:s -> ports -> {p:0.5*s.p+ports.input+ports.feedback,q:0.25*s.q+ports.input*ports.input},
    finish:s -> s.p*s.q};
  fn read_back = s -> s.p*s.q/8;
`;
const wholeLift=`machine_jvp (machine_feedback (loop_body ()) read_back) {p:0,q:0}`;
const routedLift=`machine_feedback
  (reducer_map_input (machine_jvp (loop_body ()) {p:0,q:0}) (ports -> {
    value:{input:ports.input.value,feedback:ports.feedback.value},
    tangent:{input:ports.input.tangent,feedback:ports.feedback.tangent}
  })) (s -> jvp read_back s.value s.tangent)`;
const liftedSource=expression=>nonlinear+`export fn main = (xs:[Num]) -> (dx:[Num]) -> do {
  let m=${expression};let h=machine_states (zip_checked xs dx (value -> tangent -> {value,tangent})) m;
  {values:map h (s -> (m.finish s).value),tangents:map h (s -> (m.finish s).tangent)}
};`;
function analytic(xs,dx) {
  let p=.25,q=-.5,dp=0,dq=0;const values=[],tangents=[];
  for(let i=0;i<xs.length;i++){
    const a=xs[i],da=dx[i],np=.5*p+a+p*q/8,nq=.25*q+a*a;
    const ndp=.5*dp+da+(dp*q+p*dq)/8,ndq=.25*dq+2*a*da;
    p=np;q=nq;dp=ndp;dq=ndq;values.push(p*q);tangents.push(dp*q+p*dq);
  }return {values,tangents};
}

test('JVP commutes with old-state closure after routing BOTH value and feedback tangent',async t=>{
  let seed=7129,cases=0;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(const mode of modes){
    const a=await createRuntime(compileSources([...files(liftedSource(wholeLift)),differential],mode));
    const b=await createRuntime(compileSources([...files(liftedSource(routedLift)),differential],mode));
    for(let i=0;i<30;i++){
      const xs=Array.from({length:1+rand()%10},()=>rand()%9/8-.5),dx=xs.map(()=>rand()%5/4-.5);
      const x=a.call('main',[xs,dx]),y=b.call('main',[xs,dx]),expected=analytic(xs,dx),h=1e-5;
      const plus=analytic(xs.map((v,j)=>v+h*dx[j]),dx).values,minus=analytic(xs.map((v,j)=>v-h*dx[j]),dx).values;
      x.values.forEach((v,j)=>{close(v,expected.values[j]);close(v,y.values[j]);});
      x.tangents.forEach((v,j)=>{close(v,expected.tangents[j]);close(v,y.tangents[j]);close(v,(plus[j]-minus[j])/(2*h),1e-6);});cases++;
    }
  }t.diagnostic(JSON.stringify({nonlinearClosureCases:cases}));
  const correct=await createRuntime(compileSources([...files(liftedSource(wholeLift)),differential]));
  const wrong=await createRuntime(compileSources([...files(liftedSource(routedLift.replace('feedback:ports.feedback.tangent','feedback:0'))),differential]));
  assert.notDeepEqual(correct.call('main',[[.25,.5],[1,0]]).tangents,wrong.call('main',[[.25,.5],[1,0]]).tangents);
});

test('tracking impulse sensitivities decay through feedback and resume exactly',async()=>{
  for(const mode of modes){const sources=[...libraries,tracker,differential,{name:'sensitivity.ass',source:feedbackSensitivitySource}];
    const units=mode.reductionFusion?4:12,c=compileSources(sources,{...mode,maxLoopIterations:units});
    const stats=c.stats.functions.find(f=>f.name==='tracking_sensitivity');assert.equal(stats.stateSlots,mode.reductionFusion?4:12);
    const r=await createRuntime(c),xs=[1,1,1,1],dx=[1,0,0,0],args=[xs,dx,.5,tangentZero()];
    const all=plain(r.call('tracking_sensitivity',args,{outputBytes:64}));
    assert.deepEqual(all.values,[.5,.75,.875,.9375]);assert.deepEqual(all.tangents,[.5,.25,.125,.0625]);
    for(let cut=0;cut<=4;cut++){
      const a=r.call('tracking_sensitivity',[xs.slice(0,cut),dx.slice(0,cut),.5,tangentZero()]);
      const b=r.call('tracking_sensitivity',[xs.slice(cut),dx.slice(cut),.5,JSON.parse(JSON.stringify(a.state))]);
      assert.deepEqual([...a.values,...b.values],all.values);assert.deepEqual([...a.tangents,...b.tangents],all.tangents);assert.deepEqual(b.state,all.state);
    }
    const short=await createRuntime(compileSources(sources,{...mode,maxLoopIterations:units-1}));
    assert.throws(()=>short.call('tracking_sensitivity',args),WebAssembly.RuntimeError);
    assert.deepEqual(plain(short.call('tracking_sensitivity',[[],[],.5,tangentZero()],{outputBytes:0})),{values:[],tangents:[],state:tangentZero()});
  }
});

test('checkpoint-only feedback has fixed state and no output arrays for long histories',async()=>{
  const source=quantizer.source.replace('values:history |> map machine.finish,','');
  const c=compileSources([...libraries,{name:'final-only.ass',source}],{maxLoopIterations:4096});
  assert.equal(c.stats.functions[0].stateSlots,2);assert.equal(c.stats.intermediateBufferBytes,0);
  const r=await createRuntime(c,{pages:2});
  assert.deepEqual(r.call('quantize',[Array(4096).fill(.25),1,zero()],{outputBytes:0}),{state:zero()});
});

test('feedback does not make loop-containing or Boolean graphs differentiable',()=>{
  const source=`export fn main = (xs:[Num]) -> do {
    let m=machine_jvp (machine_feedback ${sumBody} (s -> sum (range s))) 0;
    scan_with (map xs (x -> {value:x,tangent:1})) m |> map (p -> p.tangent)
  };`;
  assert.equal(checkSources([...files(source),differential]).diagnostics[0].code,'E_DIFF_UNSUPPORTED');
});

test('finite f64 quantization does not imply the exact-real residual bound',async()=>{
  const r=await createRuntime(compileSources([...libraries,quantizer]));
  // Adding 1/2 to this large odd integer rounds up by one in f64.
  const x=2**52+1,got=r.call('quantize',[[x],1,zero()]);
  assert.equal(got.values[0],x+1);assert.equal(got.state.left-got.state.right,-1);
});

test('registered CLI, driver and exact published source blocks execute',async()=>{
  const docs=await readFile(new URL('../docs/MACHINE-FEEDBACK.md',import.meta.url),'utf8');
  const code=docs.match(/<!-- feedback-library -->\n```ass\n([\s\S]*?)\n```/)[1];
  assert.equal(code+'\n',libraries.find(f=>f.name==='machine-feedback.ass').source);
  assert.equal(docs.match(/<!-- feedback-example: tracking -->\n```ass\n([\s\S]*?)\n```/)[1]+'\n',tracker.source);
  const example=spawnSync(process.execPath,['examples/interop/machine-feedback.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(example.status,0,example.stderr);assert(JSON.parse(example.stdout).sameBytesAsExplicitWiring);
  const cli=spawnSync(process.execPath,['examples/case-studies/app.mjs','feedback-quantize'],{cwd:new URL('../',import.meta.url),input:JSON.stringify([Array(4).fill(.25),1,zero()]),encoding:'utf8',timeout:15000});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),quantize(Array(4).fill(.25),1));
});

test('browser cases run with the actual source libraries under Node too',async()=>{
  const {runMachineFeedbackBrowserChecks}=await import('./machine-feedback-browser.mjs');
  const report={checks:0,cases:[]};
  await runMachineFeedbackBrowserChecks({compileSources},createRuntime,report,libraries,quantizer,tracker,differential);
  assert.equal(report.checks,72);assert.equal(report.cases.length,1);
});
