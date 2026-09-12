export async function runNativeOrderingBrowserChecks({compile}, createRuntime, report) {
  const assert=(ok,message)=>{if(!ok)throw new Error(`Native ordering: ${message}`);report.checks++;};
  const source=`export fn main = (xs:[Num]) -> (center:Num) -> do {
    let rows=xs |> zip_checked (range (count xs)) (value -> position -> {value,position})
      |> sort_by (r -> abs (r.value-center));
    {values:map rows (r -> r.value),positions:map rows (r -> r.position)}
  };`;
  for(const simd of [false,true])for(const reductionFusion of [false,true])for(const memoizeReductions of [false,true]) {
    const options={simd,reductionFusion,memoizeReductions,maxLoopIterations:39};
    const c=compile(source,options),r=await createRuntime(c);
    assert(c.abi.version===2&&c.stats.scratchReservationSites===1,'explicit scratch ABI');
    const imports=WebAssembly.Module.imports(new WebAssembly.Module(c.bytes));
    assert(imports.length===1&&imports[0].kind==='memory','no host sorting function');
    const result=r.call('main',[[7,10,4,7,5],5],{scratchBytes:240,outputBytes:80});
    assert([...result.positions].join(',')==='4,2,0,3,1','stable positions');
    assert([...result.values].join(',')==='5,4,7,7,10','native sorted values');
    let failed=false;try{r.call('main',[[7,10,4,7,5],5],{scratchBytes:239});}catch(e){failed=e instanceof WebAssembly.RuntimeError;}
    assert(failed,'scratch capacity enforced');
    assert(r.call('main',[[],5],{scratchBytes:0,outputBytes:0}).values.length===0,'empty and post-trap recovery');
    const short=await createRuntime(compile(source,{...options,maxLoopIterations:38}));
    failed=false;try{short.call('main',[[7,10,4,7,5],5]);}catch(e){failed=e instanceof WebAssembly.RuntimeError;}
    assert(failed,'exact aggregate work allowance');
    const lease=r.prepare('main',[[7,10,4,7,5],5],{scratchBytes:240,outputBytes:80});
    try {
      assert([...lease.run({center:10}).positions].join(',')==='1,0,3,4,2','fresh ordering after override');
      assert([...lease.run().positions].join(',')==='4,2,0,3,1','nonpersistent override and fresh flags');
    } finally {lease.dispose();}
  }
  report.cases.push({name:'native-stable-ordering',backend:'WebAssembly',modes:8,checks:72});
}
