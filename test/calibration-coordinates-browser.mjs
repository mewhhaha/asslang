import { fitCalibration, predictCalibration } from '../examples/case-studies/workflows/calibration.mjs';
import { calibrationModelSource } from '../examples/case-studies/workflows/calibration-model.mjs';

// Full JS optimizer + Wasm AD/prediction: these hosts use no Node-specific APIs.
export async function runCalibrationCoordinatesBrowserChecks({compileSources}, createRuntime, report) {
  const assert=(ok,message)=>{if(!ok)throw new Error(`Scaled calibration: ${message}`);report.checks++;};
  const x=[999999998,999999999,1e9,1000000001,1000000002], y=[-3,-1,21,3,5];
  for(const simd of [false,true]) for(const reductionFusion of [false,true]) {
    const options={simd,reductionFusion};
    const raw=await fitCalibration({x,y},options);
    assert(raw.status==='line-search-stalled' && raw.iterations===0,'raw large-origin regression');
    const scaled=await fitCalibration({x,y,coordinates:'scaled'},options);
    assert(scaled.status==='converged','bounded scaled fit converges');
    assert(Math.abs(scaled.model.gain-4)<1e-6 && Math.abs(scaled.model.bias-1.25)<1e-6,'known optimum');
    const saved=JSON.parse(JSON.stringify(scaled.model));
    const prediction=await predictCalibration(saved,[1e9],options);
    assert(prediction[0]===1.25,'persisted centered model predicts');
    const sources=[{name:'calibration.model.ass',source:calibrationModelSource}];
    const limited=await createRuntime(compileSources(sources,{...options,maxLoopIterations:2}));
    let trapped=false;
    try{limited.call('predict_scaled',[x,saved]);}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'prediction loop allowance enforced');
    assert(limited.call('predict_scaled',[[1e9],saved])[0]===1.25,'post-trap reuse');
    trapped=false;
    try{limited.call('predict_scaled',[[],{...saved,scale:0}]);}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'invalid model rejected on empty prediction');
  }
  report.cases.push({name:'scaled-calibration-workflow',modes:4,fullOptimizer:true});
}
