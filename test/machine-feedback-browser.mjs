import {feedbackSensitivitySource} from '../examples/case-studies/feedback/sensitivity-kernel.mjs';

// Shared harness loads actual library/example sources, not a duplicate body.
export async function runMachineFeedbackBrowserChecks({compileSources},createRuntime,report,libraries,quantizer,tracker,differential) {
  const assert=(ok,label)=>{if(!ok)throw new Error('Machine feedback: '+label);report.checks++;};
  for(const simd of [false,true])for(const reductionFusion of [false,true])for(const memoizeReductions of [false,true]){
    const options={simd,reductionFusion,memoizeReductions,maxLoopIterations:reductionFusion?8:16};
    const c=compileSources([...libraries,quantizer],options),r=await createRuntime(c),zero={left:0,right:0};
    const xs=Array(8).fill(.25),args=[xs,1,zero],got=r.call('quantize',args,{outputBytes:64});
    assert([...got.values].join(',')==='0,1,0,0,0,1,0,0','quantized total');
    assert(c.stats.intermediateBufferBytes===0&&c.abi.version===1,'no intermediate buffers');
    const first=r.call('quantize',[xs.slice(0,3),1,zero]);
    const rest=r.call('quantize',[xs.slice(3),1,JSON.parse(JSON.stringify(first.state))]);
    assert([...first.values,...rest.values].join(',')===[...got.values].join(','),'resume residual');
    assert([...r.call('quantize_blocks',[xs,1,3])].join(',')==='0,1,0,0,1,0,0,1','independent block seeds');
    let trapped=false;try{r.call('quantize',args,{outputBytes:63});}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'bounded output');assert(r.call('quantize',[[],1,zero]).values.length===0,'post-trap reuse');
    const short=await createRuntime(compileSources([...libraries,quantizer],{...options,maxLoopIterations:options.maxLoopIterations-1}));
    trapped=false;try{short.call('quantize',args);}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'exact loop limit');
    const d=compileSources([...libraries,differential,tracker,{name:'feedback-sensitive.ass',source:feedbackSensitivitySource}],
      {...options,maxLoopIterations:reductionFusion?4:12});
    const s=(await createRuntime(d)).call('tracking_sensitivity',[[1,1,1,1],[1,0,0,0],.5,{value:zero,tangent:zero}]);
    assert([...s.tangents].join(',')==='0.5,0.25,0.125,0.0625','old-state feedback tangent');
    assert([...s.values].join(',')==='0.5,0.75,0.875,0.9375','closed-loop values');
  }
  report.cases.push({name:'source-machine-feedback',modes:8,checks:72});
}
