export async function runChunkCompositionBrowserChecks({compile,check},createRuntime,report) {
  const assert=(ok,label)=>{if(!ok)throw new Error(`Chunk composition: ${label}`);report.checks++;};
  const source='export fn main = (xs:[Num]) -> (w:Num) -> xs |> chunks w |> map (block -> scan block 0 (s -> x -> s+x)) |> flatten;';
  for(const simd of [false,true])for(const reductionFusion of [false,true])for(const memoizeReductions of [false,true]) {
    const mode={simd,reductionFusion,memoizeReductions}, c=compile(source,{...mode,maxLoopIterations:5});
    const r=await createRuntime(c);
    assert(c.abi.version===1&&c.stats.intermediateBufferBytes===0,'no scratch ABI or intermediate buffers');
    assert(c.stats.functions[0].loops===1&&c.stats.functions[0].stateMachines===1,'one resetting traversal');
    assert([...r.call('main',[[1,2,3,4,5],2])].join(',')==='1,3,3,7,5','tail and reset');
    assert(r.call('main',[[],2],{outputBytes:0}).length===0,'empty family');
    let trapped=false;try{r.call('main',[[],0]);}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'width guard on empty input');
    const small=await createRuntime(compile(source,{...mode,maxLoopIterations:4}));
    trapped=false;try{small.call('main',[[1,2,3,4,5],2]);}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'exact budget');
    assert([...small.call('main',[[2,3],1])].join(',')==='2,3','fresh state after trap');
    const seed=source.replace('scan block 0 (s -> x -> s+x)','scan block (sum block) (s -> x -> s)');
    const seeded=await createRuntime(compile(seed,mode));
    assert([...seeded.call('main',[[1,2,3,4,5],2])].join(',')==='3,3,7,7,5','seed reduction keeps its bound cursor');
  }
  assert(check(source.replace('scan block 0 (s -> x -> s+x)','filter block (x -> x>0)')).diagnostics[0].code==='E_CHUNK_DENSE','reject ragged callback');
  report.cases.push({name:'symbolic-chunks-and-flattening',modes:8});
}
