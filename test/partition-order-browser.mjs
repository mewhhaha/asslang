import { partitionOrder, verifyOrder } from '../examples/research/partition-order.mjs';
import { partitionKeySource } from '../examples/research/partition-keys.mjs';

export async function runPartitionOrderBrowserChecks({compile},createRuntime,report) {
  const assert=(ok,message)=>{if(!ok)throw new Error(`Partition experiment: ${message}`);report.checks++;};
  for(const simd of [false,true]) for(const reductionFusion of [false,true]) {
    const runtime=await createRuntime(compile(partitionKeySource,{simd,reductionFusion,maxLoopIterations:5}));
    const keys=runtime.call('distance_keys',[[7,10,4,7,5],5]),rank=partitionOrder(keys);
    assert([...rank.indices].join(',')==='4,2,0,3,1','stable distance ranking');
    assert(verifyOrder(keys,rank.indices),'independent result check');
    const ascending=Float64Array.from({length:2048},(_,i)=>i),first=partitionOrder(ascending,{pivot:'first'});
    assert(first.stats.fallbacks>0&&verifyOrder(ascending,first.indices),'adversarial fallback');
    const same=partitionOrder(new Float64Array(2048));
    assert(same.stats.classified===2048&&same.stats.partitions===1,'equal keys leave recursion');
    assert(!verifyOrder([0,0],[1,0]),'sorted-but-unstable result rejected');
    let failed=false;try{partitionOrder(keys,{maxWork:1});}catch(e){failed=e.code==='E_PARTITION_WORK';}
    assert(failed,'host work budget is independent');
    assert(verifyOrder(keys,partitionOrder(keys).indices),'fresh call after failure');
  }
  report.cases.push({name:'partition-recursion-experiment',sortingBackend:'JavaScript',keyBackend:'Asslang/Wasm',modes:4});
}
