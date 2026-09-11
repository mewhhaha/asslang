import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { compileSources, checkSources } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';
import { reference } from './reference.mjs';
import { createMonitor, runMonitor, initialMonitorState } from '../examples/case-studies/workflows/monitor.mjs';
import { calibrationSource } from '../examples/case-studies/workflows/calibration-kernel.mjs';
import { fitCalibration } from '../examples/case-studies/workflows/calibration.mjs';
import { releaseKernel } from '../examples/case-studies/workflows/release-kernel.mjs';
import { createReleaseGate, evaluateRelease } from '../examples/case-studies/workflows/release.mjs';
import { runWorkflowBrowserChecks } from './workflows-browser.mjs';

const modes = [false,true].flatMap(simd => [false,true].flatMap(reductionFusion =>
  [false,true].map(memoizeReductions => ({simd,reductionFusion,memoizeReductions}))));
const config = {alpha:0.5,low:3,high:6};
const monitorSource = await readFile(new URL('../examples/case-studies/workflows/monitor.ass', import.meta.url), 'utf8');
const monitorFiles = [{name:'monitor.ass',source:monitorSource}];
const calibrationFiles = [{name:'calibration.kernel.ass',source:calibrationSource}];
const plain = v => Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v,plain) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])) : v;
function close(a,b,tolerance=1e-8) {
  if(typeof b==='number') assert(Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(b)), `${a} != ${b}`);
  else if(b && typeof b==='object') { assert.deepEqual(Object.keys(plain(a)).sort(),Object.keys(plain(b)).sort()); for(const k of Object.keys(b))close(a[k],b[k],tolerance); }
  else assert.equal(a,b);
}
const fixture = async name => JSON.parse(await readFile(new URL(`../examples/case-studies/workflows/inputs/${name}.json`,import.meta.url),'utf8'));

// Ordinary sequential state transitions, independent of scan/fusion lowering.
function monitorReference(xs, seed=initialMonitorState, cfg=config) {
  let state={...seed}; const smoothed=[],alarms=[];
  for(const x of xs) {
    const nextMean=state.seen===0?x:state.mean+cfg.alpha*(x-state.mean);
    const mean=nextMean===0?0:nextMean;
    const alarm=state.alarm?mean>cfg.low:mean>=cfg.high;
    state={seen:state.seen+1,mean,alarm,raised:state.raised+ +(alarm&&!state.alarm),cleared:state.cleared+ +(state.alarm&&!alarm)};
    smoothed.push(mean);alarms.push(alarm);
  }
  return {state,smoothed,alarms};
}
function analytic(xs,ys,gain,bias,delta,robust) {
  let loss=0,g=0,b=0;
  for(let i=0;i<xs.length;i++) {
    const r=gain*xs[i]+bias-ys[i], bounded=robust?Math.max(-delta,Math.min(delta,r)):r;
    loss+=robust&&Math.abs(r)>delta?delta*(Math.abs(r)-delta/2):r*r/2;
    g+=bounded*xs[i];b+=bounded;
  }
  return {loss:loss/xs.length,gradient:{gain:g/xs.length,bias:b/xs.length}};
}

