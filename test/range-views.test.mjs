import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSources, checkSources, instantiate } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

const views={name:'views.ass',source:await readFile(new URL('../lib/views.ass',import.meta.url),'utf8')};
const files=source=>[views,{name:'app.ass',source}];
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const plain=value=>ArrayBuffer.isView(value)||Array.isArray(value)?Array.from(value,plain):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v)])):value;
const reject=(source,code)=>{
  const checked=checkSources(files(source));
  assert.equal(checked.ok,false,source);
  assert.equal(checked.diagnostics[0].code,code);
  assert.equal(checked.diagnostics[0].sourceName,'app.ass');
};

const numeric=`export fn main = (xs:[Num]) -> (start:Num) -> (length:Num) -> (gain:Num) ->
  map_range xs start length (x -> x*gain);`;

test('map_range specializes across all lowering modes and matches a positional oracle',async()=>{
  for(const mode of modes){
    const artifact=compileSources(files(numeric),mode),runtime=await createRuntime(artifact);
    assert.equal(artifact.abi.version,1);
    assert.equal(artifact.stats.intermediateBufferBytes,0);
    assert.equal(artifact.stats.kernelHeapAllocationSites,0);
    assert.equal(artifact.stats.arrayViews.restoredDomains,2);
    for(const xs of [[],[2],[1,2,3,4],[-3,0,5,8]])for(let start=0;start<=xs.length;start++)for(let length=0;length<=xs.length-start;length++){
      const expected=xs.map((x,i)=>i>=start&&i<start+length?x*10:x);
      assert.deepEqual([...runtime.call('main',[xs,start,length,10])],expected);
    }
  }
});

test('nested range cover restores ordinary zip alignment while a bare focus remains distinct',async()=>{
  const aligned=`export fn main = (xs:[Num]) -> (start:Num) -> (length:Num) ->
    zip xs (map_range xs start length (x -> x+10)) (before -> after -> after-before);`;
  const artifact=compileSources(files(aligned));
  assert.equal(artifact.stats.arrayViews.restoredDomains,2);
  assert.equal(artifact.stats.functions[0].runtimeZipChecks,0);
  assert.deepEqual([...(await createRuntime(artifact)).call('main',[[1,2,3,4],1,2])],[0,10,10,0]);
  reject(`export fn main = (xs:[Num]) -> do {
    let {focus}=split_range xs 0 (count xs);
    zip xs focus (x -> y -> x+y)
  };`,'E_DOMAIN');
});

test('split_range is polymorphic and keeps the three ordered pieces explicit',async()=>{
  const bools=`export fn main = (xs:[Bool]) -> (start:Num) -> (length:Num) -> split_range xs start length;`;
  assert.deepEqual(plain((await createRuntime(compileSources(files(bools)))).call('main',[[true,false,true,false],1,2])),{
    before:[true],focus:[false,true],after:[false],
  });
  const records=`export fn main = () ->
    map_range (map (range 3) (x -> {value:x,flag:x>0})) 1 1
      (row -> {value:row.value+5,flag:!row.flag})
    |> fold 0 (total -> row -> total+row.value+(if row.flag then 100 else 0));`;
  assert.equal((await createRuntime(compileSources(files(records)))).call('main',[{}]),108);
});

test('split bounds stay exact and unused/empty focused work keeps existing demand semantics',async()=>{
  const runtime=await createRuntime(compileSources(files(numeric)));
  for(const [start,length] of [[-1,1],[0.5,1],[4,0],[0,-1],[0,0.5],[2,2],[NaN,0],[0,Infinity]])
    assert.throws(()=>runtime.call('main',[[1,2,3],start,length,2]),WebAssembly.RuntimeError);
  assert.doesNotThrow(()=>runtime.call('main',[[1,2,3],3,0,2]));

  const ignored=`export fn main = (xs:[Num]) -> do {let unused=split_range xs (-1) 1;7};`;
  assert.equal((await createRuntime(compileSources(files(ignored),{maxLoopIterations:0}))).call('main',[[1]]),7);

  const guarded=`export fn main = (xs:[Num]) -> (start:Num) -> (length:Num) ->
    map_range xs start length (x -> require (x>=0) (x*2));`;
  const guardRuntime=await createRuntime(compileSources(files(guarded)));
  assert.deepEqual([...guardRuntime.call('main',[[1,-99,3],2,1])],[1,-99,6]);
  assert.deepEqual([...guardRuntime.call('main',[[1,-99,3],1,0])],[1,-99,3]);
  assert.throws(()=>guardRuntime.call('main',[[1,-99,3],1,1]),WebAssembly.RuntimeError);
});

test('source helper matches its explicit two-cut/two-join expansion in every lowering mode',()=>{
  const via=`export fn main = (xs:[Num]) -> (start:Num) -> (length:Num) ->
    map_range xs start length (x -> x*x+1);`;
  const explicit=`export fn main = (xs:[Num]) -> (start:Num) -> (length:Num) -> do {
    let {left: before, right: tail}=split_at xs start;
    let {left: focus, right: after}=split_at tail length;
    concat before (concat (map focus (x -> x*x+1)) after)
  };`;
  for(const mode of modes){
    const a=compileSources(files(via),mode),b=compileSources([{name:'app.ass',source:explicit}],mode);
    assert.deepEqual(a.bytes,b.bytes);
    assert.deepEqual(a.abi,b.abi);
    assert.deepEqual(a.certificate,b.certificate);
  }
});

test('a focused scalar lookup in a billion-element virtual range needs no loop or linear memory',async()=>{
  const source=`export fn main = (n:Num) -> (start:Num) -> (length:Num) -> (index:Num) ->
    at (map_range (range n) start length (x -> x+1000)) index;`;
  const artifact=compileSources(files(source),{maxLoopIterations:0});
  assert.equal(artifact.stats.functions[0].loops,0);
  assert.equal(artifact.stats.intermediateBufferBytes,0);
  assert.equal(artifact.stats.needsMemory,false);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(artifact.bytes)),[]);
  const f=(await instantiate(artifact)).exports.main;
  assert.equal(f(1_000_000_000,600_000_000,3,599_999_999),599_999_999);
  assert.equal(f(1_000_000_000,600_000_000,3,600_000_000),600_001_000);
  assert.equal(f(1_000_000_000,600_000_000,3,600_000_002),600_001_002);
  assert.equal(f(1_000_000_000,600_000_000,3,600_000_003),600_000_003);
});

test('invalid callers are rejected in the client source, including unused definitions',()=>{
  reject(`fn bad = (xs:[Num]) -> map_range xs 0 1 (x -> true); export fn main = () -> 0;`,'E_TYPE');
  reject(`fn bad = (xs:[Num]) -> split_range xs true 1; export fn main = () -> 0;`,'E_TYPE');
  reject(`export fn main = () -> map_range 1 0 0 (x -> x);`,'E_TYPE');
});
