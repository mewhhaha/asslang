import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compileSources,checkSources,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime} from '../src/abi.mjs';
import {sensitivitySource} from '../examples/case-studies/machines/sensitivity-kernel.mjs';
import {runMachineSensitivityBrowserChecks} from './machine-differentials-browser.mjs';
const libraries=await Promise.all(['reducers','machines','machine-differentials'].map(async name=>
  ({name:`${name}.ass`,source:await readFile(new URL(`../lib/${name}.ass`,import.meta.url),'utf8')})));
const prelude={name:'prelude.ass',source:await readFile(new URL('../lib/prelude.ass',import.meta.url),'utf8')};
const files=source=>[...libraries,{name:'sensitivity-client.ass',source}];
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const zero=()=>({value:{left:0,right:0},tangent:{left:0,right:0}});
const close=(a,b,e=1e-8)=>assert(Math.abs(a-b)<=e*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
// Independent real-derivative recurrence, not the generated JVP or source library.
function analytic(xs,dx,alpha,saved=zero()) {
  let mean=saved.value.left,total=saved.value.right,dm=saved.tangent.left,dt=saved.tangent.right;
  const values=[],sensitivities=[];
  for(let i=0;i<xs.length;i++) {
    mean=mean+alpha*(xs[i]-mean);total+=mean;
    dm=(1-alpha)*dm+alpha*dx[i];dt+=dm;
    values.push(total);sensitivities.push(dt);
  }
  return {values,sensitivities,state:{value:{left:mean,right:total},tangent:{left:dm,right:dt}}};
}
function primal(xs,alpha,initial) {
  let mean=initial.left,total=initial.right;const values=[];
  for(const x of xs){mean=mean+alpha*(x-mean);total+=mean;values.push(total);}
  return values;
}

for(const mode of modes)test(`source JVP machine has bounded native state ${JSON.stringify(mode)}`,async()=>{
  const budget=mode.reductionFusion?4:12;
  const c=compileSources(files(sensitivitySource),{...mode,maxLoopIterations:budget});
  assert(verifyCertificate(c.certificate.steps));assert.equal(c.abi.version,1);
  assert.equal(c.stats.intermediateBufferBytes,0);assert.equal(c.stats.kernelHeapAllocationSites,0);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)).map(x=>x.kind),['memory']);
  assert.equal(c.stats.functions[0].loops,mode.reductionFusion?1:3);
  assert.equal(c.stats.functions[0].stateSlots,mode.reductionFusion?4:12);
  const r=await createRuntime(c),args=[[0,8,8,0],[1,0,0,0],0.5,zero()];
  const got=r.call('sensitivity',args,{outputBytes:64});
  assert.deepEqual(plain(got),analytic(...args));
  assert.deepEqual([...got.sensitivities],[0.5,0.75,0.875,0.9375]);
  assert.throws(()=>r.call('sensitivity',args,{outputBytes:63}),WebAssembly.RuntimeError);
  const short=await createRuntime(compileSources(files(sensitivitySource),{...mode,maxLoopIterations:budget-1}));
  assert.throws(()=>short.call('sensitivity',args),WebAssembly.RuntimeError);
  assert.equal(short.call('sensitivity',[[2],[1],0.5,zero()]).sensitivities[0],0.5);
  assert.deepEqual(plain(r.call('sensitivity',[[],[],0.5,zero()],{outputBytes:0})),analytic([],[],0.5));
});

test('whole recurrence finite differences include perturbed input and initial state',async t=>{
  let seed=91237,runs=0;const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(const mode of modes) {
    const r=await createRuntime(compileSources(files(sensitivitySource),mode));
    for(let trial=0;trial<40;trial++) {
      const xs=Array.from({length:1+random()%16},()=>random()%17/4-2),dx=xs.map(()=>random()%9/4-1);
      const alpha=(1+random()%7)/8;
      const saved={value:{left:random()%5/4,right:-0.25},tangent:{left:0.5,right:-0.75}};
      const got=r.call('sensitivity',[xs,dx,alpha,saved]),expected=analytic(xs,dx,alpha,saved);
      const epsilon=1e-5;
      const evaluate=sign=>primal(xs.map((x,i)=>x+sign*epsilon*dx[i]),alpha,{
        left:saved.value.left+sign*epsilon*saved.tangent.left,
        right:saved.value.right+sign*epsilon*saved.tangent.right,
      });
      const plus=evaluate(1),minus=evaluate(-1);
      got.values.forEach((v,i)=>close(v,expected.values[i]));
      got.sensitivities.forEach((v,i)=>{close(v,expected.sensitivities[i]);close(v,(plus[i]-minus[i])/(2*epsilon),1e-6);});
      runs++;
    }
  }
  t.diagnostic(JSON.stringify({analyticAndWholeRecurrenceDifferences:runs}));
});

