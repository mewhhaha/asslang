export async function runTypeProgrammingBrowserChecks({compile,check},createRuntime,report) {
  const assert=(value,message)=>{if(!value)throw new Error(`Numeric shape: ${message}`);report.checks++;};
  const source=`export fn main = (p:{a:Num,b:{c:Num,d:Num}}) -> do {
    let composed=product_fold p (x -> x) (previous -> factor -> x -> factor*(previous x)+1);
    {mapped:product_map p (x -> 2*x),zipped:product_zip p p (+),total:product_fold p 0 (+),applied:composed 1}
  };`;
  const joined=`export fn main = (p:{a:Num,b:{c:Num,d:Num}}) ->
    product_fold p (range 0) (out -> n -> concat out (range n)) |> scan 0 (+);`;
  for(const simd of [false,true])for(const reductionFusion of [false,true])for(const memoizeReductions of [false,true]){
    const mode={simd,reductionFusion,memoizeReductions};
    const c=compile(source,{...mode,maxLoopIterations:0});
    const r=await createRuntime(c),p={a:2,b:{c:3,d:4}},got=r.call('main',[p]);
    assert(got.mapped.a===4&&got.mapped.b.c===6&&got.mapped.b.d===8&&got.zipped.b.d===8,'pathwise arithmetic');
    assert(got.total===9&&got.applied===41,'function-valued left fold');
    assert(c.stats.functions[0].loops===0&&c.stats.intermediateBufferBytes===0,'no runtime shape traversal');
    const ranges=await createRuntime(compile(joined,{...mode,maxLoopIterations:6}));
    assert([...ranges.call('main',[{a:2,b:{c:3,d:1}}],{outputBytes:48})].join(',')==='0,1,1,2,4,4','one-loop array plan');
    let trapped=false;try{ranges.call('main',[{a:2,b:{c:3,d:1}}],{outputBytes:47});}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'output capacity retained');
    assert(ranges.call('main',[{a:0,b:{c:0,d:0}}],{outputBytes:0}).length===0,'post-trap empty reuse');
    const gradient=await createRuntime(compile('export fn main = (p:{a:Num,b:Num}) -> grad (x -> product_fold (product_zip x x (*)) 0 (+)) p;',mode));
    const g=gradient.call('main',[{a:3,b:4}]);assert(g.a===6&&g.b===8,'existing graph differentiation');
    const bad=check('fn reduce = p -> product_fold {p} 0 (s -> n -> s);fn unused = () -> reduce true;export fn main = () -> 7;',mode);
    assert(!bad.ok&&bad.diagnostics[0].code==='E_TYPE'&&bad.diagnostics[0].phase==='infer','generic unused restriction');
  }
  report.cases.push({name:'numeric-product-programming',modes:8,checks:64});
}
