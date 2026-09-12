import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionOrder, verifyOrder } from '../examples/research/partition-order.mjs';
import { referenceOrder } from '../examples/research/partition-reference.mjs';
import { partitionKeySource } from '../examples/research/partition-keys.mjs';
import { compile, check, checkSources } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';
import { runPartitionOrderBrowserChecks } from './partition-order-browser.mjs';
const policies = ['first', 'middle', 'median3'];
const modes = [false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const expected = keys => Array.from(keys,(_,i)=>i).sort((a,b)=>keys[a]-keys[b] || a-b);
function bounds(n, stats) {
  const l = Math.ceil(Math.log2(Math.max(1,n)));
  assert(stats.work <= n*(9*l+2));
  assert(stats.comparisons <= n*(3*l+3));
  assert(stats.pendingPeak <= l+2);
  assert.equal(stats.typedArrayBytes,17*n+12*(l+2));
}

test('exhaust every three-key word through length seven for all pivot policies', t => {
  let words=0, runs=0;
  for(let n=0;n<=7;n++) for(let value=0;value<3**n;value++) {
    let code=value;
    const keys=Array.from({length:n},()=>{const key=code%3-1;code=Math.floor(code/3);return key;});
    const order=expected(keys);
    for(const pivot of policies) {
      const result=partitionOrder(keys,{pivot});
      assert.deepEqual([...result.indices],order);
      assert(verifyOrder(keys,result.indices));bounds(n,result.stats);runs++;
    }
    words++;
  }
  assert.equal(words,3280);assert.equal(runs,9840);
  t.diagnostic(JSON.stringify({words,runs}));
});

test('literal stable recurrence and region lowering agree on seeded finite inputs',t=>{
  let seed=7926, cases=0;const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let n=0;n<200;n++) {
    const keys=Array.from({length:random()%100},()=>random()%31-15);
    for(const pivot of policies) {
      const result=partitionOrder(keys,{pivot}),spec=referenceOrder(keys,{pivot});
      assert.deepEqual([...result.indices],spec.indices);assert.deepEqual(spec.indices,expected(keys));
      assert(verifyOrder(keys,result.indices));bounds(keys.length,result.stats);cases++;
    }
  }
  t.diagnostic(JSON.stringify({cases}));
});

test('first-pivot adversaries really enter the stable fallback and obey the work bound',()=>{
  for(const n of [64,255,2048,10000]) for(const reversed of [false,true]) {
    const keys=Array.from({length:n},(_,i)=>Math.floor((reversed?n-i-1:i)/3));
    const result=partitionOrder(keys,{pivot:'first'});
    assert(result.stats.fallbacks>0);assert.deepEqual([...result.indices],expected(keys));
    assert(verifyOrder(keys,result.indices));bounds(n,result.stats);
  }
});

test('duplicate-heavy, organ-pipe, alternating and extreme-key families preserve exact positions',()=>{
  const n=4096;
  for(const keys of [
    Array(n).fill(3),Array.from({length:n},(_,i)=>i%2),Array.from({length:n},(_,i)=>Math.min(i,n-i)),
    Array.from({length:n},(_,i)=>i%2?i:-i),
    [-Number.MAX_VALUE,Number.MAX_VALUE,Number.MIN_VALUE,-Number.MIN_VALUE,-0,0,-0,0],
  ]) for(const pivot of policies) {
    const result=partitionOrder(keys,{pivot});assert.deepEqual([...result.indices],expected(keys));
    assert(verifyOrder(keys,result.indices));bounds(keys.length,result.stats);
  }
  const equal=partitionOrder(Array(n).fill(3));
  assert.equal(equal.stats.partitions,1);assert.equal(equal.stats.classified,n);
  assert.equal(equal.stats.scatterWrites,0);assert.equal(equal.stats.mergeWrites,0);
});

test('independent verifier rejects corruption, including sorted-but-unstable equal keys',()=>{
  const keys=[2,1,2,0], valid=[3,1,0,2];assert(verifyOrder(keys,valid));
  for(const wrong of [[3,1,2,0],[3,1,0,0],[3,1,0],[3,1,0,4],[3,1,0,-1],
    [3,1,0,0.5],[0,1,2,3],null,{},new Array(4)]) assert.equal(verifyOrder(keys,wrong),false);
  assert.equal(verifyOrder([NaN],[0]),false);assert.equal(verifyOrder([Infinity],[0]),false);
  assert.equal(verifyOrder({},[]),false);assert(verifyOrder([],[]));
});

