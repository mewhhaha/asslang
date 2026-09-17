import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compileSources,checkSources,instantiate,verifyCertificate} from '../src/compiler.mjs';
import {createRuntime} from '../src/abi.mjs';

const library={name:'windows.ass',source:await readFile(new URL('../lib/windows.ass',import.meta.url),'utf8')};
const files=source=>[library,{name:'client.ass',source}];
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const plain=value=>ArrayBuffer.isView(value)||Array.isArray(value)?Array.from(value,plain):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,plain(item)])):value;
const slices=(xs,width,stride)=>{const out=[];for(let start=0,index=0;start+width<=xs.length;start+=stride,index++)
  out.push({index,start,window:xs.slice(start,start+width)});return out;};
const reject=(source,code,sourceName=null)=>{const checked=checkSources(files(source));assert.equal(checked.ok,false,source);
  assert.equal(checked.diagnostics[0].code,code);if(sourceName)assert.equal(checked.diagnostics[0].sourceName,sourceName);};

const legacyLibrarySource=`// Complete, read-only overlapping windows. No nested arrays are materialized.
// Width/stride are positive integers; callbacks retain their own work/demand.
fn window_map = xs -> width -> stride -> f -> do {
  let n = count xs;
  let valid = width > 0 && width <= 2147483647 && width == floor width
    && stride > 0 && stride <= 2147483647 && stride == floor stride;
  let size = if n < width then 0 else 1 + floor ((n-width)/stride);
  require valid (
    range size
    |> map (i -> do {
      let {right: tail} = split_at xs (i*stride);
      let {left: window} = split_at tail width;
      f window
    })
  )
};
`;

test('indexed window metadata matches an independent slice oracle in every lowering mode',async()=>{
  const source=`export fn main = (xs:[Num]) -> (width:Num) -> (stride:Num) ->
    window_map_indexed xs width stride ({index,start,window} -> index*1000+start*100+sum window);`;
  for(const mode of modes){
    const artifact=compileSources(files(source),mode);
    assert.equal(artifact.abi.version,1);assert.equal(artifact.stats.intermediateBufferBytes,0);
    assert.equal(artifact.stats.kernelHeapAllocationSites,0);assert.equal(artifact.stats.functions[0].runtimeZipChecks,0);
    assert(verifyCertificate(artifact.certificate.steps));
    const runtime=await createRuntime(artifact);
    for(const xs of [[],[2],[1,2,3,4,5],[-3,0,5,8,13]])for(const width of [1,2,3,7])for(const stride of [1,2,4]){
      const expected=slices(xs,width,stride).map(({index,start,window})=>index*1000+start*100+window.reduce((a,b)=>a+b,0));
      assert.deepEqual([...runtime.call('main',[xs,width,stride])],expected);
    }
  }
});

test('deriving window_map through indexed metadata preserves existing window artifacts',()=>{
  const examples=['smooth','correlate','neighborhood_report'];
  for(const name of examples){
    const source=requireSource(name);
    for(const mode of modes){
      const before=compileSources([{name:'windows.ass',source:legacyLibrarySource},{name:name+'.ass',source}],mode);
      const after=compileSources([library,{name:name+'.ass',source}],mode);
      assert.deepEqual(after.bytes,before.bytes,`${name} ${JSON.stringify(mode)}`);
      assert.deepEqual(after.abi,before.abi);assert.deepEqual(after.certificate,before.certificate);
      assert.equal(after.stats.functions.length,before.stats.functions.length);
      for(let i=0;i<after.stats.functions.length;i++)assert.deepEqual(after.stats.functions[i],before.stats.functions[i]);
      assert.equal(after.stats.intermediateBufferBytes,before.stats.intermediateBufferBytes);
    }
  }
});

function requireSource(name){
  return sourceCache.get(name);
}
const sourceCache=new Map(await Promise.all(['smooth','correlate','neighborhood_report'].map(async name=>[
  name,await readFile(new URL(`../examples/case-studies/windows/${name}.ass`,import.meta.url),'utf8')
])));

test('window metadata replaces a checked position zip without inventing alignment evidence',async()=>{
  const direct=`export fn main = (xs:[Num]) -> (width:Num) -> (stride:Num) ->
    window_map_indexed xs width stride ({start,window} -> start+sum window);`;
  const paired=`export fn main = (xs:[Num]) -> (width:Num) -> (stride:Num) -> do {
    let totals=window_map xs width stride sum;
    zip_checked (range (count totals)) totals (index -> total -> index*stride+total)
  };`;
  for(const mode of modes){
    const a=compileSources(files(direct),mode),b=compileSources(files(paired),mode);
    assert.equal(a.stats.functions[0].runtimeZipChecks,0);assert.equal(b.stats.functions[0].runtimeZipChecks,1);
    assert.equal(a.stats.intermediateBufferBytes,0);assert.equal(b.stats.intermediateBufferBytes,0);
    const ar=await createRuntime(a),br=await createRuntime(b);
    for(const args of [[[1,2,3,4,5],3,1],[[1,2,3,4,5,6],2,3],[[],2,1]])
      assert.deepEqual([...ar.call('main',args)],[...br.call('main',args)]);
  }
  const shared=`export fn main = (xs:[Num]) -> do {
    let ys=window_map_indexed xs 2 1 ({start,window} -> start+sum window);
    zip ys (map ys (x -> x*2)) (a -> b -> a+b)
  };`;
  assert.deepEqual([...(await createRuntime(compileSources(files(shared)))).call('main',[[1,2,3,4]])],[9,18,27]);
  reject(`export fn main = (xs:[Num]) ->
    zip (window_map_indexed xs 2 1 ({start}->start))
      (window_map_indexed xs 2 1 ({start}->start)) (a -> b -> a+b);`,'E_DOMAIN');
});

