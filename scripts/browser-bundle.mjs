import { readFile } from 'node:fs/promises';
import { corpus } from '../examples/corpus.mjs';
// A fixed test-only bundler, not a general JS module transformer. It permits
// engine-level validation even in environments whose policy blocks local HTTP.
export async function browserBundle({ benchmark = false } = {}) {
  const read=async path=>(await readFile(new URL('../'+path,import.meta.url),'utf8'))
    .replace(/^import .*?;\n/gm,'').replace(/^export \{.*?;\n/gm,'').replace(/^export /gm,'');
  const specs=[
    ['abiSchema','src/abi-schema.mjs','','ABI_VERSION,alignTo,layout,flatTypes,isScalarSchema'],
    ['frontend','src/frontend.mjs','','CompileError,fail,tokenize,parse,prune,showType,builtinNames,infer'],
    ['jte','src/jte.mjs','const {fail,prune,showType}=modules.frontend;const {flatTypes,isScalarSchema}=modules.abiSchema;','verifyCertificate,schemaOfType,stage'],
    ['fusion','src/fusion.mjs','','planReductionFusion'],
    ['wasm','src/wasm.mjs','const {ABI_VERSION,layout,flatTypes}=modules.abiSchema;const {planReductionFusion}=modules.fusion;','uleb,emitModule'],
    ['compiler','src/compiler.mjs','const {CompileError,parse,infer}=modules.frontend;const {stage,verifyCertificate}=modules.jte;const {emitModule}=modules.wasm;','compile,compileSources,createCompiler,instantiate,CompileError,verifyCertificate'],
    ['abi','src/abi.mjs','const {ABI_VERSION,alignTo,layout,flatTypes,isScalarSchema}=modules.abiSchema;','ABIError,Arena,readABI,createRuntime,createCapability,prepareCall'],
    ['reference','test/reference.mjs','const {parse}=modules.frontend;','reference'],
    ['corpus','examples/corpus.mjs','','corpus,baselines,benchmarkArguments,expansionSource,exampleSource'],
    ['benchmark','scripts/benchmark-core.mjs','const {compile}=modules.compiler;const {Arena,prepareCall,createRuntime,createCapability}=modules.abi;const {corpus,baselines,benchmarkArguments,expansionSource,exampleSource}=modules.corpus;','runBenchmarks,quantiles'],
  ];
  let code='const modules={};\n';
  for(const [name,path,imports,exports] of specs)code+=`modules.${name}=(()=>{${imports}\n${await read(path)}\nreturn {${exports}};})();\n`;
  const sources={};for(const e of corpus)for(const path of [...(e.libraries??[]),e.path])if(!Object.hasOwn(sources,path))sources[path]=await readFile(new URL('../examples/'+path,import.meta.url),'utf8');
  code+=`globalThis.asslangSources=${JSON.stringify(sources)};\n`;
  if(benchmark) {
    code+=`const report=await modules.benchmark.runBenchmarks({loadSource:async path=>globalThis.asslangSources[path],compileSamples:15,samples:11});report.environment={engine:navigator.userAgent};return report;`;
  } else {
    code+='const {compile,compileSources,createCompiler,instantiate}=modules.compiler;const {createRuntime,createCapability}=modules.abi;const {reference}=modules.reference;const {corpus,exampleSource}=modules.corpus;\n';
    code+='document.body.innerHTML="<pre id=report></pre>";document.body.dataset.result="pending";globalThis.asslangEngineOnly=true;\n';
    code+=await read('test/browser.mjs');code+='\nreturn report;';
  }
  return `(async()=>{${code}})()`;
}