for(const options of modes) test(`workflow kernels: chunk laws, sample gradients and release truth ${JSON.stringify(options)}`,async()=>{
  const monitor=await createRuntime(compileSources(monitorFiles,options));
  const xs=[0,8,8,0,0,9,9,2,-2,8];
  const whole=plain(monitor.call('monitor_chunk',[xs,initialMonitorState,config]));
  assert.deepEqual(whole,monitorReference(xs));
  assert.deepEqual(whole,plain(reference(monitorSource,'monitor_chunk',[xs,initialMonitorState,config])));
  for(let split=0;split<=xs.length;split++) {
    const first=plain(monitor.call('monitor_chunk',[xs.slice(0,split),initialMonitorState,config]));
    const second=plain(monitor.call('monitor_chunk',[xs.slice(split),first.state,config]));
    assert.deepEqual({state:second.state,smoothed:[...first.smoothed,...second.smoothed],alarms:[...first.alarms,...second.alarms]},whole);
  }
  const calibration=await createRuntime(compileSources(calibrationFiles,options));
  const x=[-2,-0.5,0.3,1,3], y=[1,-1,0.4,2,4];
  for(const robust of [false,true]) {
    const got=calibration.call('loss_gradient',[x,y,0.7,-0.2,1.1,robust]);
    close(got,analytic(x,y,0.7,-0.2,1.1,robust));
    const h=1e-5;
    for(const [key,dg,db] of [['gain',h,0],['bias',0,h]]) {
      const upper=analytic(x,y,0.7+dg,-0.2+db,1.1,robust).loss;
      const lower=analytic(x,y,0.7-dg,-0.2-db,1.1,robust).loss;
      close(got.gradient[key],(upper-lower)/(2*h),1e-6);
    }
  }
  const {sources}=releaseKernel(), release=await createRuntime(compileSources(sources,{...options,maxLoopIterations:0}));
  for(let mask=0;mask<16;mask++) {
    const facts={buildCurrent:!!(mask&1),testsPass:!!(mask&2),artifactCurrent:!!(mask&4),approved:!!(mask&8)};
    assert.equal(release.call('decision',[facts]).ready,mask===15);
  }
});

test('monitor checkpoints survive JSON round trips, and failed chunks do not advance state',async()=>{
  const first=await createMonitor(config), prefix=first.process([0,8]);
  const checkpoint=JSON.parse(JSON.stringify(prefix.checkpoint));
  const resumed=await createMonitor(config,checkpoint);
  assert.deepEqual(plain(resumed.process([8,0,0])),plain(first.process([8,0,0])));
  const before=resumed.checkpoint();
  for(const bad of [[NaN],[Infinity],new Array(1),Array(4097).fill(1)]) {
    assert.throws(()=>resumed.process(bad));assert.deepEqual(resumed.checkpoint(),before);
  }
  // Finite inputs can still overflow the arithmetic; commit must be transactional.
  const extreme=await createMonitor(config);extreme.process([Number.MAX_VALUE]);
  const valid=extreme.checkpoint();
  assert.throws(()=>extreme.process([-Number.MAX_VALUE]),WebAssembly.RuntimeError);
  assert.deepEqual(extreme.checkpoint(),valid);
  assert.equal(extreme.process([Number.MAX_VALUE]).checkpoint.state.seen,2);
  assert.throws(()=>before.state.seen=99,TypeError);
  assert.equal(prefix.smoothed[1],4); // Earlier results own their storage.
});

test('monitor validates checkpoint algebra and configuration even for empty input',async()=>{
  const checkpoint=(await createMonitor(config)).checkpoint();
  for(const bad of [null,{alpha:0,low:3,high:6},{alpha:2,low:3,high:6},{...config,high:3},{...config,low:NaN},{...config,typo:1}])
    await assert.rejects(createMonitor(bad));
  for(const state of [ {...initialMonitorState,seen:-1}, {...initialMonitorState,seen:1.5},
    {...initialMonitorState,mean:1}, {...initialMonitorState,raised:1},
    {seen:1,mean:10,alarm:false,raised:0,cleared:0}])
    await assert.rejects(createMonitor(config,{...checkpoint,state}));
  await assert.rejects(createMonitor(config,{...checkpoint,schemaVersion:2}));
  await assert.rejects(createMonitor({...config,alpha:1},checkpoint),/configuration differs/);
  const empty=await runMonitor({config,chunks:[[],[]]});assert.deepEqual(empty.checkpoint.state,initialMonitorState);
  await assert.rejects(runMonitor({config,chunks:Array(257).fill([])}));
  await assert.rejects(runMonitor({config,chunks:Array(5).fill(Array(4096).fill(1))}));
});