test('selected late windows expose exact bounded coordinates without visiting a prefix',async()=>{
  const source=`export fn main = (n:Num) -> (width:Num) -> (stride:Num) -> (which:Num) ->
    at (window_map_indexed (range n) width stride
      ({index,start,window} -> index+start+at window (count window-1))) which;`;
  const artifact=compileSources(files(source),{maxLoopIterations:0});
  assert.equal(artifact.stats.functions[0].loops,0);assert.equal(artifact.stats.intermediateBufferBytes,0);
  assert.equal(artifact.stats.needsMemory,false);assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(artifact.bytes)),[]);
  const fn=(await instantiate(artifact)).exports.main;
  for(const [n,width,stride] of [[1_000_000_000,1009,65537],[2147483647,3,7],[2147483647,1,2147483647]]){
    const last=Number((BigInt(n)-BigInt(width))/BigInt(stride));
    const start=BigInt(last)*BigInt(stride),expected=BigInt(last)+start+(start+BigInt(width)-1n);
    assert.equal(fn(n,width,stride,last),Number(expected));
    assert.throws(()=>fn(n,width,stride,last+1),WebAssembly.RuntimeError);
  }
});

test('metadata keeps existing structural validation, demand, access, and ABI boundaries',async()=>{
  const source=`export fn main = (xs:[Num]) -> (width:Num) -> (stride:Num) ->
    window_map_indexed xs width stride ({index,start,window} -> index+start+sum window);`;
  const runtime=await createRuntime(compileSources(files(source)));
  for(const bad of [0,-1,0.5,NaN,Infinity,2147483648])for(const xs of [[],[1,2]]){
    assert.throws(()=>runtime.call('main',[xs,bad,1]),WebAssembly.RuntimeError);
    assert.throws(()=>runtime.call('main',[xs,1,bad]),WebAssembly.RuntimeError);
  }
  const unused=`export fn main = (xs:[Num]) -> do {let ignored=window_map_indexed xs 0 0 ({window}->sum window);7};`;
  assert.equal((await createRuntime(compileSources(files(unused)))).call('main',[[1,2]]),7);
  const count=`export fn main = (xs:[Num]) -> count (window_map_indexed xs 2 1 ({window}->require false (sum window)));`;
  assert.equal((await createRuntime(compileSources(files(count)))).call('main',[[1,2,3]]),2);
  reject(`export fn main = (xs:[Num]) -> window_map_indexed (filter xs (x -> x>0)) 2 1 ({index}->index);`,'E_VIEW_DENSE');
  reject(`export fn main = (xs:[Num]) -> window_map_indexed (scan xs 0 (s -> x -> s+x)) 2 1 ({start}->start);`,'E_VIEW_ACCESS');
  reject(`export fn main = (xs:[Num]) -> window_map_indexed xs 2 1 ({window}->window);`,'E_ABI','client.ass');
  const diagnostic=checkSources(files(`export fn main = (xs:[Num]) -> window_map_indexed xs 2 1 (meta -> meta.missing);`)).diagnostics[0];
  assert.equal(diagnostic.sourceName,'client.ass');assert(diagnostic.range.start.offset>=0);
});

test('registered origin report executes with explicit resource accounting',async()=>{
  const source=await readFile(new URL('../examples/case-studies/windows/origin_report.ass',import.meta.url),'utf8');
  const artifact=compileSources([library,{name:'origin_report.ass',source}],{maxLoopIterations:12});
  assert.equal(artifact.abi.version,1);assert.equal(artifact.stats.intermediateBufferBytes,0);
  assert.equal(artifact.stats.functions[0].runtimeZipChecks,0);assert.equal(artifact.stats.functions[0].loops,4);
  const runtime=await createRuntime(artifact);
  assert.deepEqual(plain(runtime.call('origin_report',[[1,2,3,4,5,6],3,2],{outputBytes:48})),
    {indexes:[0,1],starts:[0,2],totals:[6,12]});
  assert.throws(()=>runtime.call('origin_report',[[1,2,3,4,5,6],3,2],{outputBytes:47}),WebAssembly.RuntimeError);
  const short=await createRuntime(compileSources([library,{name:'origin_report.ass',source}],{maxLoopIterations:11}));
  assert.throws(()=>short.call('origin_report',[[1,2,3,4,5,6],3,2]),WebAssembly.RuntimeError);
  const run=spawnSync(process.execPath,['examples/interop/window-origins.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr);const report=JSON.parse(run.stdout);
  assert.deepEqual(report.result,{indexes:[0,1],starts:[0,2],totals:[6,12]});assert.equal(report.runtimeZipChecks,0);
});