const nonlinearPrelude=`
  fn nonlinear_left = () -> {initial:0,step:s -> x -> 0.5*s+x*x,finish:s -> s*s};
  fn nonlinear_right = () -> {initial:0,step:s -> x -> s+x/4,finish:s -> s+1};
`;
const composed=nonlinearPrelude+`export fn main = (xs:[Num]) -> (dx:[Num]) -> do {
  let m=machine_jvp (machine_then (nonlinear_left ()) (nonlinear_right ())) {left:0,right:0};
  let events=zip_checked xs dx (value -> tangent -> {value,tangent});
  let h=machine_states events m;
  {values:map h (s -> (m.finish s).value),tangents:map h (s -> (m.finish s).tangent),
    state:fold h m.initial (previous -> next -> next)}
};`;
const staged=composed.replace('machine_jvp (machine_then (nonlinear_left ()) (nonlinear_right ())) {left:0,right:0}',
  'machine_then (machine_jvp (nonlinear_left ()) 0) (machine_jvp (nonlinear_right ()) 0)');

test('JVP lift commutes with serial composition under the explicit state isomorphism',async t=>{
  let seed=167,runs=0;const random=()=>seed=(Math.imul(seed,1103515245)+12345)>>>0;
  const evaluate=(xs,dx)=>{
    let s=0,t=0,ds=0,dt=0;const values=[],tangents=[];
    for(let i=0;i<xs.length;i++){
      s=0.5*s+xs[i]*xs[i];ds=0.5*ds+2*xs[i]*dx[i];
      t+=s*s/4;dt+=2*s*ds/4;values.push(t+1);tangents.push(dt);
    }
    return {values,tangents,state:{value:{left:s,right:t},tangent:{left:ds,right:dt}}};
  };
  for(const mode of modes){
    const whole=await createRuntime(compileSources(files(composed),mode));
    const stages=await createRuntime(compileSources(files(staged),mode));
    for(let n=0;n<30;n++){
      const xs=Array.from({length:random()%12},()=>random()%9/8-0.5),dx=xs.map(()=>random()%5/4-0.5);
      const a=plain(whole.call('main',[xs,dx])),b=plain(stages.call('main',[xs,dx]));
      const bState={value:{left:b.state.left.value,right:b.state.right.value},
        tangent:{left:b.state.left.tangent,right:b.state.right.tangent}};
      assert.deepEqual(a,{values:b.values,tangents:b.tangents,state:bState});
      assert.deepEqual(a,evaluate(xs,dx));runs++;
    }
  }
  t.diagnostic(JSON.stringify({nonlinearCompositionAndAnalyticCases:runs}));
});

test('resuming value and tangent state is exactly equivalent at every split',async t=>{
  const xs=[1,-1,2,3,0,4,1],dx=[0,1,0,-1,0,0.5,1];let runs=0;
  const saved={value:{left:2,right:5},tangent:{left:0.25,right:1}};
  for(const mode of modes){
    const r=await createRuntime(compileSources(files(sensitivitySource),mode));
    const all=r.call('sensitivity',[xs,dx,0.5,saved]);
    for(let cut=0;cut<=xs.length;cut++){
      const a=r.call('sensitivity',[xs.slice(0,cut),dx.slice(0,cut),0.5,saved]);
      const checkpoint=JSON.parse(JSON.stringify(a.state));
      const b=r.call('sensitivity',[xs.slice(cut),dx.slice(cut),0.5,checkpoint]);
      assert.deepEqual([...a.values,...b.values],[...all.values]);
      assert.deepEqual([...a.sensitivities,...b.sensitivities],[...all.sensitivities]);
      assert.deepEqual(b.state,all.state);runs++;
    }
  }
  t.diagnostic(JSON.stringify({exactValueAndTangentResumes:runs}));
});

