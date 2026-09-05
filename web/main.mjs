const output=document.querySelector('#output'), details=document.querySelector('#details');
let worker=null, timer=null;
function stop() { worker?.terminate(); worker=null; clearTimeout(timer); }
document.querySelector('#cancel').onclick=()=>{stop();output.textContent='Cancelled.';};
document.querySelector('#run').onclick=()=>{
  stop();
  const n=Number(document.querySelector('#n').value);
  if (!Number.isInteger(n) || n<0 || n>10000000) {output.textContent='Use an integer n between 0 and 10,000,000.';return;}
  output.textContent='Compiling and running…'; details.textContent='';
  worker=new Worker('./worker.mjs',{type:'module'});
  timer=setTimeout(()=>{stop();output.textContent='Stopped at the playground resource limit (10 seconds).';},10000);
  worker.onmessage=({data})=>{
    stop();
    if (data.error) {output.textContent=data.error;return;}
    output.textContent=JSON.stringify({result:data.value,wasmBytes:data.stats.wasmBytes,
      compileMilliseconds:data.stats.milliseconds.total,instantiateMilliseconds:data.instantiateMilliseconds,
      runMilliseconds:data.runMilliseconds,kernels:data.stats.functions,
      kernelHeapAllocationSites:data.stats.kernelHeapAllocationSites,intermediateBufferBytes:data.stats.intermediateBufferBytes},null,2);
    details.textContent=JSON.stringify({signatures:data.signatures,certificate:data.certificate},null,2);
  };
  worker.onerror=event=>{stop();output.textContent=event.message;};
  worker.postMessage({source:document.querySelector('#source').value,n});
};
