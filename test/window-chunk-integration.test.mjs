import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compileSources,checkSources,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime} from '../src/abi.mjs';
import {reference} from './reference.mjs';
const library={name:'windows.ass',source:await readFile(new URL('../lib/windows.ass',import.meta.url),'utf8')};
const files=source=>[library,{name:'client.ass',source}];
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const windows=(xs,w,s)=>{const out=[];for(let i=0;i+w<=xs.length;i+=s)out.push(xs.slice(i,i+w));return out;};
const sum=xs=>xs.reduce((s,x)=>s+x,0);

// Integration regressions: PR #35 and window maps must coexist after merging.
test('window and chunk public entry points survive additive registration merges',async()=>{
  const {corpus}=await import('../examples/corpus.mjs');
  const byId=new Map(corpus.map(entry=>[entry.id,entry]));
  assert.equal(byId.size,corpus.length,'Example identifiers remain unique');
  const ids=['chunk-report','chunk-energy','chunk-center','window-smooth','window-correlate','window-report'];
  for(const id of ids)assert(byId.has(id),`Missing public example: ${id}`);
  for(const id of ids.filter(id=>id.startsWith('window-')))
    assert(byId.get(id).libraries.includes('../lib/windows.ass'),'Window library is explicitly linked');
  const {scripts}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  for(const [key,command] of Object.entries({
    'test:chunk-composition':'node --test test/chunk-composition.test.mjs',
    'example:chunk-composition':'node examples/interop/chunk-composition.mjs',
    'test:window-maps':'node --test test/window-maps.test.mjs',
    'example:window-maps':'node examples/interop/window-maps.mjs',
    'test:window-chunk-integration':'node --test test/window-chunk-integration.test.mjs',
  }))assert.equal(scripts[key],command);
  const index=await readFile(new URL('../docs/README.md',import.meta.url),'utf8');
  for(const guide of ['CHUNK-SCAN-INTEGRATION.md','WINDOW-MAPS.md','WINDOW-CHUNK-INTEGRATION.md'])
    assert(index.includes(`](${guide})`),`Missing guide: ${guide}`);
  for(const id of ['chunk-block-report',...ids]){
    const entry=byId.get(id);assert(entry,`Missing original chunk example: ${id}`);
    const run=spawnSync(process.execPath,['examples/case-studies/app.mjs',id],{
      cwd:new URL('../',import.meta.url),input:JSON.stringify(entry.args),encoding:'utf8',timeout:15000});
    assert.equal(run.status,0,`${id}: ${run.stderr}`);
    assert.deepEqual(JSON.parse(run.stdout),entry.expected);
  }
});

test('overlapping window callbacks flatten independent block scans in the merged compiler',async()=>{
  const source=`export fn main = (xs:[Num]) -> window_map xs 4 1 (w ->
    w |> chunks 2 |> map (b -> scan b 0 (s -> x -> s+x)) |> flatten |> sum);`;
  const xs=[1,2,3,4,5,6];
  const expected=windows(xs,4,1).map(w=>{
    let total=0;
    for(let i=0;i<w.length;i+=2){let state=0;for(const x of w.slice(i,i+2)){state+=x;total+=state;}}
    return total;
  });
  assert.deepEqual(expected,[14,20,26]);
  for(const mode of modes){
    const compiled=compileSources(files(source),{...mode,maxLoopIterations:15});
    assert.equal(compiled.stats.intermediateBufferBytes,0);
    assert.equal(compiled.stats.functions[0].loops,2);
    assert(verifyCertificate(compiled.certificate.steps));
    const runtime=await createRuntime(compiled);
    assert.deepEqual([...runtime.call('main',[xs],{outputBytes:24})],expected);
    assert.deepEqual(reference(library.source+'\n'+source,'main',[xs]),expected);
    const small=await createRuntime(compileSources(files(source),{...mode,maxLoopIterations:14}));
    assert.throws(()=>small.call('main',[xs]),WebAssembly.RuntimeError);
    assert.deepEqual([...small.call('main',[[1,2,3,4]])],[14]);
    assert.deepEqual([...runtime.call('main',[[]],{outputBytes:0})],[]);
    assert.throws(()=>runtime.call('main',[xs],{outputBytes:23}),WebAssembly.RuntimeError);
    assert.deepEqual([...runtime.call('main',[xs])],expected);
  }
});