test('directions are linear while captured alpha is not silently differentiated',async()=>{
  const r=await createRuntime(compileSources(files(sensitivitySource))),xs=[1,2,3,4];
  const run=direction=>[...r.call('sensitivity',[xs,direction,0.5,zero()]).sensitivities];
  const a=run([1,0,0,0]),b=run([0,1,0,0]),c=run([1,1,0,0]);
  assert.deepEqual(c,a.map((x,i)=>x+b[i]));assert.deepEqual(run([0,0,0,0]),[0,0,0,0]);
  // To differentiate a parameter, explicitly carry it and its seed as input data.
  const param=`export fn main = (xs:[Num]) -> (alpha:Num) -> do {
    let m={initial:0,step:s -> p -> s+p.alpha*(p.x-s),finish:s -> s};
    let d=machine_jvp m 0;
    let events=map xs (x -> {value:{x,alpha},tangent:{x:0,alpha:1}});
    machine_states events d |> map (s -> s.tangent)
  };`;
  const parameter=await createRuntime(compileSources(files(param)));
  // d(mean)/d(alpha) for zero-seeded smoothing of [1,2,3,4] at alpha 0.5.
  assert.deepEqual([...parameter.call('main',[xs,0.5])],[1,2,2.75,3.25]);
});

test('the optional adapter is ordinary renamed source and explicitly links in core-only mode',async()=>{
  const c=compileSources(files(sensitivitySource));
  const explicit=compileSources([...libraries,prelude,{name:'sensitivity-client.ass',source:sensitivitySource}],{prelude:false});
  assert.deepEqual(c.bytes,explicit.bytes);
  const renamed=files(sensitivitySource).map(f=>({...f,source:f.source.replaceAll('machine_jvp','push_machine')}));
  assert.deepEqual(c.bytes,compileSources(renamed).bytes);
  const missing=checkSources(files(sensitivitySource),{prelude:false});
  assert.equal(missing.diagnostics[0].code,'E_NAME');assert.equal(missing.diagnostics[0].sourceName,'machine-differentials.ass');
});

test('the lift rejects wrong tangent shapes, Boolean state, unsupported graphs and effects',()=>{
  const mk=(machine,seed)=>`export fn main = (xs:[Num]) -> do {
    let d=machine_jvp ${machine} ${seed};
    machine_states (map xs (x -> {value:x,tangent:1})) d |> map (s -> s.tangent)
  };`;
  const bad=[
    [mk('{initial:false,step:s -> x -> x>0,finish:s -> s}','0'),'E_TYPE'],
    [mk('{initial:0,step:s -> x -> s+x,finish:s -> s}','{wrong:0}'),'E_TYPE'],
    [mk('{initial:0,step:s -> x -> s+sum (range x),finish:s -> s}','0'),'E_DIFF_UNSUPPORTED'],
    ['host fn read:Num -> Num;'+mk('{initial:0,step:s -> x -> read x,finish:s -> s}','0'),'E_EFFECT'],
  ];
  for(const [source,code] of bad)assert.equal(checkSources(files(source)).diagnostics[0].code,code);
  const wrongInput=sensitivitySource.replace('{value,tangent});','{value,tangent:{wrong:tangent}});');
  assert.equal(checkSources(files(wrongInput)).diagnostics[0].code,'E_TYPE');
  const scanAD='export fn main = (x:Num) -> grad (n -> sum (scan (range 3) n (s -> y -> s+y))) x;';
  assert.equal(checkSources(files(scanAD)).diagnostics[0].code,'E_DIFF_UNSUPPORTED');
  const unknown=sensitivitySource.replace('sensitivity_smooth alpha','sensitivity_smooth missing');
  const d=checkSources(files(unknown)).diagnostics[0];assert.equal(d.code,'E_NAME');
  assert.equal(d.sourceName,'sensitivity-client.ass');assert.equal(d.range.start.offset,unknown.indexOf('missing'));
});

