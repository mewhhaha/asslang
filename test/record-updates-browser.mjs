import {recordUpdateCases,recordUpdateModes} from './record-updates-cases.mjs';

export async function runRecordUpdateBrowserChecks({compile,check},createRuntime,report) {
  const assert=(ok,label)=>{if(!ok)throw new Error(`Record updates: ${label}`);report.checks++;};
  const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
    ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,plain(x[k])])):x;
  for(const mode of recordUpdateModes) {
    for(const c of recordUpdateCases) {
      const r=await createRuntime(compile(c.source,mode));
      assert(JSON.stringify(plain(r.call('main',c.args)))===JSON.stringify(plain(c.expected)),c.name);
    }
    for(const [source,code] of [
      ['fn put = r -> {r with x:2};fn unused = () -> put {x:true};export fn main = () -> 7;','E_TYPE'],
      ['export fn main = () -> do {let r={x:1};{r with y:2}};','E_TYPE'],
      ['export fn main = () -> do {let r={x:1};{r with x:2,x:3}};','E_NAME'],
      ['export fn main = (xs:[Num]) -> (ys:[Num]) -> do {let r={xs};zip xs ({r with xs:ys}).xs (+)};','E_DOMAIN'],
      ['export fn main = (xs:[Num]) -> (p:{x:Num}) -> grad (r -> ({r with x:at xs r.x}).x) p;','E_DIFF_CONTROL'],
    ])assert(check(source,mode).diagnostics[0]?.code===code,code);
    const lazy='export fn main = () -> do {let r={x:require false 1,y:7};({r with x:require false 2}).y};';
    assert((await createRuntime(compile(lazy,mode))).call('main',[{}])===7,'overwritten and unused fields stay lazy');
    const derivative='export fn main = (p:{x:Num,y:Num}) -> grad (r -> do {let q={r with x:2*r.x};q.x*q.x+q.y*q.y}) p;';
    const g=(await createRuntime(compile(derivative,mode))).call('main',[{x:3,y:4}]);
    assert(g.x===24&&g.y===8,'native derivative');
    const source='export fn main = (xs:[Num]) -> fold_until xs {total:0,tag:7} (s -> x -> do {let next={s with total:s.total+require (x>=0) x};{state:next,done:next.total>=5}});';
    const runtime=await createRuntime(compile(source,{...mode,maxLoopIterations:2}));
    const result=runtime.call('main',[[2,3,-99]]);
    assert(result.state.total===5&&result.state.tag===7&&result.steps===2&&result.done,'prefix stopping');
    let trapped=false;try{runtime.call('main',[[1,1,1]]);}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
    assert(trapped,'loop budget');
    assert(runtime.call('main',[[5]]).steps===1,'post-trap reset');
  }
  report.cases.push({name:'shape-preserving-record-updates',positiveCases:recordUpdateCases.length,modes:recordUpdateModes.length});
}
