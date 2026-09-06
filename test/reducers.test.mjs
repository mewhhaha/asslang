import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSources } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';
const library={name:'lib/reducers.ass',source:await readFile(new URL('../lib/reducers.ass',import.meta.url),'utf8')};
const build=(source,options)=>compileSources([library,{name:'main.ass',source}],options);

test('ordinary reducer products fuse structurally without experimental optimization', async () => {
  const c=build(`export fn main(xs:[Num])=reduce_with(xs,reducer_product(sum_reducer(),
    reducer_map_input(sum_reducer(),x=>x*x)));`);
  assert.equal(c.stats.functions[0].loops,1);
  assert.equal(c.stats.functions[0].reductionFusion.enabled,false);
  assert.equal(c.stats.kernelHeapAllocationSites,0);
  assert.deepEqual((await createRuntime(c)).call('main',[[1,2,3]]),{left:6,right:14});
});

test('input transforms, gated reducers, output transforms and scans compose', async () => {
  const c=build(`export fn main(xs:[Num])=scan_with(xs,reducer_map_result(
    reducer_filter(reducer_map_input(sum_reducer(),x=>x*x),x=>x>0),sqrt));`);
  assert.equal(c.stats.functions[0].loops,1);assert.equal(c.stats.functions[0].stateMachines,1);
  assert.deepEqual(Array.from((await createRuntime(c)).call('main',[[3,-4,4]])),[3,3,5]);
});

test('completed terminal product lanes freeze, including trapping predicates in later inputs', async () => {
  const c=build(`export fn main(xs:[Num])=until_with(xs,until_both(
    first_matching(x=>require(x<3,x==2),-1),threshold_reducer(6)));`);
  assert.equal(c.stats.functions[0].loops,1);
  const r=await createRuntime(c);
  assert.deepEqual(r.call('main',[[2,4,100]]),{
    value:{left:{value:2,done:true},right:{value:6,done:true}},steps:2,done:true,
  });
  assert.throws(()=>r.call('main',[[1,4]]),WebAssembly.RuntimeError);
});

test('terminal products distinguish either, both, and exhaustion with partial completion', async () => {
  for(const [operation,expected] of [
    ['until_either',{value:{left:{value:2,done:true},right:{value:3,done:false}},steps:2,done:true}],
    ['until_both',{value:{left:{value:2,done:true},right:{value:6,done:false}},steps:3,done:false}],
  ]) {
    const r=await createRuntime(build(`export fn main(xs:[Num])=until_with(xs,
      ${operation}(first_matching(x=>x==2,-1),threshold_reducer(100)));`));
    assert.deepEqual(r.call('main',[[1,2,3]]),expected);
  }
});

test('terminal reducer identities handle empty streams and composed input transformations', async () => {
  const r=await createRuntime(build(`export fn main(xs:[Num])={
    any:until_with(xs,any_reducer(x=>x>0)), all:until_with(xs,all_reducer(x=>x>0)),
    squared:until_with(xs,until_map_input(threshold_reducer(10),x=>x*x))
  };`));
  assert.deepEqual(r.call('main',[[]]),{
    any:{value:false,done:false,steps:0},all:{value:true,done:false,steps:0},squared:{value:0,done:false,steps:0},
  });
  assert.deepEqual(r.call('main',[[2,-3,100]]).squared,{value:13,done:true,steps:2});
});

test('800 seeded early-exit cases agree with independent loops across optimization settings', async () => {
  const source=`export fn main(xs:[Num],limit:Num)=until_with(xs,until_both(
    first_matching(x=>x>limit,-1),threshold_reducer(limit+3)));`;
  const runtimes=await Promise.all([false,true].flatMap(memoizeReductions=>[false,true].map(experimentalReductionFusion=>
    createRuntime(build(source,{memoizeReductions,experimentalReductionFusion})))));
  let seed=0x492bad13;
  const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let trial=0;trial<200;trial++) {
    const xs=Array.from({length:random()%25},()=>random()%21-5),limit=random()%12;
    let left=-1,right=0,leftDone=false,rightDone=false,steps=0;
    for(const x of xs){if(!leftDone&&x>limit){left=x;leftDone=true;}if(!rightDone){right+=x;rightDone=right>=limit+3;}steps++;if(leftDone&&rightDone)break;}
    const expected={value:{left:{value:left,done:leftDone},right:{value:right,done:rightDone}},steps,done:leftDone&&rightDone};
    for(const r of runtimes)assert.deepEqual(r.call('main',[xs,limit]),expected);
  }
});
