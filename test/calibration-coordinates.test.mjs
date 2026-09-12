import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { compileSources, checkSources, instantiate, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime, Arena, prepareCall } from '../src/abi.mjs';
import { fitCalibration, predictCalibration } from '../examples/case-studies/workflows/calibration.mjs';
import { calibrationSource } from '../examples/case-studies/workflows/calibration-kernel.mjs';
import { scaledCoordinates, calibrationModel, calibrationModelSource } from '../examples/case-studies/workflows/calibration-model.mjs';

const modes = [false,true].flatMap(simd => [false,true].flatMap(reductionFusion =>
  [false,true].map(memoizeReductions => ({simd,reductionFusion,memoizeReductions}))));
const base = { x:[-2,-1,0,1,2], y:[-3,-1,21,3,5] };
const shifted = { ...base, x:base.x.map(x=>x+1e9) };
const close = (a,b,tolerance=1e-7) => assert(Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(b)), `${a} != ${b}`);
const vectorClose = (a,b,tolerance) => { assert.equal(a.length,b.length); a.forEach((x,i)=>close(x,b[i],tolerance)); };
const files = [{name:'calibration.model.ass',source:calibrationModelSource}];
const model = {schemaVersion:1,center:1e9,scale:2,gain:4,bias:1.25};

for (const mode of modes) test(`shifted calibration and positive-unit changes ${JSON.stringify(mode)}`, async()=>{
  const raw = await fitCalibration(shifted,mode);
  assert.equal(raw.status,'line-search-stalled'); assert.equal(raw.iterations,0); assert.equal(raw.loss,6.1);
  const reference = await fitCalibration({...base,coordinates:'scaled'},mode);
  for (const [scale,origin] of [[1,1e6],[1,1e9],[128,2**30],[1/128,0]]) {
    const fit = await fitCalibration({...base,x:base.x.map(x=>scale*x+origin),coordinates:'scaled'},mode);
    assert.equal(fit.coordinateSystem,'scaled'); assert.equal(fit.status,'converged');
    close(fit.model.gain,4); close(fit.model.bias,1.25);
    assert.equal(fit.model.center,origin); assert.equal(fit.model.scale,2*scale);
    assert.deepEqual(fit.history,reference.history); assert.deepEqual(fit.optimizerGradient,reference.optimizerGradient);
    assert.deepEqual(fit.predictions,reference.predictions);
    assert(Math.max(...Object.values(fit.optimizerGradient).map(Math.abs))<=1e-8);
    close(fit.coefficients.gain,2/scale);
    const saved=JSON.parse(JSON.stringify(fit.model));
    const prediction=await predictCalibration(saved,[origin-2*scale,origin,origin+3*scale],mode);
    vectorClose(prediction,[-2.75,1.25,7.25]);
    assert(fit.evaluations<=1+16*100); assert(fit.history.slice(1).every((h,i)=>h.loss<fit.history[i].loss));
  }
  const squared=await fitCalibration({...shifted,loss:'squared',coordinates:'scaled',tolerance:1e-6},mode);
  assert.equal(squared.status,'converged');close(squared.model.gain,4,1e-6);close(squared.model.bias,5);
  const clean=await fitCalibration({...shifted,y:[-3,-1,1,3,5],loss:'squared',coordinates:'scaled'},mode);
  assert.equal(clean.status,'converged');vectorClose(clean.predictions,[-3,-1,1,3,5]);
});

// Independent derivative of the loss, not AD or the host's transformed gradient.
function analytic(x,y,gain,bias,delta,robust) {
  let loss=0,g=0,b=0;
  for(let i=0;i<x.length;i++) {
    const r=gain*x[i]+bias-y[i], psi=robust?Math.min(delta,Math.max(-delta,r)):r;
    loss+=robust&&Math.abs(r)>delta ? delta*(Math.abs(r)-delta/2) : r*r/2;
    g+=psi*x[i]; b+=psi;
  }
  return {loss:loss/x.length,gain:g/x.length,bias:b/x.length};
}

