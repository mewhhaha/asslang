// Shared executable checks for Node and the engine-only Chromium bundle.
export async function runExperimentCases(cases,compile,createRuntime) {
  const plain=v=>ArrayBuffer.isView(v)?Array.from(v):v&&typeof v==='object'
    ?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
  const equal=(a,b)=>typeof b==='number'?Object.is(a,b)||Number.isNaN(a)&&Number.isNaN(b)
    :b&&typeof b==='object'?Object.keys(a).sort().join()===Object.keys(b).sort().join()
      &&Object.keys(b).every(k=>equal(a[k],b[k])):a===b;
  let checks=0;
  for(const c of cases)for(const enabled of [false,true]) {
    const options={simd:enabled,reductionFusion:enabled,memoizeReductions:enabled};
    if(c.code) {
      let error;try{compile(c.source,options);}catch(e){error=e;}
      if(error?.code!==c.code)throw new Error(`${c.name}: expected ${c.code}, got ${error?.code??'success'}`);
    } else {
      const compiled=compile(c.source,options),runtime=await createRuntime(compiled);
      if(c.trap) {
        let error;try{runtime.call(c.export??'main',c.args);}catch(e){error=e;}
        if(!(error instanceof WebAssembly.RuntimeError))throw new Error(`${c.name}: expected Wasm trap`);
      } else {
        const actual=plain(runtime.call(c.export??'main',c.args));
        if(!equal(actual,c.expected))throw new Error(`${c.name}: ${JSON.stringify(actual)} != ${JSON.stringify(c.expected)}`);
      }
      if(compiled.stats.kernelHeapAllocationSites!==0)throw new Error(`${c.name}: guest allocation`);
    }
    checks++;
  }
  return {status:'PASS',checks,cases:cases.length};
}
