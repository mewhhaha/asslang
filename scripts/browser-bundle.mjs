import { readFile, readdir } from 'node:fs/promises';
import { corpus, unsupportedCorpus } from '../examples/corpus.mjs';
// A fixed test-only bundler, not a general JS module transformer. It permits
// engine-level validation even in environments whose policy blocks local HTTP.
export async function browserBundle({ benchmark = false } = {}) {
  const read=async path=>(await readFile(new URL('../'+path,import.meta.url),'utf8'))
    .replace(/^import .*?;\n/gm,'').replace(/^export \{.*?;\n/gm,'').replace(/^export /gm,'');
  const specs=[
    ['typeProgrammingChecks','test/type-programming-browser.mjs','','runTypeProgrammingBrowserChecks'],
    ['chunkScanChecks','test/chunk-composition-browser.mjs','','runChunkCompositionBrowserChecks'],
    ['recordKeys','src/record-keys.mjs','','symbolKey,isSymbolKey,displayRecordKey'],
    ['products','src/products.mjs','const {isSymbolKey}=modules.recordKeys;','PRODUCT_LIMITS,productArities,productFields,inferProduct,createProductConstraints,stageProduct'],
    ['abiSchema','src/abi-schema.mjs','','ABI_VERSION,SCRATCH_ABI_VERSION,alignTo,layout,flatTypes,isScalarSchema'],
    ['diagnostics','src/diagnostics.mjs','','diagnosticFromError,formatDiagnostic'],
    ['navigation','web/diagnostic-navigation.mjs','','selectDiagnostic'],
    ['diagnosticCases','test/diagnostic-cases.mjs','','diagnosticCases'],
    ['infix','src/infix.mjs','','isCustomInfix,isNativeInfixFunction,createInfixScope,extendInfixScope,infixBindsInside'],
    ['unary','src/unary.mjs','const {isCustomInfix,isNativeInfixFunction,createInfixScope,extendInfixScope,infixBindsInside}=modules.infix;','createUnaryParser'],
    ['differential','src/differential.mjs','','numericLeaves,prepareDifferential,reusableLinearize,valueAndGradient,stopGradient'],
    ['reverse','src/reverse.mjs','const {numericLeaves,prepareDifferential}=modules.differential;','reusablePullback'],
    ['intrinsics','src/intrinsics.mjs','const {reusablePullback}=modules.reverse;const {reusableLinearize,valueAndGradient,stopGradient}=modules.differential;','intrinsicArities,inferIntrinsic,stageIntrinsic'],
    ['preludeSource','src/prelude-source.mjs','','preludeSource,preludeArities'],
    ['prelude','src/prelude.mjs','const {preludeSource,preludeArities}=modules.preludeSource;','preludeSource,preludeArities,relocatePrelude,createPrelude'],
    ['operatorSource','src/operator-source.mjs','','operatorSource'],
    ['operatorLibrary','src/operator-library.mjs','const {operatorSource}=modules.operatorSource;','createSourceOperators,sourceOperatorNames,sourcePrefixNames,validateOperatorText'],
    ['frontend','src/frontend.mjs','const {productArities,inferProduct,createProductConstraints}=modules.products;const {createSourceOperators}=modules.operatorLibrary;const {createPrelude,preludeArities}=modules.prelude;const {symbolKey,displayRecordKey}=modules.recordKeys;const {intrinsicArities,inferIntrinsic}=modules.intrinsics;const {createUnaryParser}=modules.unary;const {diagnosticFromError}=modules.diagnostics;','CompileError,fail,tokenize,parse,prune,showType,builtinNames,builtinArities,primitiveArities,infer'],
    ['ordering','src/ordering.mjs','','collectOrderings,orderingKeyLeaves'],
    ['orderWasm','src/order-wasm.mjs','','createOrderEmitter'],
    ['arrayViews','src/array-views.mjs','','createArrayViews'],
    ['chunkViews','src/chunk-views.mjs','','createChunkViews'],
    ['jte','src/jte.mjs','const {productArities,stageProduct}=modules.products;const {relocatePrelude}=modules.prelude;const {createChunkViews}=modules.chunkViews;const {createArrayViews}=modules.arrayViews;const {collectOrderings,orderingKeyLeaves}=modules.ordering;const {isSymbolKey,displayRecordKey}=modules.recordKeys;const {intrinsicArities,stageIntrinsic}=modules.intrinsics;const {fail,prune,showType,primitiveArities}=modules.frontend;const {flatTypes,isScalarSchema}=modules.abiSchema;','verifyCertificate,schemaOfType,stage'],
    ['fusion','src/fusion.mjs','','planReductionFusion'],
    ['outputFusion','src/output-fusion.mjs','const {layout}=modules.abiSchema;','planOutputFusion'],
    ['outputChecks','test/output-fusion-browser.mjs','','runOutputFusionBrowserChecks'],
    ['simd','src/simd.mjs','','SIMD_OPS,planSIMD,supportsSIMD'],
    ['expandedCorpus','examples/expanded-corpus.mjs','','expandedCorpus'],
    ['unsupportedCorpus','examples/unsupported-corpus.mjs','','unsupportedCorpus'],
    ['wasm','src/wasm.mjs','const {createOrderEmitter}=modules.orderWasm;const {ABI_VERSION,SCRATCH_ABI_VERSION,layout,flatTypes}=modules.abiSchema;const {planReductionFusion}=modules.fusion;const {planOutputFusion}=modules.outputFusion;const {planSIMD,SIMD_OPS}=modules.simd;','uleb,emitModule'],
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
    ['evidenceTransport','src/evidence-transport.mjs','','auditEvidenceTransport,liftEvidenceTransport'],
    ['transportChecks','test/evidence-transport-browser.mjs','','runEvidenceTransportBrowserChecks'],
    ['evidencePresentation','src/evidence-presentation.mjs','const {planReconstruction}=modules.reconstruction;','createEvidencePresentation'],
    ['presentationChecks','test/evidence-presentation-browser.mjs','','runEvidencePresentationBrowserChecks'],
    ['evidenceAlgebra','src/evidence-algebra.mjs','const {createEvidencePresentation}=modules.evidencePresentation;const {planReconstruction}=modules.reconstruction;const {inferEvidenceInterface}=modules.evidenceInterface;const {planEvidenceRefinement,verifyEvidenceRefinement}=modules.evidenceRefinement;const {auditEvidenceTransport,liftEvidenceTransport}=modules.evidenceTransport;','createEvidenceAlgebra'],
    ['algebraChecks','test/evidence-algebra-browser.mjs','','runEvidenceAlgebraBrowserChecks'],
    ['compiler','src/compiler.mjs','const {CompileError,parse,infer}=modules.frontend;const {stage,verifyCertificate}=modules.jte;const {emitModule}=modules.wasm;const {supportsSIMD}=modules.simd;const {formatDiagnostic}=modules.diagnostics;const {planReconstruction,reconstructionSource}=modules.reconstruction;const {planDescent,verifyDescent,descentSource}=modules.descent;const {planDescentExtension,descentCountermodel,descentExtensionSource}=modules.descentExtension;const {planDescentQuery,verifyDescentQuery,verifyDescentQueryCost,descentQuerySource}=modules.descentQuery;const {planDescentBatch,verifyDescentBatch,descentBatchSource}=modules.descentBatch;const {createEvidenceAlgebra}=modules.evidenceAlgebra;','createEvidenceAlgebra,planDescentBatch,verifyDescentBatch,descentBatchSource,planDescentQuery,verifyDescentQuery,verifyDescentQueryCost,descentQuerySource,planDescentExtension,descentCountermodel,descentExtensionSource,planDescent,verifyDescent,descentSource,planReconstruction,reconstructionSource,compile,compileSources,check,checkSources,formatDiagnostic,createCompiler,instantiate,CompileError,verifyCertificate,supportsSIMD'],
    ['workflowCalibration','examples/case-studies/workflows/calibration-kernel.mjs','','calibrationSource'],
    ['workflowCommon','examples/case-studies/workflows/common.mjs','','record,finite,integer,boolean,text,samples,lowering,json,MAX_SAMPLES,MAX_REQUEST_SAMPLES,RUNTIME_PAGES,DEFAULT_LOOP_BUDGET'],
    ['calibrationModel','examples/case-studies/workflows/calibration-model.mjs','const {record,finite}=modules.workflowCommon;','scaledCoordinates,calibrationModel,calibrationModelSource'],
    ['workflowRelease','examples/case-studies/workflows/release-kernel.mjs','const {createEvidenceAlgebra}=modules.compiler;','releaseKernel'],
    ['workflowChecks','test/workflows-browser.mjs','const {calibrationSource}=modules.workflowCalibration;const {releaseKernel}=modules.workflowRelease;','runWorkflowBrowserChecks'],
    ['abi','src/abi.mjs','const {ABI_VERSION,SCRATCH_ABI_VERSION,alignTo,layout,flatTypes,isScalarSchema}=modules.abiSchema;','ABIError,Arena,readABI,createRuntime,createCapability,prepareCall'],
    ['calibrationHost','examples/case-studies/workflows/calibration.mjs','const {compileSources}=modules.compiler;const {createRuntime}=modules.abi;const {calibrationSource}=modules.workflowCalibration;const {scaledCoordinates,calibrationModel,calibrationModelSource}=modules.calibrationModel;const {record,finite,integer,samples,lowering,RUNTIME_PAGES}=modules.workflowCommon;','fitCalibration,predictCalibration'],
    ['calibrationChecks','test/calibration-coordinates-browser.mjs','const {fitCalibration,predictCalibration}=modules.calibrationHost;const {calibrationModelSource}=modules.calibrationModel;','runCalibrationCoordinatesBrowserChecks'],
    ['localPatternCases','test/local-patterns-cases.mjs','','localPatternCases'],
    ['localPatternChecks','test/local-patterns-browser.mjs','const {localPatternCases}=modules.localPatternCases;','runLocalPatternBrowserChecks'],
    ['partitionOrder','examples/research/partition-order.mjs','','partitionOrder,verifyOrder'],
    ['partitionKeys','examples/research/partition-keys.mjs','','partitionKeySource'],
    ['partitionChecks','test/partition-order-browser.mjs','const {partitionOrder,verifyOrder}=modules.partitionOrder;const {partitionKeySource}=modules.partitionKeys;','runPartitionOrderBrowserChecks'],
    ['arrayViewChecks','test/array-views-browser.mjs','','runArrayViewBrowserChecks'],
    ['lexicographicChecks','test/lexicographic-keys-browser.mjs','','runLexicographicKeyBrowserChecks'],
    ['nativeOrderingChecks','test/native-ordering-browser.mjs','','runNativeOrderingBrowserChecks'],
    ['chunkChecks','test/chunk-views-browser.mjs','','runChunkViewBrowserChecks'],
    ['feedbackSensitivitySource','examples/case-studies/feedback/sensitivity-kernel.mjs','','feedbackSensitivitySource'],
    ['feedbackChecks','test/machine-feedback-browser.mjs','const {feedbackSensitivitySource}=modules.feedbackSensitivitySource;','runMachineFeedbackBrowserChecks'],
    ['machineSensitivitySource','examples/case-studies/machines/sensitivity-kernel.mjs','','sensitivitySource'],
    ['machineSensitivityChecks','test/machine-differentials-browser.mjs','const {sensitivitySource}=modules.machineSensitivitySource;','runMachineSensitivityBrowserChecks'],
    ['clockedMachineCases','test/clocked-machines-cases.mjs','','clockedMachineCases'],
    ['clockedMachineChecks','test/clocked-machines-browser.mjs','const {clockedMachineCases}=modules.clockedMachineCases;','runClockedMachineBrowserChecks'],
    ['corePreludeCases','test/core-prelude-cases.mjs','','corePreludeCases'],
    ['corePreludeChecks','test/core-prelude-browser.mjs','const {preludeSource}=modules.prelude;const {corePreludeCases}=modules.corePreludeCases;','runCorePreludeBrowserChecks'],
    ['operatorCalibration','examples/case-studies/operators/calibration-kernel.mjs','','operatorCalibrationSource'],
    ['sourceOperatorChecks','test/source-operators-browser.mjs','const {operatorCalibrationSource}=modules.operatorCalibration;','runSourceOperatorBrowserChecks'],
    ['allOperatorChecks','test/all-source-operators-browser.mjs','','runAllSourceOperatorBrowserChecks'],
    ['lexicalCases','test/lexical-operator-cases.mjs','','lexicalOperatorCases,lexicalProgram'],
    ['lexicalChecks','test/lexical-operators-browser.mjs','const {lexicalOperatorCases,lexicalProgram}=modules.lexicalCases;','runLexicalOperatorBrowserChecks'],
    ['unaryCases','test/unary-cases.mjs','','unaryCases'],
    ['reference','test/reference.mjs','const {parse,builtinArities}=modules.frontend;','reference'],
    ['corpus','examples/corpus.mjs','const {expandedCorpus}=modules.expandedCorpus;const {unsupportedCorpus}=modules.unsupportedCorpus;','unsupportedCorpus,corpus,baselines,benchmarkArguments,expansionSource,exampleSource'],
    ['benchmark','scripts/benchmark-core.mjs','const {compile}=modules.compiler;const {Arena,prepareCall,createRuntime,createCapability}=modules.abi;const {corpus,baselines,benchmarkArguments,expansionSource,exampleSource}=modules.corpus;','runBenchmarks,quantiles'],
  ];
  let code='const modules={};\n';
  for(const [name,path,imports,exports] of specs)code+=`modules.${name}=(()=>{${imports}\n${await read(path)}\nreturn {${exports}};})();\n`;
  const sources={};for(const e of [...corpus,...unsupportedCorpus])for(const path of [...(e.libraries??[]),e.path])if(!Object.hasOwn(sources,path))sources[path]=await readFile(new URL('../examples/'+path,import.meta.url),'utf8');
  sources['../lib/machine-differentials.ass']=await readFile(new URL('../lib/machine-differentials.ass',import.meta.url),'utf8');
  code+=`globalThis.asslangSources=${JSON.stringify(sources)};\n`;
  if(benchmark) {
    code+=`const report=await modules.benchmark.runBenchmarks({loadSource:async path=>globalThis.asslangSources[path],compileSamples:15,samples:11});report.environment={engine:navigator.userAgent};return report;`;
  } else {
    code+='const {runAllSourceOperatorBrowserChecks}=modules.allOperatorChecks;const {runLexicalOperatorBrowserChecks}=modules.lexicalChecks;const {runMachineFeedbackBrowserChecks}=modules.feedbackChecks;const {runMachineSensitivityBrowserChecks}=modules.machineSensitivityChecks;const {runClockedMachineBrowserChecks}=modules.clockedMachineChecks;const {runCorePreludeBrowserChecks}=modules.corePreludeChecks;const {runChunkViewBrowserChecks}=modules.chunkChecks;const {runArrayViewBrowserChecks}=modules.arrayViewChecks;const {runLexicographicKeyBrowserChecks}=modules.lexicographicChecks;const {runNativeOrderingBrowserChecks}=modules.nativeOrderingChecks;const {runPartitionOrderBrowserChecks}=modules.partitionChecks;const {runLocalPatternBrowserChecks}=modules.localPatternChecks;const {runCalibrationCoordinatesBrowserChecks}=modules.calibrationChecks;const {runOutputFusionBrowserChecks}=modules.outputChecks;const {runWorkflowBrowserChecks}=modules.workflowChecks;const {unaryCases}=modules.unaryCases;const {createEvidenceAlgebra,compile,compileSources,check,checkSources,formatDiagnostic,createCompiler,instantiate,supportsSIMD,planReconstruction,reconstructionSource,planDescentExtension,descentCountermodel,descentExtensionSource,planDescentQuery,verifyDescentQuery,verifyDescentQueryCost,descentQuerySource,planDescentBatch,verifyDescentBatch,descentBatchSource}=modules.compiler;const {runEvidencePresentationBrowserChecks}=modules.presentationChecks;const {runEvidenceTransportBrowserChecks}=modules.transportChecks;const {runEvidenceRefinementBrowserChecks}=modules.refinementChecks;const {runEvidenceInterfaceBrowserChecks}=modules.interfaceChecks;const {runDescentBatchBrowserChecks}=modules.batchChecks;const {runDescentQueryBrowserChecks}=modules.queryChecks;const {runDescentExtensionBrowserChecks}=modules.extensionChecks;const {diagnosticCases}=modules.diagnosticCases;const {selectDiagnostic}=modules.navigation;const {createRuntime,createCapability}=modules.abi;const {reference}=modules.reference;const {corpus,unsupportedCorpus,exampleSource}=modules.corpus;\n';
    code+='const {runChunkCompositionBrowserChecks}=modules.chunkScanChecks;';
    code+='const {runSourceOperatorBrowserChecks}=modules.sourceOperatorChecks;\n';
    code+='const {runTypeProgrammingBrowserChecks}=modules.typeProgrammingChecks;';
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