test('monitor random input matches explicit transitions; thresholds count edges once',async()=>{
  const m=await createMonitor({alpha:1,low:3,high:6});
  const edges=m.process([6,6,4,3,3,6]);
  assert.deepEqual(plain(edges.alarms),[true,true,true,false,false,true]);
  assert.equal(edges.checkpoint.state.raised,2);assert.equal(edges.checkpoint.state.cleared,1);
  let seed=71;const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const runtime=await createRuntime(compileSources(monitorFiles));
  for(let t=0;t<100;t++) {
    const xs=Array.from({length:random()%35},()=>random()%30-10);
    assert.deepEqual(plain(runtime.call('monitor_chunk',[xs,initialMonitorState,config])),monitorReference(xs));
  }
});

test('monitor loop exhaustion preserves host checkpoint and permits a later smaller call',async()=>{
  // Three sinks currently traverse the history independently: do not claim one loop.
  const m=await createMonitor(config,null,{maxLoopIterations:3});
  const before=m.checkpoint();assert.throws(()=>m.process([1,2]),WebAssembly.RuntimeError);
  assert.deepEqual(m.checkpoint(),before);assert.equal(m.process([1]).checkpoint.state.seen,1);
});

test('calibration clean and contaminated fixtures have independent analytic optima',async()=>{
  const contaminated=await fixture('calibration');
  for(const options of modes) {
    const robust=await fitCalibration(contaminated,options);
    const squared=await fitCalibration({...contaminated,loss:'squared'},options);
    const clean=await fitCalibration({...contaminated,y:[-3,-1,1,3,5]},options);
    close(robust.coefficients,{gain:2,bias:1.25},1e-6);close(squared.coefficients,{gain:2,bias:5},1e-6);
    close(clean.coefficients,{gain:2,bias:1},1e-6);
    assert.equal(robust.status,'converged');assert(robust.loss<robust.initialLoss);
    for(let i=1;i<robust.history.length;i++)assert(robust.history[i].loss<robust.history[i-1].loss);
    assert(robust.evaluations<=1+16*100);assert.equal(robust.history.length,robust.iterations+1);
    close(robust.predictions,contaminated.x.map(x=>robust.coefficients.gain*x+robust.coefficients.bias));
  }
});

test('calibration distinguishes iteration exhaustion and failed line search from convergence',async()=>{
  const input={x:[-1,1],y:[-1,1],loss:'squared'};
  const limited=await fitCalibration({...input,maxIterations:0});
  assert.equal(limited.status,'iteration-limit');assert.equal(limited.iterations,0);assert.equal(limited.evaluations,1);
  const stalled=await fitCalibration({...input,step:1e10});
  assert.equal(stalled.status,'line-search-stalled');assert.equal(stalled.iterations,0);assert.equal(stalled.evaluations,17);
  assert.equal((await fitCalibration({...input,initial:{gain:1,bias:0}})).status,'converged');
});

test('prepared calibration data is pinned, scalar overrides do not persist, and disposal unlocks prediction',async()=>{
  const runtime=await createRuntime(compileSources(calibrationFiles));
  const xs=[-1,1],ys=[-1,1], lease=runtime.prepare('loss_gradient',[xs,ys,0,0,1,true]);
  try {
    xs[0]=100;ys[0]=100;
    close(lease.run(),analytic([-1,1],[-1,1],0,0,1,true));
    assert.equal(lease.run({gain:1}).loss,0);
    assert.equal(lease.run().loss,0.5);
    assert.throws(()=>runtime.call('predict',[[1],1,0]));
  } finally { lease.dispose(); }
  assert.deepEqual(plain(runtime.call('predict',[[1,2],2,1])),[3,5]);
  assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
});

test('calibration rejects invalid data and the kernels retain their own guards',async()=>{
  const input={x:[0,1],y:[1,3]};
  for(const override of [{x:[]},{y:[1]},{x:[1,1]},{x:[0,NaN]},{y:[1,Infinity]},
    {x:new Array(2)},{delta:0},{step:0},{tolerance:-1},{maxIterations:201},{initial:{gain:NaN,bias:0}},
    {loss:'other'},{extra:true},{x:Array(4097).fill(1)}])await assert.rejects(fitCalibration({...input,...override}));
  const runtime=await createRuntime(compileSources(calibrationFiles));
  for(const args of [[[],[],0,0,1,true],[[1],[1,2],0,0,1,true],[[NaN],[1],0,0,1,true],[[1],[1],0,0,0,true]])
    assert.throws(()=>runtime.call('loss_gradient',args),WebAssembly.RuntimeError);
  await assert.rejects(fitCalibration(input,{maxLoopIterations:0}),WebAssembly.RuntimeError);
});