test('chunk resets also reset tangent state without segment buffers',async()=>{
  const source=`export fn main = (xs:[Num]) -> (width:Num) -> do {
    let d=machine_jvp (machine_then (sum_reducer ()) (sum_reducer ())) {left:0,right:0};
    xs |> chunks width |> map (b -> b |> map (x -> {value:x,tangent:1})
      |> scan_with d |> map (s -> s.tangent)) |> flatten
  };`;
  for(const mode of modes){
    const c=compileSources(files(source),{...mode,maxLoopIterations:7});
    assert.equal(c.stats.functions[0].loops,1);assert.equal(c.stats.intermediateBufferBytes,0);
    const r=await createRuntime(c);
    assert.deepEqual([...r.call('main',[[1,2,3,4,5,6,7],3],{outputBytes:56})],[1,3,6,1,3,6,1]);
  }
});

test('stopping a lifted scan does not force the invalid suffix, and a dead scan stays dead',async()=>{
  const prefix=`export fn main = (xs:[Num]) -> do {
    let d=machine_jvp {initial:0,step:s -> x -> require (x>=0) (s+x),finish:s -> s} 0;
    let h=map xs (x -> {value:x,tangent:1}) |> machine_states d;
    h |> fold_until {value:0,tangent:0} (s -> x -> {state:x,done:x.value>=5})
  };`;
  const r=await createRuntime(compileSources(files(prefix),{maxLoopIterations:2}));
  assert.deepEqual(r.call('main',[[2,3,-99]]),{state:{value:5,tangent:2},steps:2,done:true});
  assert.throws(()=>r.call('main',[[2,-99,3]]),WebAssembly.RuntimeError);
  const dead=prefix.replace('h |> fold_until {value:0,tangent:0} (s -> x -> {state:x,done:x.value>=5})','7');
  assert.equal((await createRuntime(compileSources(files(dead),{maxLoopIterations:0}))).call('main',[[-99]]),7);
});

test('documented sensitivity runner and exact source snippets execute',async()=>{
  const doc=await readFile(new URL('../docs/MACHINE-SENSITIVITY.md',import.meta.url),'utf8');
  const snippet=doc.match(/<!-- machine-jvp-source -->\n```ass\n([\s\S]*?)\n```/);
  assert(snippet);assert.equal(snippet[1]+'\n',libraries[2].source);
  const kernel=doc.match(/<!-- sensitivity-kernel-source -->\n```ass\n([\s\S]*?)\n```/);
  assert(kernel);assert.equal(kernel[1],sensitivitySource.trim());
  const run=spawnSync(process.execPath,['examples/interop/machine-sensitivity.mjs'],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr);const report=JSON.parse(run.stdout);
  assert.deepEqual(report.result.sensitivities,[0.5,0.75,0.875,0.9375]);
  assert.equal(report.metrics.loopUnits,4);assert.equal(report.metrics.stateSlots,4);
});

test('browser sensitivity checks also run without a browser adapter',async()=>{
  const report={checks:0,cases:[]};
  await runMachineSensitivityBrowserChecks({compileSources},createRuntime,report,libraries);
  assert.equal(report.checks,48);assert.equal(report.cases.length,1);
});


test('projecting only the final checkpoint stores no trace, independent of input length',async()=>{
  const source=sensitivitySource.replace('export fn sensitivity','fn sensitivity')+`
    export fn final = (xs:[Num]) -> (ds:[Num]) -> (alpha:Num) ->
      (saved:{value:{left:Num,right:Num},tangent:{left:Num,right:Num}}) ->
      (sensitivity xs ds alpha saved).state;
  `;
  for(const mode of modes){
    const c=compileSources(files(source),{...mode,maxLoopIterations:4096});
    assert.equal(c.stats.functions[0].loops,1);assert.equal(c.stats.functions[0].stateSlots,4);
    assert.equal(c.stats.intermediateBufferBytes,0);
    const r=await createRuntime(c,{pages:4});
    for(const n of [0,1,17,4096]){
      const xs=Array(n).fill(1),dx=Array(n).fill(0);if(n)dx[0]=1;
      const got=r.call('final',[xs,dx,0.5,zero()],{outputBytes:0});
      const expected=analytic(xs,dx,0.5).state;
      if(n===4096){
        // The original graph computes dm+0.5*(0-dm), which can retain the
        // least subnormal; the algebraically simplified oracle uses 0.5*dm.
        // Record the discrepancy instead of changing AD or using a broad tolerance.
        assert.equal(expected.tangent.left,0);
        assert.equal(got.tangent.left,Number.MIN_VALUE);
        expected.tangent.left=Number.MIN_VALUE;
      }
      assert.deepEqual(got,expected);
    }
  }
});
