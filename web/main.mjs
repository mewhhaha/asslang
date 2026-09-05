import { corpus } from '../examples/corpus.mjs';
const output=document.querySelector('#output'),details=document.querySelector('#details'),examples=document.querySelector('#examples');
let worker=null,timer=null;
const display=(_key,value)=>ArrayBuffer.isView(value)?Array.from(value):typeof value==='number'&&!Number.isFinite(value)?String(value):Object.is(value,-0)?'-0':value;
function stop(){worker?.terminate();worker=null;clearTimeout(timer);}
for(const e of corpus){const option=document.createElement('option');option.value=e.id;option.textContent=e.id;examples.append(option);}
examples.onchange=async()=>{
  const e=corpus.find(e=>e.id===examples.value);if(!e)return;
  try {
    const response=await fetch('../examples/'+e.path);if(!response.ok)throw new Error('Example load failed');
    document.querySelector('#source').value=await response.text();
    document.querySelector('#name').value=e.name;document.querySelector('#args').value=JSON.stringify(e.args,display);
    // Loading an effectful example is not a grant. The checkbox remains explicit.
    document.querySelector('#effects').checked=false;
  }catch(error){output.textContent=error.message;}
};
document.querySelector('#cancel').onclick=()=>{stop();output.textContent='Cancelled.';};
document.querySelector('#run').onclick=()=>{
  stop();let args;
  try{args=JSON.parse(document.querySelector('#args').value);}catch{output.textContent='Arguments must be valid JSON.';return;}
  output.textContent='Compiling and running…';details.textContent='';
  worker=new Worker('./worker.mjs',{type:'module'});
  timer=setTimeout(()=>{stop();output.textContent='Stopped at the playground resource limit (10 seconds).';},10000);
  worker.onmessage=({data})=>{
    stop();if(data.error){output.textContent=data.error;return;}
    output.textContent=JSON.stringify({result:data.value,hostEvents:data.events,wasmBytes:data.stats.wasmBytes,
      abiMetadataBytes:data.stats.abiMetadataBytes,compileMilliseconds:data.stats.milliseconds.total,
      instantiateMilliseconds:data.instantiateMilliseconds,runAndMarshalMilliseconds:data.runMilliseconds,
      memoryBytes:data.memoryBytes,kernels:data.stats.functions},display,2);
    details.textContent=JSON.stringify({signatures:data.signatures,observations:data.observations,abi:data.abi,certificate:data.certificate},null,2);
  };
  worker.onerror=event=>{stop();output.textContent=event.message;};
  worker.postMessage({source:document.querySelector('#source').value,name:document.querySelector('#name').value,args,
    allowDemoEffects:document.querySelector('#effects').checked});
};