test('window reductions in flattened scan seeds keep private cursors and once-per-block work',async()=>{
  const source=`export fn main = (xs:[Num]) -> xs |> chunks 3
    |> map (b -> scan b (sum (window_map b 2 1 sum)) (s -> x -> s+x)) |> flatten;`;
  const xs=[1,2,3,4,5,6,7],expected=[];
  for(let i=0;i<xs.length;i+=3){
    const block=xs.slice(i,i+3);let state=sum(windows(block,2,1).map(sum));
    for(const x of block){state+=x;expected.push(state);}
  }
  assert.deepEqual(expected,[9,11,14,24,29,35,7]);
  for(const mode of modes){
    // Seven output events + four two-element windows and their dispatches.
    const compiled=compileSources(files(source),{...mode,maxLoopIterations:19});
    assert.equal(compiled.stats.intermediateBufferBytes,0);
    assert.equal(compiled.stats.functions[0].loops,3);
    const runtime=await createRuntime(compiled);
    assert.deepEqual([...runtime.call('main',[xs],{outputBytes:56})],expected);
    assert.deepEqual(reference(library.source+'\n'+source,'main',[xs]),expected);
    const small=await createRuntime(compileSources(files(source),{...mode,maxLoopIterations:18}));
    assert.throws(()=>small.call('main',[xs]),WebAssembly.RuntimeError);
    assert.deepEqual([...small.call('main',[[7]])],[7]);
    assert.deepEqual([...runtime.call('main',[[]],{outputBytes:0})],[]);
  }
});

test('window composition preserves lazy block seeds, strict guard preflight and sequential access',async()=>{
  const seed=`export fn main = (xs:[Num]) -> xs |> chunks 3 |> map (b ->
    scan b (require (at b 0 < 4) (sum (window_map b 2 1 sum))) (s -> x -> s+x))
    |> flatten |> fold_until 0 (s -> x -> {state:x,done:x>=9});`;
  const preflight=`export fn main = (xs:[Num]) -> xs |> chunks 3 |> map (b ->
    require (at b 0 < 4) (scan b (sum (window_map b 2 1 sum)) (s -> x -> s+x)))
    |> flatten |> fold_until 0 (s -> x -> {state:x,done:x>=9});`;
  for(const mode of modes){
    const runtime=await createRuntime(compileSources(files(seed),{...mode,maxLoopIterations:7}));
    assert.deepEqual(runtime.call('main',[[1,2,3,4,5,6]]),{state:9,steps:1,done:true});
    assert.deepEqual(runtime.call('main',[[]]),{state:0,steps:0,done:false});
    assert.throws(()=>runtime.call('main',[[4,5,6]]),WebAssembly.RuntimeError);
    const strict=await createRuntime(compileSources(files(preflight),mode));
    assert.throws(()=>strict.call('main',[[1,2,3,4,5,6]]),WebAssembly.RuntimeError);
    assert.deepEqual(strict.call('main',[[1,2,3]]),{state:9,steps:1,done:true});
    const forbidden=`export fn main = (xs:[Num]) -> do {
      let history=xs |> chunks 3 |> map (b -> scan b 0 (s -> x -> s+x)) |> flatten;
      window_map history 2 1 sum
    };`;
    const checked=checkSources(files(forbidden),mode);
    assert.equal(checked.ok,false);assert.equal(checked.diagnostics[0].code,'E_VIEW_ACCESS');
  }
});
