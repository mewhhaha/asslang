import { calibrationSource } from '../examples/case-studies/workflows/calibration-kernel.mjs';
import { releaseKernel } from '../examples/case-studies/workflows/release-kernel.mjs';

// The monitor .ass is in the normal corpus; this covers the AD and generated code.
// Host stdin, fitting orchestration and checkpoints are tested separately in Node.
export async function runWorkflowBrowserChecks({compileSources},createRuntime,report) {
  const assert=(condition,message)=>{if(!condition)throw new Error(`Workflows: ${message}`);report.checks++;};
  for(const simd of [false,true])for(const reductionFusion of [false,true]) {
    const options={simd,reductionFusion,maxLoopIterations:100000};
    const c=compileSources([{name:'calibration.kernel.ass',source:calibrationSource}],options);
    const runtime=await createRuntime(c);
    const lease=runtime.prepare('loss_gradient',[[-2,-1,0,1,2],[-3,-1,21,3,5],2,1.25,1,true]);
    try {
      const value=lease.run();
      assert(value.loss===3.875&&value.gradient.gain===0&&value.gradient.bias===0,'Huber analytic optimum');
      assert(lease.run({bias:1}).gradient.bias===-0.2,'prepared scalar override');
      assert(lease.run().gradient.bias===0,'overrides do not persist');
    } finally {lease.dispose();}
    assert(runtime.call('predict',[[0,1],2,1])[1]===3,'prediction after disposal');
    const {sources}=releaseKernel(),release=await createRuntime(compileSources(sources,{...options,maxLoopIterations:0}));
    assert(release.call('decision',[{buildCurrent:true,testsPass:true,artifactCurrent:true,approved:true}]).ready,'complete current facts');
    assert(!release.call('decision',[{buildCurrent:false,testsPass:true,artifactCurrent:true,approved:true}]).ready,'guarantee is not assumed');
    let trapped=false;
    try{release.call('validate_claims',[{ciReady:true,testedBuild:false,artifactReady:true,approval:true}]);}
    catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'contradictory public aliases rejected');
  }
  report.cases.push({name:'practical-workflow-kernels',modes:4,checks:28});
}
