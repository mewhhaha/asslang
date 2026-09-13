export async function runLexicographicKeyBrowserChecks({compile}, createRuntime, report) {
  const assert=(value,message)=>{if(!value)throw new Error(`Tuple keys: ${message}`);report.checks++;};
  const source='export fn main = (xs:[Num]) -> sort_by xs (x -> (abs x,x));';
  for(const simd of [false,true])for(const reductionFusion of [false,true])for(const memoizeReductions of [false,true]) {
    const options={simd,reductionFusion,memoizeReductions,maxLoopIterations:34};
    const c=compile(source,options),r=await createRuntime(c);
    assert(c.abi.version===2&&c.stats.functions[0].ordering.sites[0].keyLeaves===2,'native two-key ABI');
    assert(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)).every(x=>x.kind==='memory'),'no host comparator');
    assert([...r.call('main',[[2,-2,1,-1,2]],{scratchBytes:240,outputBytes:40})].join(',')==='-1,1,-2,2,2','key priority and ties');
    let trapped=false;try{r.call('main',[[2,-2,1,-1,2]],{scratchBytes:239});}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'tuple scratch capacity enforced');
    assert(r.call('main',[[]],{scratchBytes:0,outputBytes:0}).length===0,'empty recovery');
    const invalid=await createRuntime(compile(source.replace('(abs x,x)','(x,require false x)'),options));
    trapped=false;try{invalid.call('main',[[1,2]]);}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'secondary component is strict');
    const small=await createRuntime(compile(source,{...options,maxLoopIterations:33}));
    trapped=false;try{small.call('main',[[2,-2,1,-1,2]]);}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'exact loop limit');
  }
  report.cases.push({name:'native-lexicographic-keys',modes:8,checks:56});
}