test('AD gradients obey the coefficient transport and directional pairing laws',async t=>{
  let seed=901, cases=0;
  const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(const mode of modes) {
    const runtime=await createRuntime(compileSources([{name:'loss.ass',source:calibrationSource}],mode));
    for(let i=0;i<40;i++) {
      const x=[-2,-1,0,1,3].map(x=>x+rand()%7), y=x.map(()=>rand()%15-7);
      const initial={gain:0.75,bias:-0.25}, delta=1.3, robust=i%2===0;
      const c=scaledCoordinates(x,initial);
      const got=runtime.call('loss_gradient',[c.values,y,c.gain,c.bias,delta,robust]);
      const expected=analytic(x,y,initial.gain,initial.bias,delta,robust);
      close(got.loss,expected.loss);close(c.scale*got.gradient.gain+c.center*got.gradient.bias,expected.gain);
      close(got.gradient.bias,expected.bias);
      const dg=0.3, db=-0.2, h=1e-5;
      const pairing=(c.scale*dg)*got.gradient.gain+(db+c.center*dg)*got.gradient.bias;
      close(pairing,dg*expected.gain+db*expected.bias);
      const plus=analytic(x,y,initial.gain+h*dg,initial.bias+h*db,delta,robust).loss;
      const minus=analytic(x,y,initial.gain-h*dg,initial.bias-h*db,delta,robust).loss;
      close(pairing,(plus-minus)/(2*h),1e-5);cases++;
    }
  }
  t.diagnostic(JSON.stringify({gradientAndPairingCases:cases}));
});

test('initial coefficients retain original units and scaled status reports its actual coordinates',async()=>{
  const initial={gain:0.5,bias:0.25};
  const first=await fitCalibration({...base,initial,coordinates:'scaled',maxIterations:0});
  const second=await fitCalibration({...shifted,initial:{gain:0.5,bias:0.25-0.5e9},coordinates:'scaled',maxIterations:0});
  assert.equal(first.initialLoss,second.initialLoss);assert.deepEqual(first.optimizerGradient,second.optimizerGradient);
  assert.deepEqual(first.predictions,second.predictions);
  const expected=analytic(shifted.x,shifted.y,0.5,0.25-0.5e9,1,true);
  close(second.gradient.gain,expected.gain);close(second.gradient.bias,expected.bias);
  assert.equal(second.model.gain,1);assert.equal(second.model.bias,0.25);
  assert(Math.abs(second.gradient.gain)>100*Math.abs(second.optimizerGradient.gain));
});

test('explicit raw mode is identical to omission, including result schema and stop statuses',async()=>{
  for(const request of [base,shifted,{...base,loss:'squared'}, {...base,maxIterations:0},
    {x:[-1,1],y:[-1,1],loss:'squared',step:1e10}]) {
    assert.deepEqual(await fitCalibration(request),await fitCalibration({...request,coordinates:'raw'}));
    assert(!Object.hasOwn(await fitCalibration(request),'model'));
  }
  const limit=await fitCalibration({...base,coordinates:'scaled',maxIterations:0});
  assert.equal(limit.status,'iteration-limit');assert.equal(limit.evaluations,1);
  const stalled=await fitCalibration({x:[-1,1],y:[-1,1],coordinates:'scaled',loss:'squared',step:1e10});
  assert.equal(stalled.status,'line-search-stalled');assert.equal(stalled.evaluations,17);
  const rounded=await fitCalibration({...shifted,coordinates:'scaled',loss:'squared'});
  assert(['converged','line-search-stalled'].includes(rounded.status));
  if(rounded.status==='converged')assert(Math.max(...Object.values(rounded.optimizerGradient).map(Math.abs))<=1e-8);
});

test('centered model persistence avoids raw-intercept cancellation on new points',async()=>{
  const primary={...model,center:1e16};
  const naiveGain=primary.gain/primary.scale, naiveBias=primary.bias-naiveGain*primary.center;
  assert.equal(naiveGain*primary.center+naiveBias,0); // The offset was rounded away.
  const saved=JSON.parse(JSON.stringify(primary));
  const predicted=await predictCalibration(saved,[1e16-2,1e16,1e16+2]);
  assert.deepEqual([...predicted],[-2.75,1.25,5.25]);
  saved.bias=99;assert.equal(predicted[1],1.25);
  const fit=await fitCalibration({...shifted,coordinates:'scaled'});
  assert(Object.isFrozen(fit.model));assert.throws(()=>fit.model.bias=0,TypeError);
  assert.deepEqual(await predictCalibration(fit.model,shifted.x),fit.predictions);
});

