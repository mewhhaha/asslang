import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {compileSources} from '../../src/compiler.mjs';
import {createRuntime} from '../../src/abi.mjs';

// Complete programs and explicit source expansions, never a text-based compiler
// rewrite. This comparison driver transforms only these three fixed fixtures.
export async function notationExamples() {
  const examples=[
    {file:'polynomial',name:'polynomial',libraries:['lib/polynomials.ass'],
      args:[[2,3,5],2],expected:{value:19,derivative:11},units:3,outputBytes:0,
      expand:s=>s.replace('infixl (+) = algebra.add;','let add = algebra.add;')
        .replace('infixl (*) = algebra.multiply;','let multiply = algebra.multiply;')
        .replace('total*x + algebra.constant coefficient','add (multiply total x) (algebra.constant coefficient)')
        .replace('add: (+)','add: a -> b -> a+b').replace('multiply: (*)','multiply: a -> b -> a*b')},
    {file:'machine_report',name:'notation_report',libraries:['lib/reducers.ass','lib/machines.ass'],
      args:[[0,8,8,0],0.5],expected:{totals:[0,4,10,13],peaks:[0,4,6,6],summary:{left:13,right:6}},units:4,outputBytes:64,
      expand:s=>s.replace('  infixl (>>>) below (+) = machine_then;\n','')
        .replace('  infixl (***) above (>>>) below (+) = reducer_product;\n','')
        .replace('notation_smooth alpha\n    >>> sum_reducer () *** notation_peak ()',
          'machine_then (notation_smooth alpha) (reducer_product (sum_reducer ()) (notation_peak ()))')},
    {file:'section_scan',name:'section_scan',libraries:[],
      args:[[1,2,3,4],2],expected:[1,3,9,17],units:4,outputBytes:32,
      expand:s=>s.replace('  infixl (<>) like (+) = concat;\n','').replace('    <> (right','    |> concat (right')},
  ];
  const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
  const reports=[];
  for(const e of examples){
    const paths=[...e.libraries,`examples/case-studies/notation/${e.file}.ass`];
    const files=await Promise.all(paths.map(async name=>({name,source:await readFile(new URL('../../'+name,import.meta.url),'utf8')})));
    const explicit=files.map(f=>({...f,source:e.expand(f.source)}));
    for(const simd of [false,true])for(const reductionFusion of [false,true])for(const memoizeReductions of [false,true]){
      const mode={simd,reductionFusion,memoizeReductions};
      const a=compileSources(files,mode),b=compileSources(explicit,mode);
      assert.deepEqual(a.bytes,b.bytes);assert.deepEqual(a.abi,b.abi);assert.deepEqual(a.certificate,b.certificate);
    }
    const options={maxLoopIterations:e.units};
    const c=compileSources(files,options),r=await createRuntime(c);
    const result=plain(r.call(e.name,e.args,{outputBytes:e.outputBytes}));
    assert.deepEqual(result,e.expected);
    const short=await createRuntime(compileSources(files,{maxLoopIterations:e.units-1}));
    assert.throws(()=>short.call(e.name,e.args),WebAssembly.RuntimeError);
    if(e.outputBytes)assert.throws(()=>r.call(e.name,e.args,{outputBytes:e.outputBytes-1}),WebAssembly.RuntimeError);
    const old=compileSources(explicit,options);
    reports.push({name:e.name,result,sameBytes:true,loopSites:c.stats.functions[0].loops,loopUnits:e.units,
      intermediateBufferBytes:c.stats.intermediateBufferBytes,outputArrayBytes:e.outputBytes,
      descriptorBytes:c.abi.exports[0].result.layout.size,wasmBytes:c.bytes.length,
      syntaxNodes:{operators:c.stats.syntaxNodes,explicit:old.stats.syntaxNodes},
      inferenceConstraints:{operators:c.stats.inferenceConstraints,explicit:old.stats.inferenceConstraints},
      stagingWork:{operators:c.stats.stagingWork,explicit:old.stats.stagingWork}});
  }
  return reports;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify({examples:await notationExamples(),
    note:'Source operators select functions and grouping, not new algorithms. Counts are exact fixture work/storage, not timing claims.'},null,2));