test('release receipts are compared with the candidate revision and digest, not trusted aliases',async()=>{
  const input=await fixture('release'), gate=await createReleaseGate();
  const stale=gate.evaluate(input);assert(!stale.ready);assert.deepEqual(stale.reasons,['candidate-approval-required']);
  const current={...input,approval:{revision:input.candidate.revision,approved:true}};
  assert(gate.evaluate(current).ready);
  for(const override of [{ci:{...input.ci,revision:'old'}},{ci:{...input.ci,passed:0}},
    {ci:{...input.ci,failed:1}},{artifact:{...input.artifact,digest:'other'}},
    {artifact:{...input.artifact,revision:'old'}},{approval:null},{ci:null},{minPassed:121}])
    assert(!gate.evaluate({...current,...override}).ready);
  const summaries=gate.evaluate(current).summaries;
  assert(gate.evaluate({...current,claims:summaries}).ready);
  assert.throws(()=>gate.evaluate({...current,claims:{...summaries,testedBuild:false}}),/interface laws/);
  const zeros=Object.fromEntries(Object.keys(summaries).map(n=>[n,false]));
  assert.throws(()=>gate.evaluate({...current,claims:zeros}),/current receipt/);
  const empty=gate.evaluate({candidate:input.candidate});assert.equal(empty.reasons.length,4);assert(!empty.ready);
});

test('release rejects malformed receipts and impossible summary claims; no authority is granted',async()=>{
  const input=await fixture('release'), gate=await createReleaseGate();
  for(const override of [{candidate:{}},{ci:{...input.ci,passed:-1}},{ci:{...input.ci,failed:0.5}},
    {approval:{revision:'x',approved:1}},{minPassed:0},{claims:null},{artifact:{revision:'x',digest:''}},{deploy:true}])
    assert.throws(()=>gate.evaluate({...input,...override}));
  const {sources}=releaseKernel(),runtime=await createRuntime(compileSources(sources,{maxLoopIterations:0}));
  for(let mask=0;mask<16;mask++) {
    const claims={ciReady:!!(mask&1),testedBuild:!!(mask&2),artifactReady:!!(mask&4),approval:!!(mask&8)};
    if(claims.ciReady===claims.testedBuild) assert(runtime.call('validate_claims',[claims]));
    else assert.throws(()=>runtime.call('validate_claims',[claims]),WebAssembly.RuntimeError);
  }
});

test('runtime examples retain source-local diagnostics, pure host boundary and missing-field errors',()=>{
  const {sources}=releaseKernel();
  const app='export fn bad = () -> workflow_ci {buildCurrent:missing,testsPass:true};';
  const checked=checkSources([...sources,{name:'caller.ass',source:app}]);
  assert.equal(checked.diagnostics[0].code,'E_NAME');assert.equal(checked.diagnostics[0].sourceName,'caller.ass');
  assert.equal(checked.diagnostics[0].range.start.offset,app.indexOf('missing'));
  assert.throws(()=>compileSources([...sources,{name:'host.ass',source:'host fn audit:Num -> Bool; export fn bad = () -> workflow_ci {buildCurrent:audit 1,testsPass:true};'}]),e=>e.code==='E_EFFECT');
  assert.throws(()=>compileSources([...sources,{name:'bad.ass',source:'export fn bad = () -> workflow_ci {};'}]),e=>e.code==='E_TYPE');
});

