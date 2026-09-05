import { compile, CompileError } from '../src/compiler.mjs';
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
    const {source}=data,name=data.name??'main',args=data.args??[data.n];
    const compiled=compile(source),entry=compiled.abi.exports.find(e=>e.name===name);
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
    self.postMessage({error:error instanceof CompileError?error.format(data.source):`${error.code??error.name}: ${error.message}`});
  }
};
