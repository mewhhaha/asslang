import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileSources,checkSources} from '../src/compiler.mjs';
import {createRuntime} from '../src/abi.mjs';

const library={name:'alternatives.ass',source:await readFile(new URL('../lib/alternatives.ass',import.meta.url),'utf8')};
const files=source=>[library,{name:'app.ass',source}];
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const plain=x=>ArrayBuffer.isView(x)?[...x]:x;

const source=`
fn classify = x -> if x >= 0 then either_right x else either_left {magnitude:-x};
export fn classify_value = (x:Num) ->
  either_match (error -> 0-error.magnitude) (value -> value*value+1) (classify x);
export fn maybe_value = (x:Num) -> (present:Bool) ->
  maybe_default (-1) (maybe_map (value -> value*value)
    (if present then maybe_some x else maybe_none ()));
export fn mapped = (right:Bool) -> (x:Num) ->
  either_match (error -> error.code) (value -> value)
    (either_bimap (error -> {code:error.code+10}) (value -> 2*value)
      (if right then either_right x else either_left {code:x}));
`;

test('encoded alternatives execute distinct payloads and Maybe across all lowering modes',async()=>{
  for(const options of modes){
    const artifact=compileSources(files(source),options),runtime=await createRuntime(artifact);
    for(const x of [-9,-1,-0,0,1,3,17]){
      assert.equal(runtime.call('classify_value',[x]),x>=0?x*x+1:x);
      assert.equal(runtime.call('maybe_value',[x,true]),x*x);
      assert.equal(runtime.call('maybe_value',[x,false]),-1);
      assert.equal(runtime.call('mapped',[true,x]),2*x);
      assert.equal(runtime.call('mapped',[false,x]),x+10);
    }
    assert.equal(artifact.abi.version,1);
    assert.equal(artifact.stats.intermediateBufferBytes,0);
    assert.equal(artifact.stats.functions.every(f=>f.loops===0),true);
  }
});

test('seeded runtime family agrees with an independent branch oracle',async()=>{
  for(const options of modes){
    const runtime=await createRuntime(compileSources(files(source),options));
    let seed=0x51f15e;
    for(let i=0;i<64;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const x=(seed%2001-1000)/8,right=(seed&0x10000)!==0;
      assert.equal(runtime.call('classify_value',[x]),x>=0?x*x+1:x);
      assert.equal(runtime.call('mapped',[right,x]),right?2*x:x+10);
    }
  }
});

test('constructor and mapping laws hold for unrelated branch payloads',async()=>{
  const laws=`export fn main = (x:Num) -> do {
    let left=either_match (a -> a+1) (b -> b.value) (either_left x);
    let right=either_match (a -> a+1) (b -> b.value) (either_right {value:x});
    let ml=either_match (a -> a) (b -> b)
      (either_map_left (a -> a*3) (either_left x));
    let mr=either_match (a -> a) (b -> b)
      (either_map_right (b -> b*5) (either_right x));
    {left,right,ml,mr}
  };`;
  for(const options of modes){
    const runtime=await createRuntime(compileSources(files(laws),options));
    assert.deepEqual(runtime.call('main',[4]),{left:5,right:4,ml:12,mr:20});
  }
});

test('unselected handlers are not demanded while selected guards still trap',async()=>{
  const demand=`export fn main = (right:Bool) -> (trapLeft:Bool) -> do {
    let alternative=if right then either_right 5 else either_left 7;
    either_match
      (x -> require (!trapLeft) (x+1))
      (x -> require trapLeft (x+2))
      alternative
  };`;
  for(const options of modes){
    const runtime=await createRuntime(compileSources(files(demand),options));
    assert.equal(runtime.call('main',[true,true]),7);
    assert.equal(runtime.call('main',[false,false]),8);
    assert.throws(()=>runtime.call('main',[true,false]),WebAssembly.RuntimeError);
    assert.throws(()=>runtime.call('main',[false,true]),WebAssembly.RuntimeError);
    assert.equal(runtime.call('main',[true,true]),7,'runtime recovers after trap');
  }
});

