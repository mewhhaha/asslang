// Single source of truth for example discovery, correctness tests and benchmarks.
// Baselines are ordinary hand-written JS algorithms, not translations of the IR.
export const corpus = [
  {id:'prefix-scan',path:'algorithms/prefix_scan.ass',name:'prefixes',args:[[1,2,3]],expected:[1,3,6],baseline:'prefixes',size:8192},
  {id:'ewma',path:'algorithms/ewma.ass',name:'smooth',args:[[2,4,8,4],0.5],expected:[2,3,5.5,4.75],baseline:'ewma',size:8192},
  {id:'segmented',path:'algorithms/segmented_scan.ass',name:'segmented',args:[[1,2,3,4,5],[false,false,true,false,true]],expected:[1,3,3,7,5],baseline:'segmented',size:8192},
  {id:'running-zscore',path:'algorithms/running_zscore.ass',name:'zscores',args:[[2,4,6]],expected:[0,1,1.224744871391589],baseline:'zscores',size:8192},
  {id:'rolling-mean',path:'algorithms/rolling_mean.ass',name:'rolling_mean',args:[[1,2,3,4,5],3],expected:[1,1.5,2,3,4],baseline:'rollingMean',size:8192},
  {id:'parse-uints',path:'algorithms/parse_uints.ass',name:'integers',args:['12, 003 99'],expected:[12,3,99],baseline:'integers',size:2048},
  {id:'newton',path:'algorithms/newton.ass',name:'root',args:[4,0.000000001,32],expected:{state:2,done:true,steps:6},baseline:'newton',size:32},
  {id:'machine-composition',path:'concepts/machine_composition.ass',name:'relative_changes',args:[[1,1,3,3,2,5]],expected:[2,1,4],baseline:'relativeChanges',size:8192},
  {id:'machine-product',path:'concepts/machine_product.ass',name:'analyze',args:[[1,2,3]],expected:{count:3,mean:2,energy:14},baseline:'analyze',size:8192},
  {id:'scan-replay',path:'pathological/scan_replay.ass',name:'replay',args:[[1,2,3]],expected:{total:10,peak:6},baseline:'scanReplay',size:8192},
  {id:'energy',path:'energy.ass',name:'energy',args:[[1,-2,3,4]],expected:30,baseline:'energy',size:8192},
  {id:'sum-squares',path:'energy.ass',name:'sum_squares',args:[8],expected:140,baseline:'sumSquares',size:8192},
  {id:'cohort',path:'cohort.ass',name:'score',args:[[-2,0,1,3]],expected:28,baseline:'cohort',size:8192},
  {id:'dot',path:'dot.ass',name:'dot',args:[[1,2,3],[4,5,6]],expected:32,baseline:'dot',size:8192},
  {id:'welford',path:'algorithms/welford.ass',name:'statistics',args:[[2,4,4,4,5,5,7,9]],expected:{count:8,mean:5,variance:4,valid:true},baseline:'welford',size:8192},
  {id:'fibonacci',path:'algorithms/fibonacci.ass',name:'fibonacci',args:[20],expected:6765,baseline:'fibonacci',size:40},
  {id:'normalize',path:'algorithms/normalize.ass',name:'normalize',args:[[3,4]],expected:[0.6,0.8],baseline:'normalize',size:8192},
  {id:'convolution',path:'algorithms/convolution.ass',name:'convolve',args:[[1,2,3,4],[1,2]],expected:[5,8,11],baseline:'convolution',size:1024},
  {id:'regression',path:'algorithms/linear_regression.ass',name:'regression',args:[[1,2,3,4],[3,5,7,9]],expected:{slope:2,intercept:1,valid:true},baseline:'regression',size:8192},
  {id:'lower-bound',path:'algorithms/binary_search.ass',name:'lower_bound',args:[[1,2,2,5],2],expected:{index:1,found:true},baseline:'lowerBound',size:8192},
  {id:'polynomial',path:'algorithms/polynomial.ass',name:'evaluate',args:[[2,3,4],5],expected:69,baseline:'polynomial',size:256},
  {id:'partition',path:'algorithms/partition.ass',name:'partition',args:[[-2,0,3,-1]],expected:{positive:[0,3],negative:[-2,-1]},baseline:'partition',size:8192},
  {id:'pairwise',path:'algorithms/pairwise_distance.ass',name:'pairwise',args:[[1,3,4]],expected:28,baseline:'pairwise',size:96},
  {id:'checksum',path:'algorithms/byte_checksum.ass',name:'checksum',args:[new Uint8Array([1,2,255])],expected:258,baseline:'checksum',size:8192},
  {id:'traits',path:'concepts/traits.ass',name:'aggregates',args:[[1,2,3,4]],expected:{sum:10,product:24}},
  {id:'type-shapes',path:'concepts/type_shapes.ass',name:'shapes',args:[5,true],expected:{pair:{first:5,second:true},selected:5,transformed:12}},
  {id:'contracts',path:'concepts/refinements.ass',name:'safe_ratio',args:[6,2],expected:3},
  {id:'relations',path:'concepts/refinements.ass',name:'aligned',args:[[-1,0,4,9]],expected:21},
  {id:'shared-reduction',path:'pathological/shared_reduction.ass',name:'shared',args:[[1,2,3]],expected:[7,8,9],baseline:'shared',size:8192},
  {id:'prefixes-quadratic',path:'pathological/repeated_prefix.ass',name:'prefixes',args:[[1,2,3]],expected:[1,3,6],baseline:'prefixes',size:256},
  {id:'multi-reduction',path:'pathological/multi_reduction.ass',name:'moments',args:[[1,2,3]],expected:{count:3,total:6,energy:14},baseline:'moments',size:8192},
  {id:'staging-expansion',path:'pathological/expansion.ass',name:'expanded',args:[1],expected:129},
  {id:'roundtrip',path:'interop/roundtrip.ass',name:'summarize',args:[{name:'Å字🙂',payload:new Uint8Array([0,255]),values:[1,2,3],enabled:true}],expected:{name:'Å字🙂',payload:new Uint8Array([0,255]),summary:{enabled:true,bytes:2,total:6},doubled:[2,4,6]}},
  {id:'host-effects',path:'interop/host_effects.ass',name:'measured',args:['demo',[3,4]],expected:{accepted:true,value:12.5},host:true},
];
export const rejectedCorpus = [
  {path:'rejected/scan_index.ass',code:'E_CAUSAL_ACCESS'},
  {path:'rejected/transducer_alignment.ass',code:'E_DOMAIN'},
  {path:'rejected.ass',code:'E_DOMAIN'},
];
export const baselines = {
  ewma(xs,alpha){const out=new Float64Array(xs.length);let mean=0;for(let i=0;i<xs.length;i++){mean=i?mean+alpha*(xs[i]-mean):xs[i];out[i]=mean;}return out;},
  segmented(xs,resets){const out=new Float64Array(xs.length);let s=0;for(let i=0;i<xs.length;i++)out[i]=s=resets[i]?xs[i]:s+xs[i];return out;},
  zscores(xs){const out=new Float64Array(xs.length);let n=0,mean=0,m2=0;for(let i=0;i<xs.length;i++){const x=xs[i],d=x-mean;n++;mean+=d/n;m2+=d*(x-mean);out[i]=n>1&&m2>0?(x-mean)/Math.sqrt(m2/n):0;}return out;},
  rollingMean(xs,width){const out=new Float64Array(xs.length);let s=0;for(let i=0;i<xs.length;i++){s+=xs[i];if(i>=width)s-=xs[i-width];out[i]=s/Math.min(i+1,width);}return out;},
  integers(text){const trimmed=text.trim();return Float64Array.from(trimmed?trimmed.split(/[\s,]+/).filter(Boolean).map(Number):[]);},
  newton(x,tolerance,budget){let state=1,done=false,steps=0;while(steps<budget&&!done){const next=(state+x/state)/2;done=Math.abs(next-state)<=tolerance;state=next;steps++;}return {state,done,steps};},
  relativeChanges(xs){const out=[];let seen=false,previous=0,total=0;for(const x of xs){if(!seen){seen=true;previous=x;}else if(x!==previous){total+=x-previous;previous=x;out.push(total);}}return Float64Array.from(out);},
  analyze(xs){let count=0,total=0,energy=0;for(const x of xs){count++;total+=x;energy+=x*x;}return {count,mean:count?total/count:0,energy};},
  scanReplay(xs){let prefix=0,total=0,peak=0;for(const x of xs){prefix+=x;total+=prefix;peak=Math.max(peak,prefix);}return {total,peak};},
  energy(xs){let s=0;for(let i=0;i<xs.length;i++)s+=xs[i]*xs[i];return s;},
  sumSquares(n){let s=0;for(let x=0;x<n;x++)s+=x*x;return s;},
  cohort(xs){let s=0;for(let i=0;i<xs.length;i++){const x=xs[i];if(x>0)s+=(x*2)*(x+1);}return s;},
  dot(xs,ys){let s=0;for(let i=0;i<xs.length;i++)s+=xs[i]*ys[i];return s;},
  welford(xs){let count=0,mean=0,m2=0;for(let i=0;i<xs.length;i++){const x=xs[i];count++;const d=x-mean;mean+=d/count;m2+=d*(x-mean);}return {count,mean,variance:count?m2/count:0,valid:count>0};},
  fibonacci(n){let a=0,b=1;for(let i=0;i<n;i++){const next=a+b;a=b;b=next;}return a;},
  normalize(xs){const norm=Math.sqrt(baselines.energy(xs));const out=new Float64Array(xs.length);for(let i=0;i<xs.length;i++)out[i]=norm>0?xs[i]/norm:0;return out;},
  convolution(xs,weights){const out=new Float64Array(Math.max(0,xs.length-weights.length+1));for(let i=0;i<out.length;i++)for(let j=0;j<weights.length;j++)out[i]+=xs[i+j]*weights[j];return out;},
  regression(xs,ys){let n=0,mx=0,my=0,xx=0,xy=0;for(let i=0;i<xs.length;i++){n++;const dx=xs[i]-mx,dy=ys[i]-my;mx+=dx/n;my+=dy/n;xx+=dx*(xs[i]-mx);xy+=dx*(ys[i]-my);}const slope=xx>0?xy/xx:0;return {slope,intercept:my-slope*mx,valid:n>1&&xx>0};},
  lowerBound(xs,key){let lo=0,hi=xs.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(xs[mid]<key)lo=mid+1;else hi=mid;}return {index:lo,found:lo<xs.length&&xs[lo]===key};},
  polynomial(xs,x){let s=0;for(let i=0;i<xs.length;i++)s=s*x+xs[i];return s;},
  partition(xs){let p=0,n=0;for(let i=0;i<xs.length;i++){if(xs[i]>=0)p++;if(xs[i]<0)n++;}const positive=new Float64Array(p),negative=new Float64Array(n);p=0;n=0;for(let i=0;i<xs.length;i++){if(xs[i]>=0)positive[p++]=xs[i];if(xs[i]<0)negative[n++]=xs[i];}return {positive,negative};},
  pairwise(xs){let s=0;for(let i=0;i<xs.length;i++){let inner=0;for(let j=0;j<xs.length;j++)inner+=(xs[i]-xs[j])*(xs[i]-xs[j]);s+=inner;}return s;},
  checksum(xs){let total=0;for(let i=0;i<xs.length;i++)total+=xs[i];return total-Math.floor(total/65536)*65536;},
  shared(xs){let s=0;for(let i=0;i<xs.length;i++)s+=xs[i];const out=new Float64Array(xs.length);for(let i=0;i<xs.length;i++)out[i]=s+xs[i];return out;},
  prefixes(xs){let s=0;const out=new Float64Array(xs.length);for(let i=0;i<xs.length;i++)out[i]=(s+=xs[i]);return out;},
  moments(xs){let count=0,total=0,energy=0;for(let i=0;i<xs.length;i++){const x=xs[i];count++;total+=x;energy+=x*x;}return {count,total,energy};},
};
export function benchmarkArguments(entry,n=entry.size) {
  const xs=Float64Array.from({length:n},(_,i)=>(i%101-50)/16);
  switch(entry.baseline){
    case 'ewma':return [xs,0.125];
    case 'segmented':return [xs,Array.from({length:n},(_,i)=>i%32===0)];
    case 'rollingMean':return [xs,32];
    case 'integers':return [Array.from({length:n},(_,i)=>String(i%997)).join(', ')];
    case 'newton':return [2,1e-12,n];
    case 'fibonacci':case 'sumSquares':return [n];
    case 'dot':return [xs,Float64Array.from(xs,x=>x*0.5+1)];
    case 'regression':return [xs,Float64Array.from(xs,x=>x*2+1)];
    case 'convolution':return [xs,new Float64Array([0.1,0.2,0.4,0.2,0.1])];
    case 'lowerBound':return [Float64Array.from({length:n},(_,i)=>i*2),Math.floor(n*0.73)];
    case 'polynomial':return [xs,0.5];
    case 'checksum':return [Uint8Array.from({length:n},(_,i)=>i%256)];
    default:return [xs];
  }
}
export function expansionSource(depth) {
  return 'fn f0(x)=x+1;\n'+Array.from({length:depth},(_,i)=>`fn f${i+1}(x)=f${i}(f${i}(x));`).join('\n')+`\nexport fn main(x)=f${depth}(x);`;
}