test('extreme finite endpoints and subnormal spans need no squared scale or epsilon replacement',async()=>{
  const max=Number.MAX_VALUE,min=Number.MIN_VALUE;
  const big=await fitCalibration({x:[-max,max],y:[-1,1],loss:'squared',coordinates:'scaled'});
  assert.equal(big.model.center,0);assert.equal(big.model.scale,max);assert.deepEqual([...big.predictions],[-1,1]);
  for(const x of [[0,min],[min,2*min]]) {
    const tiny=await fitCalibration({x,y:[0,1],loss:'squared',coordinates:'scaled',maxIterations:200,tolerance:1e-6});
    assert.equal(tiny.status,'converged');assert.equal(tiny.model.scale,min);assert.equal(tiny.coefficients,null);
    vectorClose(tiny.predictions,[0,1],1e-5);
    assert.deepEqual(await predictCalibration(JSON.parse(JSON.stringify(tiny.model)),x),tiny.predictions);
  }
  const g=await fitCalibration({x:[-max,max],y:[-2,2],coordinates:'scaled',loss:'squared',maxIterations:0});
  assert.equal(g.gradient,null);assert.equal(g.optimizerGradient.gain,-2);assert.equal(g.loss,2);
});

test('malformed modes, models, finite overflow and bound violations fail explicitly',async()=>{
  for(const coordinates of [null,false,0,'auto',{},[]]) await assert.rejects(fitCalibration({...base,coordinates}),/coordinates/);
  for(const bad of [null,{}, {...model,schemaVersion:2}, {...model,scale:0}, {...model,scale:-0},
    {...model,scale:-1}, {...model,scale:Infinity}, {...model,bias:NaN}, {...model,extra:1},
    {...model,center:'1'}, {...model,gain:undefined}]) await assert.rejects(predictCalibration(bad,[]));
  const getter={...model};Object.defineProperty(getter,'gain',{get(){throw new Error('must not run');},enumerable:true});
  await assert.rejects(predictCalibration(getter,[]),/data, not getters/);
  const snapshot=calibrationModel(model);assert.notEqual(snapshot,model);assert(!Object.isFrozen(model));
  for(const x of [[Infinity],[NaN],new Array(1),Array(4097).fill(0)]) await assert.rejects(predictCalibration(model,x));
  await assert.rejects(fitCalibration({...base,coordinates:'scaled',initial:{gain:Number.MAX_VALUE,bias:0}}),/scaled initial/);
  await assert.rejects(fitCalibration({x:[1e308,1.1e308],y:[0,1],coordinates:'scaled',initial:{gain:2,bias:0}}),/scaled initial bias/);
  await assert.rejects(predictCalibration({...model,center:Number.MAX_VALUE,scale:1},[-Number.MAX_VALUE]),WebAssembly.RuntimeError);
  assert.deepEqual([...await predictCalibration(model,[])],[]);
});

test('anchored Wasm guards empty models and exact prediction budgets across all lowering modes',async()=>{
  for(const mode of modes) {
    const c=compileSources(files,{...mode,maxLoopIterations:3});assert(verifyCertificate(c.certificate.steps));
    const runtime=await createRuntime(c), x=[1e9-2,1e9,1e9+3];
    assert.deepEqual([...runtime.call('predict_scaled',[x,model])],[-2.75,1.25,7.25]);
    for(const bad of [{...model,scale:0},{...model,center:Infinity},{...model,gain:NaN}])
      assert.throws(()=>runtime.call('predict_scaled',[[],bad]),WebAssembly.RuntimeError);
    const small=await createRuntime(compileSources(files,{...mode,maxLoopIterations:2}));
    assert.throws(()=>small.call('predict_scaled',[x,model]),WebAssembly.RuntimeError);
    assert.equal(small.call('predict_scaled',[[1e9],model])[0],1.25);
    const memory=new WebAssembly.Memory({initial:1}), arena=new Arena(memory);
    const frame=prepareCall(arena,c.abi.exports[0],[x,model],{outputBytes:24});
    const instance=await instantiate(c,{memory});
    assert.deepEqual([...frame.lift(instance.exports.predict_scaled(...frame.slots))],[-2.75,1.25,7.25]);
  }
});