test('source key buffers and returned permutations do not alias; stats are immutable',()=>{
  const keys=Float64Array.of(3,1,2,1), before=keys.slice(),first=partitionOrder(keys),second=partitionOrder(keys);
  assert.deepEqual(keys,before);assert.deepEqual(first.indices,second.indices);
  first.indices[0]=99;assert.equal(second.indices[0],1);
  keys[0]=0;assert.equal(second.indices[3],0);
  assert.throws(()=>first.stats.work=0,TypeError);
});

test('work exhaustion never publishes a partial result and later calls have fresh budgets',()=>{
  const keys=Array.from({length:200},(_,i)=>200-i),snapshot=[...keys];
  const result=partitionOrder(keys,{pivot:'first'});
  assert.deepEqual(partitionOrder(keys,{pivot:'first',maxWork:result.stats.work}).indices,result.indices);
  assert.throws(()=>partitionOrder(keys,{pivot:'first',maxWork:result.stats.work-1}),e=>e.code==='E_PARTITION_WORK');
  assert.deepEqual(keys,snapshot);assert.deepEqual([...partitionOrder([2,1]).indices],[1,0]);
  assert.throws(()=>partitionOrder([1],{maxWork:0}),/work limit/);
  assert.deepEqual([...partitionOrder([],{maxWork:0}).indices],[]);
});

test('bounds, invalid keys and unknown execution options fail explicitly',()=>{
  for(const input of [null,{},[NaN],[Infinity],['1'],[1,undefined],new Array(2),new Uint8Array(2)])
    assert.throws(()=>partitionOrder(input));
  for(const options of [null,[],{pivot:'random'},{stable:false},{maxWork:-1},{maxWork:1.5},{maxWork:1e9+1}])
    assert.throws(()=>partitionOrder([],options));
  assert.throws(()=>partitionOrder(new Float64Array(1_048_577)),/Key count/);
  const largest=partitionOrder(new Float64Array(1_048_576));
  assert.equal(largest.indices.length,1_048_576);assert(verifyOrder(new Float64Array(1_048_576),largest.indices));
  bounds(largest.indices.length,largest.stats);
});

for(const mode of modes) test(`actual Asslang key production composes with host ordering ${JSON.stringify(mode)}`,async()=>{
  const compiled=compile(partitionKeySource,{...mode,maxLoopIterations:5});
  assert.equal(compiled.stats.functions[0].loops,1);
  const runtime=await createRuntime(compiled),readings=[7,10,4,7,5];
  const keys=runtime.call('distance_keys',[readings,5]);
  const ordered=partitionOrder(keys);assert(verifyOrder(keys,ordered.indices));
  assert.deepEqual([...ordered.indices],[4,2,0,3,1]);assert.deepEqual([...keys],[2,5,1,2,0]);
  assert.throws(()=>runtime.call('distance_keys',[[1,2,3,4,5,6],0]),WebAssembly.RuntimeError);
  assert.throws(()=>runtime.call('distance_keys',[[],NaN]),WebAssembly.RuntimeError);
  assert.throws(()=>runtime.call('distance_keys',[[Number.MAX_VALUE],-Number.MAX_VALUE]),WebAssembly.RuntimeError);
  assert.equal(runtime.call('distance_keys',[[5],5])[0],0);
});

test('proposed recursion syntax is not accidentally advertised as an implemented intrinsic',()=>{
  const source='export fn quicksort = (xs:[Num]) -> partition_rec xs (x -> x) (recur -> parts -> parts);';
  assert.equal(check(source).diagnostics[0].code,'E_NAME');
  const checked=checkSources([{name:'proposed.ass',source}]);
  assert.equal(checked.diagnostics[0].sourceName,'proposed.ass');
  const hosts='host fn key:Num -> Num; export fn main = (xs:[Num]) -> map xs (x -> key x);';
  assert.equal(check(hosts).diagnostics[0].code,'E_EFFECT');
});

test('browser experiment runs the same real key kernels and independently checked permutations',async()=>{
  const report={checks:0,cases:[]};
  await runPartitionOrderBrowserChecks({compile},createRuntime,report);
  assert.equal(report.checks,28);assert.equal(report.cases.length,1);
});
