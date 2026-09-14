import {operatorCalibrationSource} from '../examples/case-studies/operators/calibration-kernel.mjs';

export async function runSourceOperatorBrowserChecks({compile,compileSources},createRuntime,report,libraries) {
  const assert=(ok,label)=>{if(!ok)throw new Error(`Source operators: ${label}`);report.checks++;};
  for(const simd of [false,true])for(const reductionFusion of [false,true])for(const memoizeReductions of [false,true]){
    const options={simd,reductionFusion,memoizeReductions};
    const c=compileSources([...libraries,{name:'calibration.ass',source:operatorCalibrationSource}],{...options,maxLoopIterations:2});
    const r=await createRuntime(c),args=[[0,1,2],[1,3,5],{gain:0,bias:0},1];
    const value=r.call('calibration_step',args,{outputBytes:0});
    assert(value.converged&&!value.breakdown&&value.iterations===2,'bounded solve status');
    assert(Math.abs(value.solution.gain-5/3)<1e-10&&Math.abs(value.solution.bias-1)<1e-10,'independent correction');
    assert(value.residualSquared<=1e-20,'true residual');
    assert(c.stats.intermediateBufferBytes===0&&c.stats.functions[0].loops===1,'no matrix buffer or repeated solve');
    const short=await createRuntime(compileSources([...libraries,{name:'calibration.ass',source:operatorCalibrationSource}],{...options,maxLoopIterations:1}));
    let failed=false;try{short.call('calibration_step',args);}catch(e){failed=e instanceof WebAssembly.RuntimeError;}
    assert(failed,'exact iteration budget');
    const seed=`export fn main = () -> do {let work=iterate 0 3 (s -> {state:s+1,done:false});
      let plan=pullback (x -> 2*x) 0;{steps:work.steps,value:plan.pullback work.state}};`;
    const sc=compile(seed,{...options,maxLoopIterations:3});
    const sr=(await createRuntime(sc)).call('main',[{}]);
    assert(sr.steps===3&&sr.value===6&&sc.stats.functions[0].loops===1,'reverse weights retain original iterate');
    const guard=await createRuntime(compile('export fn main = (xs:[Num]) -> if at xs 0 > 0 then 7 else 7;',options));
    failed=false;try{guard.call('main',[[]]);}catch(e){failed=e instanceof WebAssembly.RuntimeError;}
    assert(failed,'identical branches retain condition demand');
    assert(guard.call('main',[[-1]])===7,'post-trap reuse');
  }
  report.cases.push({name:'source-matrix-free-operators',modes:8,checks:64});
}