test('both handlers remain statically checked, including unused definitions and source locations',()=>{
  const cases=[
    'fn bad = b -> either_match (x -> x+1) (x -> x==0) (if b then either_left 1 else either_right 2);export fn main = () -> 0;',
    'fn bad = b -> either_map_right (x -> x+1) (if b then either_left 1 else either_right true);export fn main = () -> 0;',
    'fn bad = b -> maybe_map (x -> x+1) (if b then maybe_some true else maybe_none ());export fn main = () -> 0;',
  ];
  for(const source of cases){
    const checked=checkSources(files(source));
    assert.equal(checked.ok,false,source);
    assert.equal(checked.diagnostics[0].phase,'infer');
    assert.equal(checked.diagnostics[0].sourceName,'app.ass');
    assert.ok(checked.diagnostics[0].range.start.offset>=0);
  }
  const staticBranch=checkSources(files('fn known = () -> either_match (x -> x+1) (x -> x==0) (either_left 1);export fn main = () -> 0;'));
  assert.equal(staticBranch.ok,true,'rank-1 inference does not tie an erased static branch result');
});

test('encoded alternatives cannot escape the concrete ABI',()=>{
  for(const source of [
    'export fn main = (x:Num) -> either_left x;',
    'export fn main = (x:Num) -> maybe_some x;',
  ]){
    const checked=checkSources(files(source));
    assert.equal(checked.ok,false);
    assert.equal(checked.diagnostics[0].code,'E_ABI');
  }
  const functionStream=checkSources(files('export fn main = (n:Num) -> map (range n) (x -> either_right x);'));
  assert.equal(functionStream.ok,false);
  assert.equal(functionStream.diagnostics[0].code,'E_ABI');
});

test('library calls compile identically to explicit eliminator expansions',()=>{
  const via=`export fn main = (right:Bool) -> (x:Num) ->
    either_match (error -> 0-error.magnitude) (value -> value*value)
      (if right then either_right x else either_left {magnitude:x});`;
  const expanded=`export fn main = (right:Bool) -> (x:Num) ->
    (if right
      then (onLeft -> onRight -> onRight x)
      else (onLeft -> onRight -> onLeft {magnitude:x}))
    (error -> 0-error.magnitude) (value -> value*value);`;
  const renamed={name:'renamed.ass',source:library.source
    .replaceAll('either_left','choice_left').replaceAll('either_right','choice_right')
    .replaceAll('either_match','choice_match').replaceAll('either_map_left','choice_map_left')
    .replaceAll('either_map_right','choice_map_right').replaceAll('either_bimap','choice_bimap')
    .replaceAll('maybe_some','choice_some').replaceAll('maybe_none','choice_none')
    .replaceAll('maybe_match','choice_maybe_match').replaceAll('maybe_map','choice_maybe_map')
    .replaceAll('maybe_default','choice_default')};
  for(const options of modes){
    const a=compileSources(files(via),options),b=compileSources([{name:'app.ass',source:expanded}],options);
    assert.deepEqual(a.bytes,b.bytes);
    assert.deepEqual(a.abi,b.abi);
    assert.deepEqual(a.jte,b.jte);
    const c=compileSources([renamed,{name:'app.ass',source:via.replaceAll('either_match','choice_match').replaceAll('either_right','choice_right').replaceAll('either_left','choice_left')}],options);
    assert.deepEqual(a.bytes,c.bytes);
  }
});

test('selected array handlers still use ordinary Wasm loops and owned output',async()=>{
  const arrays=`export fn main = (present:Bool) -> (n:Num) ->
    maybe_match (unit -> range 0) (count -> map (range count) (x -> x*x))
      (if present then maybe_some n else maybe_none ());`;
  for(const options of modes){
    const artifact=compileSources(files(arrays),{...options,maxLoopIterations:4});
    const runtime=await createRuntime(artifact);
    assert.deepEqual(plain(runtime.call('main',[true,4],{outputBytes:32})),[0,1,4,9]);
    assert.deepEqual(plain(runtime.call('main',[false,100],{outputBytes:0})),[]);
    assert.throws(()=>runtime.call('main',[true,4],{outputBytes:31}),WebAssembly.RuntimeError);
    const small=await createRuntime(compileSources(files(arrays),{...options,maxLoopIterations:3}));
    assert.throws(()=>small.call('main',[true,4]),WebAssembly.RuntimeError);
  }
});
