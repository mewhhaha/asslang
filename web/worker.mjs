import { compile, check, CompileError, formatDiagnostic } from '../src/compiler.mjs';
import { createRuntime, createCapability } from '../src/abi.mjs';
// JSON cannot represent typed arrays; the playground converts Bytes explicitly.
function fromJSON(schema,value) {
  if(schema.kind==='Bytes') {
    if(!Array.isArray(value) || !value.every(x=>Number.isInteger(x)&&x>=0&&x<=255))throw new Error('Bytes input requires an array of integers 0..255');
    return Uint8Array.from(value);
  }
  if(schema.kind==='Record')return Object.fromEntries(schema.fields.map(f=>[f.name,fromJSON(f.schema,value?.[f.name])]));
  return value;
}
self.onmessage = async ({data}) => {
  try {
    if (!data || typeof data !== 'object') throw new Error('Worker request must be an object');
    if (data.mode !== undefined && !['check', 'run'].includes(data.mode)) throw new Error('Unknown worker mode');
    if (data.mode === 'check') {
      // Return before arguments, runtimes, or capabilities are touched.
      const report = check(data.source, { experimentalReductionFusion: data.experimentalReductionFusion ?? true, simd: data.simd ?? false });
      self.postMessage({ mode: 'check', ...report,
        ...(report.ok ? {} : { error: report.diagnostics.map(formatDiagnostic).join('\n\n') }) });
      return;
    }
    const {source}=data,name=data.name??'main',args=data.args??[data.n];
    const compiled=compile(source,{experimentalReductionFusion:data.experimentalReductionFusion??true,simd:data.simd??false}),entry=compiled.abi.exports.find(e=>e.name===name);
    if(!entry)throw new Error(`No export named '${name}'`);
    if(!Array.isArray(args)||args.length!==entry.parameters.length)throw new Error('Arguments must be a JSON array matching the export parameters');
    const input=entry.parameters.map((p,i)=>fromJSON(p.schema,args[i]));
    const events=[];
    const capability=data.allowDemoEffects ? createCapability({
      read_scale:{parameters:['Text'],result:'Num',validate:key=>key==='demo',call:()=>0.5},
      audit:{parameters:['Text','Num'],result:'Bool',validate:(key,value)=>key==='demo'&&Number.isFinite(value)&&Math.abs(value)<=1000000,
        call:(key,value)=>{events.push({operation:'audit',key,value});return true;}},
    },{maxCalls:8}):undefined;
    const before=performance.now(),runtime=await createRuntime(compiled,{pages:4}),ready=performance.now();
    const value=runtime.call(name,input,{capability}),end=performance.now();
    self.postMessage({value,events,abi:compiled.abi,stats:compiled.stats,signatures:compiled.signatures,observations:compiled.observations,certificate:compiled.certificate,
      memoryBytes:runtime.memoryBytes,instantiateMilliseconds:ready-before,runMilliseconds:end-ready});
  } catch(error) {
    if (error instanceof CompileError) {
      const diagnostic = error.toDiagnostic(data?.source);
      self.postMessage({ error: formatDiagnostic(diagnostic), diagnostics: [diagnostic] });
    } else self.postMessage({ error: `${error.code ?? error.name}: ${error.message}` });
  }
};
