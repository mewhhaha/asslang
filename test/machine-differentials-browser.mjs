import {sensitivitySource} from '../examples/case-studies/machines/sensitivity-kernel.mjs';

export async function runMachineSensitivityBrowserChecks({compileSources},createRuntime,report,libraries) {
  const assert=(value,label)=>{if(!value)throw new Error(`Machine sensitivities: ${label}`);report.checks++;};
  const saved={value:{left:0,right:0},tangent:{left:0,right:0}};
  for(const simd of [false,true])for(const reductionFusion of [false,true])for(const memoizeReductions of [false,true]) {
    const options={simd,reductionFusion,memoizeReductions,maxLoopIterations:reductionFusion?4:12};
    const files=[...libraries,{name:'sensitivity.ass',source:sensitivitySource}];
    const c=compileSources(files,options),r=await createRuntime(c);
    const args=[[0,8,8,0],[1,0,0,0],0.5,saved];
    const got=r.call('sensitivity',args,{outputBytes:64});
    assert([...got.sensitivities].join(',')==='0.5,0.75,0.875,0.9375','analytic forward sensitivity');
    assert([...got.values].join(',')==='0,4,10,13','primal recurrence');
    assert(c.stats.intermediateBufferBytes===0&&c.stats.functions[0].stateSlots===(reductionFusion?4:12),'no tape; explicit recurrence slots');
    const first=r.call('sensitivity',[[0,8],[1,0],0.5,saved]);
    const resumed=r.call('sensitivity',[[8,0],[0,0],0.5,JSON.parse(JSON.stringify(first.state))]);
    assert([...first.sensitivities,...resumed.sensitivities].join(',')===[...got.sensitivities].join(','),'tangent checkpoint');
    let trapped=false;try{r.call('sensitivity',args,{outputBytes:63});}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'output bound');
    assert(r.call('sensitivity',[[0],[1],0.5,saved]).sensitivities[0]===0.5,'fresh state after trap');
  }
  report.cases.push({name:'source-machine-sensitivity',modes:8,checks:48});
}
