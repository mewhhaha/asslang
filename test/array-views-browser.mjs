export async function runArrayViewBrowserChecks({compile,check},createRuntime,report) {
  const assert=(value,message)=>{if(!value)throw new Error(`Array views: ${message}`);report.checks++;};
  const source=`export fn main = (xs:[Num]) -> (cut:Num) -> do {
    let {left,right}=split_at xs cut;
    let adjusted=concat (map left (x -> x*10)) (map right (x -> x*100));
    let h=zip xs adjusted (original -> value -> value-original) |> scan 0 (s -> x -> s+x);
    {trace:h,last:fold h 0 (s -> x -> x)}
  };`;
  for(const simd of [false,true])for(const reductionFusion of [false,true])for(const memoizeReductions of [false,true]) {
    const options={simd,reductionFusion,memoizeReductions,maxLoopIterations:reductionFusion?4:8};
    const c=compile(source,options),r=await createRuntime(c);
    const got=r.call('main',[[1,2,3,4],2],{outputBytes:32});
    assert([...got.trace].join(',')==='9,27,324,720'&&got.last===720,'piecewise aligned recurrence');
    assert(c.stats.intermediateBufferBytes===0&&c.abi.version===1,'no new scratch or ABI');
    assert(c.stats.arrayViews.restoredDomains===1&&c.stats.functions[0].runtimeZipChecks===0,'cut cover restores domain');
    assert(c.stats.functions[0].loops===(reductionFusion?1:2),'consumer sharing');
    let trap=false;try{r.call('main',[[1,2,3,4],5]);}catch(e){trap=e instanceof WebAssembly.RuntimeError;}
    assert(trap,'invalid cut is retained');
    assert(r.call('main',[[],0],{outputBytes:0}).last===0,'empty recovery');
    const short=await createRuntime(compile(source,{...options,maxLoopIterations:options.maxLoopIterations-1}));
    trap=false;try{short.call('main',[[1,2,3,4],2]);}catch(e){trap=e instanceof WebAssembly.RuntimeError;}
    assert(trap,'exact loop allowance');
    const rotate='export fn main = (xs:[Num]) -> do {let {left,right}=split_at xs 2;concat right left |> scan 0 (s -> x -> s+x)};';
    const rotation=await createRuntime(compile(rotate,options));
    assert([...rotation.call('main',[[1,2,3,4]])].join(',')==='3,7,8,10','single scan across rotation boundary');
  }
  const huge=compile('export fn main = (n:Num) -> do {let {left,right}=split_at (range n) 600000000;at (concat right left) 0};',{maxLoopIterations:0});
  const instance=await WebAssembly.instantiate(huge.bytes);
  assert(instance.instance.exports.main(1_000_000_000)===600_000_000&&!huge.stats.needsMemory,'virtual range has no linear memory');
  assert(check('export fn main = (xs:[Num]) -> split_at (scan xs 0 (s -> x -> s+x)) 0;').diagnostics[0].code==='E_VIEW_ACCESS','no implicit causal replay');
  assert(check('export fn main = (xs:[Num]) -> split_at (filter xs (x -> x>0)) 0;').diagnostics[0].code==='E_VIEW_DENSE','no sparse guess');
  report.cases.push({name:'cut-cover-array-views',modes:8,checks:67});
}
