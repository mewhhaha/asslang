import { preludeSource } from '../src/prelude.mjs';
import { corePreludeCases } from './core-prelude-cases.mjs';

export async function runCorePreludeBrowserChecks({compile,compileSources,check,createCompiler},createRuntime,report) {
  const assert=(value,message)=>{if(!value)throw new Error(`Core prelude: ${message}`);report.checks++;};
  const same=(a,b)=>typeof b==='number'?Object.is(a,b)||Number.isNaN(a)&&Number.isNaN(b)
    :b&&typeof b==='object'?Object.keys(a).sort().join()===Object.keys(b).sort().join()&&Object.keys(b).every(k=>same(a[k],b[k])):a===b;
  for(const simd of [false,true])for(const c of corePreludeCases){
    const options={simd};const compiled=compile(c.source,options);
    const explicit=compileSources([{name:'prelude.ass',source:preludeSource},{name:'app.ass',source:c.source}],{...options,prelude:false});
    assert(compiled.bytes.length===explicit.bytes.length&&compiled.bytes.every((x,i)=>x===explicit.bytes[i]),'explicit source equals '+c.name);
    assert(same((await createRuntime(compiled)).call('main',c.args),c.expected),c.name);
  }
  const session=createCompiler(),src='export fn main = (xs:[Num]) -> sum xs;';
  session.compile(src);
  assert(session.check(src,{prelude:false}).diagnostics[0].code==='E_NAME','cache separates core-only mode');
  assert(check('export fn main = (x:Num) -> (jvp (y -> sum (range 3)) x 1).value;').diagnostics[0].code==='E_DIFF_UNSUPPORTED','value-only still checks derivative');
  const structural=await createRuntime(compile('export fn main = (n:Num) -> count (map (range n) (x -> require false x));',{maxLoopIterations:0}));
  assert(structural.call('main',[3])===3,'count is structural, not a fold alias');
  report.cases.push({name:'source-prelude-and-core-boundaries',sourceCases:corePreludeCases.length,modes:2});
}