test('the three documented CLI requests run with finite JSON and explicit release exit status',async()=>{
  const run=(args,input)=>spawnSync(process.execPath,['examples/case-studies/workflows/app.mjs',...args],
    {cwd:new URL('../',import.meta.url),input,encoding:'utf8',timeout:20000});
  for(const name of ['monitor','calibration','release']) {
    const result=run([name,'--simd'],JSON.stringify(await fixture(name)));
    assert.equal(result.status,name==='release'?2:0,result.stderr);
    const data=JSON.parse(result.stdout);
    if(name==='monitor')assert.deepEqual(data.smoothed,[0,4,6,3,1.5]);
    if(name==='calibration')close(data.coefficients,{gain:2,bias:1.25},1e-6);
    if(name==='release')assert.deepEqual(data.reasons,['candidate-approval-required']);
  }
  const ready=await fixture('release');ready.approval.revision=ready.candidate.revision;
  assert.equal(run(['release'],JSON.stringify(ready)).status,0);
  for(const [args,input] of [[['unknown'],'{}'],[['../monitor'],'{}'],[['monitor','--other'],'{}'],
    [['monitor','--simd','--simd'],'{}'],[['monitor'],'null'],[['release'],'not JSON'],[['calibration'],' '.repeat(1024*1024+1)]]) {
    const result=run(args,input);assert.equal(result.status,1);assert.equal(result.stdout,'');assert(result.stderr.trim());
  }
  assert.equal(run(['--help'],'').status,0);
});

test('browser workflow checks also run in Node without relying on the host CLI',async()=>{
  const report={checks:0,cases:[]};
  await runWorkflowBrowserChecks({compileSources},createRuntime,report);
  assert.equal(report.checks,28);assert.equal(report.cases.length,1);
});

test('published embedding snippets execute as written, and the fixture runner stays usable',async()=>{
  const docs=await readFile(new URL('../docs/CASE-STUDIES.md',import.meta.url),'utf8');
  const blocks=[...docs.matchAll(/<!-- workflow-example: (\w+) -->\n```js\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length,3);
  for(const [,id,source] of blocks) {
    const result=spawnSync(process.execPath,['--input-type=module','-e',source],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:20000});
    assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);
    if(id==='monitor')assert.deepEqual(value,{means:[6,3,1.5],state:{seen:5,mean:1.5,raised:1,cleared:1,alarm:false}});
    if(id==='calibration'){assert.equal(value.status,'converged');close(value.gain,2,1e-6);close(value.bias,1.25,1e-6);}
    if(id==='release')assert.deepEqual(value,{before:false,reasons:['candidate-approval-required'],after:true});
  }
  const result=spawnSync(process.execPath,['examples/case-studies/workflows/run.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stderr);
  assert(result.stdout.trim().split('\n').every(s=>JSON.parse(s).release.currentApprovalReady));
});

test('zero-normalized checkpoints and maximum-size chunks remain reusable',async()=>{
  const m=await createMonitor(config);const negativeZero=m.process([-0]);
  assert(Object.is(negativeZero.smoothed[0],0));assert(Object.is(negativeZero.checkpoint.state.mean,0));
  const restored=await createMonitor(config,JSON.parse(JSON.stringify(negativeZero.checkpoint)));
  assert.deepEqual(restored.checkpoint(),m.checkpoint());
  const large=await createMonitor(config);const result=large.process(new Float64Array(4096).fill(4));
  assert.equal(result.smoothed.length,4096);assert.equal(result.checkpoint.state.seen,4096);assert.equal(result.checkpoint.state.mean,4);
});

test('100 seeded calibration gradients match direct clipped-residual derivatives',async()=>{
  const runtime=await createRuntime(compileSources(calibrationFiles));
  let seed=2026;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<100;i++) {
    const x=Array.from({length:1+rand()%12},()=>rand()%17-8),y=x.map(()=>rand()%23-11);
    const gain=(rand()%9-4)/2,bias=(rand()%11-5)/3,delta=1+(rand()%4),robust=!!(i%2);
    close(runtime.call('loss_gradient',[x,y,gain,bias,delta,robust]),analytic(x,y,gain,bias,delta,robust),1e-10);
  }
});