test('scaled fitting retains sample bounds and original loop-policy failures',async()=>{
  await assert.rejects(fitCalibration({...base,coordinates:'scaled'},{maxLoopIterations:0}),WebAssembly.RuntimeError);
  for(const override of [{x:[]},{x:[1,1],y:[0,1]}, {x:[0,1],y:[1]}, {maxIterations:201}, {x:Array(4097).fill(1)}])
    await assert.rejects(fitCalibration({...base,...override,coordinates:'scaled'}));
  const x=new Float64Array(4096),y=new Float64Array(4096);
  for(let i=0;i<x.length;i++){x[i]=1e9+(i%2?1:-1);y[i]=i%2?1:-1;}
  const fit=await fitCalibration({x,y,coordinates:'scaled',loss:'squared'});
  assert.equal(fit.status,'converged');assert.equal(fit.iterations,1);assert.deepEqual(fit.predictions,y);
});

test('anchored prediction keeps ordinary type, effect and file-local diagnostic checks',()=>{
  const bad='export fn bad = () -> predict_scaled (range 0) {center:missing,scale:1,gain:1,bias:0};';
  const result=checkSources([...files,{name:'client.ass',source:bad}]);
  assert.equal(result.diagnostics[0].code,'E_NAME');assert.equal(result.diagnostics[0].sourceName,'client.ass');
  assert.equal(result.diagnostics[0].range.start.offset,bad.indexOf('missing'));
  assert.throws(()=>compileSources([...files,{name:'client.ass',source:'export fn bad = () -> predict_scaled (range 0) {center:0,scale:true,gain:1,bias:0};'}]),e=>e.code==='E_TYPE');
  assert.throws(()=>compileSources([...files,{name:'client.ass',source:'host fn read:Num -> Num; export fn bad = () -> predict_scaled (range 0) {center:read 0,scale:1,gain:1,bias:0};'}]),e=>e.code==='E_EFFECT');
});

test('documented offset and saved-model CLI fixtures execute; malformed requests produce no output',async()=>{
  const run=(id,input)=>spawnSync(process.execPath,['examples/case-studies/workflows/app.mjs',id,'--simd'],
    {cwd:new URL('../',import.meta.url),input,encoding:'utf8',timeout:20000});
  for(const name of ['calibration-offset','calibration-predict']) {
    const input=await readFile(new URL(`../examples/case-studies/workflows/inputs/${name}.json`,import.meta.url),'utf8');
    const r=run(name==='calibration-offset'?'calibration':name,input);assert.equal(r.status,0,r.stderr);
    const result=JSON.parse(r.stdout);
    if(name==='calibration-offset')assert.equal(result.status,'converged');
    else assert.deepEqual(result.predictions,[-2.75,1.25,7.25]);
  }
  for(const input of ['null','{}','not json',JSON.stringify({model:{...model,scale:0},x:[]}),JSON.stringify({model,x:[],extra:true})]) {
    const r=run('calibration-predict',input);assert.equal(r.status,1);assert.equal(r.stdout,'');
  }
  const out=spawnSync(process.execPath,['examples/interop/calibration-coordinates.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:20000});
  assert.equal(out.status,0,out.stderr);assert.equal(JSON.parse(out.stdout).scaled.status,'converged');
});

test('published saved-model embedding snippet executes directly from the guide',async()=>{
  const docs=await readFile(new URL('../docs/CALIBRATION-COORDINATES.md',import.meta.url),'utf8');
  const snippets=[...docs.matchAll(/<!-- calibration-example -->\n```js\n([\s\S]*?)\n```/g)];
  assert.equal(snippets.length,1);
  const run=spawnSync(process.execPath,['--input-type=module','-e',snippets[0][1]],
    {cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:20000});
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout);assert.equal(result.status,'converged');
  vectorClose(result.predictions,[1.25,7.25]);assert.equal(result.model.center,1e9);
});
