export async function runChunkViewBrowserChecks({compile,check},createRuntime,report) {
  const assert=(ok,label)=>{if(!ok)throw new Error(`Chunk views: ${label}`);report.checks++;};
  for(const simd of [false,true])for(const reductionFusion of [false,true])for(const memoizeReductions of [false,true]) {
    const options={simd,reductionFusion,memoizeReductions};
    const source='export fn main = (xs:[Num]) -> (w:Num) -> xs |> chunks w |> map (b -> map b (x -> x-at b 0)) |> flatten;';
    const c=compile(source,{...options,maxLoopIterations:5}),r=await createRuntime(c);
    assert([...r.call('main',[[10,13,20,18,30],2],{outputBytes:40})].join(',')==='0,3,0,-2,0','flat per-block reference');
    assert(c.abi.version===1&&c.stats.intermediateBufferBytes===0&&c.stats.functions[0].loops===1,'one native loop without scratch');
    let trapped=false;try{r.call('main',[[],0]);}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'empty input checks width');
    assert(r.call('main',[[],2],{outputBytes:0}).length===0,'recovery after trap');
    const blocks=await createRuntime(compile('export fn main = (xs:[Num]) -> xs |> chunks 2 |> map (b -> scan b 0 (s -> x -> s+x) |> sum);',{...options,maxLoopIterations:8}));
    assert([...blocks.call('main',[[10,13,20,18,30]])].join(',')==='33,58,30','scan resets inside each block');
    const selected='export fn main = (xs:[Num]) -> do {let bs=chunks xs 2;zip (at bs 0) (at bs 1) (a -> b -> a+b)};';
    assert(check(selected,options).diagnostics[0].code==='E_DOMAIN','selected blocks do not forge alignment');
    const repeated=source.replace('x-at b 0','x-sum b');
    assert(check(repeated,options).diagnostics[0].code==='E_CHUNK_WORK','no hidden per-element block reductions');
  }
  report.cases.push({name:'arithmetic-chunk-views',modes:8,checks:56});
}
