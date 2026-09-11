import { readFile, readdir } from 'node:fs/promises';
import { corpus, unsupportedCorpus } from '../examples/corpus.mjs';
// A fixed test-only bundler, not a general JS module transformer. It permits
// engine-level validation even in environments whose policy blocks local HTTP.
export async function browserBundle({ benchmark = false } = {}) {
  const read=async path=>(await readFile(new URL('../'+path,import.meta.url),'utf8'))
    .replace(/^import .*?;\n/gm,'').replace(/^export \{.*?;\n/gm,'').replace(/^export /gm,'');
  const specs=[
    ['recordKeys','src/record-keys.mjs','','symbolKey,isSymbolKey,displayRecordKey'],
    ['abiSchema','src/abi-schema.mjs','','ABI_VERSION,alignTo,layout,flatTypes,isScalarSchema'],
    ['diagnostics','src/diagnostics.mjs','','diagnosticFromError,formatDiagnostic'],
    ['navigation','web/diagnostic-navigation.mjs','','selectDiagnostic'],
    ['diagnosticCases','test/diagnostic-cases.mjs','','diagnosticCases'],
    ['unary','src/unary.mjs','','createUnaryParser'],
    ['differential','src/differential.mjs','','numericLeaves,prepareDifferential,forwardLinearize,reusableLinearize,valueAndGradient,stopGradient'],
    ['reverse','src/reverse.mjs','const {numericLeaves,prepareDifferential}=modules.differential;','reverseVJP,reusablePullback'],
    ['intrinsics','src/intrinsics.mjs','const {reverseVJP,reusablePullback}=modules.reverse;const {forwardLinearize,reusableLinearize,valueAndGradient,stopGradient}=modules.differential;','intrinsicArities,inferIntrinsic,stageIntrinsic'],
    ['frontend','src/frontend.mjs','const {symbolKey,displayRecordKey}=modules.recordKeys;const {intrinsicArities,inferIntrinsic}=modules.intrinsics;const {createUnaryParser}=modules.unary;const {diagnosticFromError}=modules.diagnostics;','CompileError,fail,tokenize,parse,prune,showType,builtinNames,builtinArities,infer'],
    ['jte','src/jte.mjs','const {isSymbolKey,displayRecordKey}=modules.recordKeys;const {intrinsicArities,stageIntrinsic}=modules.intrinsics;const {fail,prune,showType,builtinArities}=modules.frontend;const {flatTypes,isScalarSchema}=modules.abiSchema;','verifyCertificate,schemaOfType,stage'],
    ['fusion','src/fusion.mjs','','planReductionFusion'],
    ['simd','src/simd.mjs','','SIMD_OPS,planSIMD,supportsSIMD'],
    ['expandedCorpus','examples/expanded-corpus.mjs','','expandedCorpus'],
    ['unsupportedCorpus','examples/unsupported-corpus.mjs','','unsupportedCorpus'],
    ['wasm','src/wasm.mjs','const {ABI_VERSION,layout,flatTypes}=modules.abiSchema;const {planReductionFusion}=modules.fusion;const {planSIMD,SIMD_OPS}=modules.simd;','uleb,emitModule'],
    ['reconstruction','src/reconstruction.mjs','','planReconstruction,reconstructionSource'],
    ['descentCodegen','src/descent-codegen.mjs','','emitDescentSource'],
    ['descent','src/descent.mjs','const {emitDescentSource}=modules.descentCodegen;const {planReconstruction}=modules.reconstruction;','planDescent,verifyDescent,descentSource'],
    ['descentExtension','src/descent-extension.mjs','const {planDescent,verifyDescent}=modules.descent;const {planReconstruction}=modules.reconstruction;const {emitDescentSource}=modules.descentCodegen;','planDescentExtension,descentCountermodel,descentExtensionSource'],
    ['descentQuery','src/descent-query.mjs','const {planDescent}=modules.descent;const {planReconstruction}=modules.reconstruction;const {descentCountermodel}=modules.descentExtension;','planDescentQuery,verifyDescentQuery,verifyDescentQueryCost,descentQuerySource'],
    ['descentBatch','src/descent-batch.mjs','const {planDescent}=modules.descent;const {planReconstruction}=modules.reconstruction;const {planDescentQuery,verifyDescentQuery}=modules.descentQuery;','planDescentBatch,verifyDescentBatch,descentBatchSource'],
    ['batchChecks','test/descent-batch-browser.mjs','','runDescentBatchBrowserChecks'],
    ['queryChecks','test/descent-query-browser.mjs','','runDescentQueryBrowserChecks'],
    ['extensionChecks','test/descent-extension-browser.mjs','','runDescentExtensionBrowserChecks'],
    ['descentChecks','test/descent-browser.mjs','','runDescentBrowserChecks'],
    ['evidenceInterface','src/evidence-interface.mjs','','inferEvidenceInterface'],
    ['interfaceChecks','test/evidence-interface-browser.mjs','','runEvidenceInterfaceBrowserChecks'],
    ['evidenceRefinement','src/evidence-refinement.mjs','const {planReconstruction}=modules.reconstruction;','planEvidenceRefinement,verifyEvidenceRefinement'],
    ['refinementChecks','test/evidence-refinement-browser.mjs','','runEvidenceRefinementBrowserChecks'],
    ['evidenceAlgebra','src/evidence-algebra.mjs','const {planReconstruction}=modules.reconstruction;const {inferEvidenceInterface}=modules.evidenceInterface;const {planEvidenceRefinement,verifyEvidenceRefinement}=modules.evidenceRefinement;','createEvidenceAlgebra'],
    ['algebraChecks','test/evidence-algebra-browser.mjs','','runEvidenceAlgebraBrowserChecks'],
    ['compiler','src/compiler.mjs','const {CompileError,parse,infer}=modules.frontend;const {stage,verifyCertificate}=modules.jte;const {emitModule}=modules.wasm;const {supportsSIMD}=modules.simd;const {formatDiagnostic}=modules.diagnostics;const {planReconstruction,reconstructionSource}=modules.reconstruction;const {planDescent,verifyDescent,descentSource}=modules.descent;const {planDescentExtension,descentCountermodel,descentExtensionSource}=modules.descentExtension;const {planDescentQuery,verifyDescentQuery,verifyDescentQueryCost,descentQuerySource}=modules.descentQuery;const {planDescentBatch,verifyDescentBatch,descentBatchSource}=modules.descentBatch;const {createEvidenceAlgebra}=modules.evidenceAlgebra;','createEvidenceAlgebra,planDescentBatch,verifyDescentBatch,descentBatchSource,planDescentQuery,verifyDescentQuery,verifyDescentQueryCost,descentQuerySource,planDescentExtension,descentCountermodel,descentExtensionSource,planDescent,verifyDescent,descentSource,planReconstruction,reconstructionSource,compile,compileSources,check,checkSources,formatDiagnostic,createCompiler,instantiate,CompileError,verifyCertificate,supportsSIMD'],
    ['abi','src/abi.mjs','const {ABI_VERSION,alignTo,layout,flatTypes,isScalarSchema}=modules.abiSchema;','ABIError,Arena,readABI,createRuntime,createCapability,prepareCall'],
    ['unaryCases','test/unary-cases.mjs','','unaryCases'],
    ['reference','test/reference.mjs','const {parse,builtinArities}=modules.frontend;','reference'],
    ['corpus','examples/corpus.mjs','const {expandedCorpus}=modules.expandedCorpus;const {unsupportedCorpus}=modules.unsupportedCorpus;','unsupportedCorpus,corpus,baselines,benchmarkArguments,expansionSource,exampleSource'],
    ['benchmark','scripts/benchmark-core.mjs','const {compile}=modules.compiler;const {Arena,prepareCall,createRuntime,createCapability}=modules.abi;const {corpus,baselines,benchmarkArguments,expansionSource,exampleSource}=modules.corpus;','runBenchmarks,quantiles'],
  ];
  let code='const modules={};\n';
  for(const [name,path,imports,exports] of specs)code+=`modules.${name}=(()=>{${imports}\n${await read(path)}\nreturn {${exports}};})();\n`;
  const sources={};for(const e of [...corpus,...unsupportedCorpus])for(const path of [...(e.libraries??[]),e.path])if(!Object.hasOwn(sources,path))sources[path]=await readFile(new URL('../examples/'+path,import.meta.url),'utf8');
  code+=`globalThis.asslangSources=${JSON.stringify(sources)};\n`;
  if(benchmark) {
    code+=`const report=await modules.benchmark.runBenchmarks({loadSource:async path=>globalThis.asslangSources[path],compileSamples:15,samples:11});report.environment={engine:navigator.userAgent};return report;`;
  } else {
    code+='const {unaryCases}=modules.unaryCases;const {createEvidenceAlgebra,compile,compileSources,check,checkSources,formatDiagnostic,createCompiler,instantiate,supportsSIMD,planReconstruction,reconstructionSource,planDescentExtension,descentCountermodel,descentExtensionSource,planDescentQuery,verifyDescentQuery,verifyDescentQueryCost,descentQuerySource,planDescentBatch,verifyDescentBatch,descentBatchSource}=modules.compiler;const {runEvidenceRefinementBrowserChecks}=modules.refinementChecks;const {runEvidenceInterfaceBrowserChecks}=modules.interfaceChecks;const {runDescentBatchBrowserChecks}=modules.batchChecks;const {runDescentQueryBrowserChecks}=modules.queryChecks;const {runDescentExtensionBrowserChecks}=modules.extensionChecks;const {diagnosticCases}=modules.diagnosticCases;const {selectDiagnostic}=modules.navigation;const {createRuntime,createCapability}=modules.abi;const {reference}=modules.reference;const {corpus,unsupportedCorpus,exampleSource}=modules.corpus;\n';
    code+='document.body.innerHTML="<pre id=report></pre>";document.body.dataset.result="pending";globalThis.asslangEngineOnly=true;\n';
    code+=await read('test/browser.mjs');
    code+='\nawait modules.descentChecks.runDescentBrowserChecks(modules.compiler,modules.abi.createRuntime,report);\ndocument.querySelector("#report").textContent=JSON.stringify(report,null,2);\n';
    code+='\nawait modules.algebraChecks.runEvidenceAlgebraBrowserChecks(modules.compiler,modules.abi.createRuntime,report);\ndocument.querySelector("#report").textContent=JSON.stringify(report,null,2);\n';
    const experiments=(await readdir(new URL('../test/experiments/',import.meta.url))).filter(n=>n.endsWith('.mjs')).sort();
    code+='\n'+await read('test/experiment-runner.mjs')+'\nconst experimentalCases=[];\n';
    for(const name of experiments)code+=`experimentalCases.push(...(()=>{${await read('test/experiments/'+name)};return cases;})());\n`;
    code+='report.experiments=await runExperimentCases(experimentalCases,compile,createRuntime);return report;';
  }
  return `(async()=>{${code}})()`;
}
