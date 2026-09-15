export async function runAllSourceOperatorBrowserChecks({compile,check},createRuntime,report) {
  const assert=(ok,message)=>{if(!ok)throw new Error(`Source defaults: ${message}`);report.checks++;};
  for(const simd of [false,true])for(const reductionFusion of [false,true]) {
    const mode={simd,reductionFusion};
    const a=await createRuntime(compile(`export fn main = () -> do {
      infixl (&&)=min;infixl (||)=max;prefix (!)=x -> 1-x;
      !0.25 && 0.5 || 0.125
    };`,mode));
    assert(a.call('main',[{}])===0.5,'same expression, numeric logic');
    const b=await createRuntime(compile('export fn main = () -> false && require false true;',mode));
    assert(b.call('main',[{}])===false,'source short circuit');
    const c=await createRuntime(compile('export fn main = () -> do {prefix (-)=x -> x+1; let saved=(prefix (-));prefix (~)=saved; ~3};',mode));
    assert(c.call('main',[{}])===4,'source prefixes and captures');
    const d=await createRuntime(compile('export fn main = () -> do {infixl (|>) = x -> f -> f x + 1;3 |> (x -> x*2)};',mode));
    assert(d.call('main',[{}])===7,'source pipeline');
    assert(check('export fn main = () -> do {prefix (!)=3;0};',mode).diagnostics[0].code==='E_TYPE','unused invalid prefix');
    const zero=await createRuntime(compile('export fn main = (x:Num) -> -x;',mode));
    assert(Object.is(zero.call('main',[0]),-0),'scalar negation retains negative zero');
  }
  report.cases.push({name:'all-source-expression-operators',modes:4,checks:24});
}
