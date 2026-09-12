import { localPatternCases } from './local-patterns-cases.mjs';

export async function runLocalPatternBrowserChecks({compile, check}, createRuntime, report) {
  const assert=(ok,label)=>{if(!ok)throw new Error(`Local patterns: ${label}`);report.checks++;};
  const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
    ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,plain(x[k])])):x;
  for(const simd of [false,true])for(const c of localPatternCases) {
    const runtime=await createRuntime(compile(c.source,{simd}));
    assert(JSON.stringify(plain(runtime.call('main',c.args)))===JSON.stringify(plain(c.expected)),c.name);
  }
  for(const body of ['let (x,y)=(1,);x', 'let {x}=3;7', 'let ((x,):{_0:Num,_1:Num})=(1,2);x'])
    assert(check(`export fn main = () -> do {${body}};`).diagnostics[0].code==='E_TYPE','shape checked before execution');
  const runtime=await createRuntime(compile(`export fn main = (xs:[Num]) -> do {
    let {state,steps,done}=xs |> scan 0 (s -> x -> require (x>=0) (s+x))
      |> fold_until 0 (s -> x -> {state:x,done:x>=5});
    {state,steps,done}
  };`,{maxLoopIterations:2}));
  const r=runtime.call('main',[[2,3,-99]]);
  assert(r.state===5&&r.steps===2&&r.done,'patterned stop does not force suffix');
  let trap=false;
  try{runtime.call('main',[[1,1,1]]);}catch(e){trap=e instanceof WebAssembly.RuntimeError;}
  assert(trap,'shared loop budget');
  assert(runtime.call('main',[[5]]).steps===1,'post-trap reset');
  report.cases.push({name:'local-patterns-and-vertical-composition',positiveCases:localPatternCases.length,modes:2});
}
