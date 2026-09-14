import { clockedMachineCases } from './clocked-machines-cases.mjs';

// The library sources are supplied by the harness, not copied into JavaScript.
export async function runClockedMachineBrowserChecks({compileSources,checkSources},createRuntime,report,libraries) {
  const assert=(value,label)=>{if(!value)throw new Error(`Clocked machines: ${label}`);report.checks++;};
  const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
    ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,plain(x[k])])):x;
  const files=source=>[...libraries,{name:'clock-client.ass',source}];
  for(const simd of [false,true])for(const reductionFusion of [false,true])for(const c of clockedMachineCases) {
    const compiled=compileSources(files(c.source),{simd,reductionFusion,prelude:false});
    const runtime=await createRuntime(compiled);
    assert(JSON.stringify(plain(runtime.call('main',c.args)))===JSON.stringify(plain(c.expected)),c.name);
    assert(compiled.stats.intermediateBufferBytes===0&&compiled.abi.version===1,'no intermediate buffers or scratch ABI');
  }
  const source=`export fn main = (xs:[Num]) ->
    machine_states xs (machine_then (sum_reducer ()) (sum_reducer ()))
    |> map (s -> s.right);`;
  const r=await createRuntime(compileSources(files(source),{maxLoopIterations:3}));
  assert([...r.call('main',[[1,2,3]],{outputBytes:24})].join(',')==='1,4,10','three-unit pipeline');
  let trapped=false;try{r.call('main',[[1,2,3,4]]);}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
  assert(trapped,'exact loop allowance');
  assert(r.call('main',[[2]])[0]===2,'fresh state after trap');
  const bad=`export fn main = (xs:[Num]) -> machine_states_from xs {initial:true,step:s -> x -> s+x} 0;`;
  assert(checkSources(files(bad)).diagnostics[0].code==='E_TYPE','resumed seed shape is checked');
  report.cases.push({name:'source-clocked-machines',sourceCases:clockedMachineCases.length,modes:4});
}
