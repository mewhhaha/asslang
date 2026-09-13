import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { compile, compileSources, check, checkSources, createCompiler, instantiate, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime, createCapability, Arena, prepareCall } from '../src/abi.mjs';
import { reference } from './reference.mjs';
import { parse, infer } from '../src/frontend.mjs';
import { stage } from '../src/jte.mjs';
import { runArrayViewBrowserChecks } from './array-views-browser.mjs';

const modes = [false,true].flatMap(simd => [false,true].flatMap(reductionFusion =>
  [false,true].map(memoizeReductions => ({simd,reductionFusion,memoizeReductions}))));
const plain = x => ArrayBuffer.isView(x) || Array.isArray(x) ? Array.from(x,plain) : x && typeof x === 'object'
  ? Object.fromEntries(Object.entries(x).map(([k,v]) => [k,plain(v)])) : x;
const files = new Map(await Promise.all(['section_report','rotate_scan','adjacent_deltas'].map(async name =>
  [name,await readFile(new URL(`../examples/case-studies/views/${name}.ass`,import.meta.url),'utf8')])));
const rejoin = 'export fn main = (xs:[Num]) -> (cut:Num) -> do {let {left,right}=split_at xs cut;concat left right};';
const rotate = rejoin.replace('concat left right','concat right left');
const reject = (source,code) => assert.throws(() => compile(source), e => e.code === code);
const stats = c => c.stats.functions[0];
const oracle = (xs,{cut,leftGain,rightGain}) => {
  let state={value:0,total:0,correction:0};const values=[],totals=[];
  for(let i=0;i<xs.length;i++) {
    const value=xs[i]*(i<cut?leftGain:rightGain);
    state={value,total:state.total+value,correction:state.correction+(value-xs[i])};
    values.push(value);totals.push(state.total);
  }
  return {values,totals,state};
};

for (const mode of modes) test(`one causal report from a cut cover ${JSON.stringify(mode)}`,async()=>{
  const source=files.get('section_report'), c=compile(source,mode), r=await createRuntime(c);
  assert.equal(c.abi.version,1);assert.equal(c.stats.intermediateBufferBytes,0);
  assert.equal(c.stats.kernelHeapAllocationSites,0);assert.equal(c.stats.scratchReservationSites,undefined);
  assert.equal(c.certificate.version,'jte-3-views');assert(verifyCertificate(c.certificate.steps));
  assert.equal(c.stats.arrayViews.restoredDomains,1);assert.equal(stats(c).runtimeZipChecks,0);
  assert.equal(stats(c).loops,mode.reductionFusion?1:3);assert.equal(stats(c).stateMachines,mode.reductionFusion?1:3);
  for(const xs of [[],[1],[1,2,3,4],[-3,2,-1,4,0]])for(let cut=0;cut<=xs.length;cut++) {
    const settings={cut,leftGain:10,rightGain:100};
    assert.deepEqual(plain(r.call('section_report',[xs,settings])),oracle(xs,settings));
    assert.deepEqual(plain(r.call('section_report',[xs,settings])),reference(source,'section_report',[xs,settings]));
  }
  const units=mode.reductionFusion?4:12,args=[[1,2,3,4],{cut:2,leftGain:10,rightGain:100}];
  const exact=await createRuntime(compile(source,{...mode,maxLoopIterations:units}));
  assert.deepEqual(plain(exact.call('section_report',args,{outputBytes:64})),oracle(...args));
  const short=await createRuntime(compile(source,{...mode,maxLoopIterations:units-1}));
  assert.throws(()=>short.call('section_report',args),WebAssembly.RuntimeError);
  assert.equal(short.call('section_report',[[1],{cut:0,leftGain:10,rightGain:100}]).state.total,100);
});

test('all small split/rotate words and cuts agree with a direct positional oracle',async t=>{
  const identity=await createRuntime(compile(rejoin)),rotation=await createRuntime(compile(rotate));
  let cases=0;
  for(let n=0;n<=5;n++)for(let word=0;word<3**n;word++) {
    let rest=word;const xs=Array.from({length:n},()=>{const v=rest%3-1;rest=Math.floor(rest/3);return v;});
    for(let cut=0;cut<=n;cut++) {
      assert.deepEqual([...identity.call('main',[xs,cut])],xs);
      assert.deepEqual([...rotation.call('main',[xs,cut])],xs.slice(cut).concat(xs.slice(0,cut)));cases++;
    }
  }
  t.diagnostic(JSON.stringify({words:364,cutCases:cases}));
});

test('split shapes, scalar types, and function composition use the ordinary HM rules',async()=>{
  const source=`fn split = xs -> k -> split_at xs k;
    fn append = xs -> ys -> concat xs ys;
    export fn main = (xs:[Bool]) -> (k:Num) -> do {
      let {left,right}=split xs k;
      append right left
    };`;
  assert.deepEqual((await createRuntime(compile(source))).call('main',[[true,false,false],1]),[false,false,true]);
  assert.equal(infer(parse('fn append = xs -> ys -> concat xs ys;export fn main = () -> 1;')).signatures.append,"['a] -> ['a] -> ['a]");
  for(const [source,code] of [
    ['export fn main = () -> split_at 1 0;','E_TYPE'],
    ['export fn main = () -> split_at (range 3) true;','E_TYPE'],
    ['export fn main = () -> concat (range 3) (map (range 2) (x -> true));','E_TYPE'],
    ['export fn main = (xs:[Num]) -> (split_at xs 1).missing;','E_TYPE'],
    ['export fn main = (xs:[Num]) -> split_at xs;','E_ABI'],
    ['fn concat = x -> x;export fn main = () -> 1;','E_NAME'],
  ])reject(source,code);
  const polymorphic=`fn rotate = xs -> k -> do {let {left,right}=split_at xs k;concat right left};
    export fn main = () -> {numbers:rotate (range 3) 1,flags:rotate (map (range 3) (x -> x>0)) 1};`;
  assert.deepEqual(plain((await createRuntime(compile(polymorphic))).call('main',[{}])),{numbers:[1,2,0],flags:[true,true,false]});
});

test('cut validation is inclusive, exact, and retained by empty/count/identity consumers',async()=>{
  for(const mode of modes)for(const body of ['left','right','concat left right','count left','count right','count (concat left right)']) {
    const source=rejoin.replace('concat left right',body),r=await createRuntime(compile(source,mode));
    for(const cut of [-1,0.5,4,NaN,Infinity,-Infinity])assert.throws(()=>r.call('main',[[1,2,3],cut]),WebAssembly.RuntimeError);
    assert.doesNotThrow(()=>r.call('main',[[],-0]));assert.doesNotThrow(()=>r.call('main',[[1,2,3],3]));
    assert.throws(()=>r.call('main',[[],1]),WebAssembly.RuntimeError);
  }
  const ignored=await createRuntime(compile('export fn main = (xs:[Num]) -> do {let unused=split_at xs (-1);7};',{maxLoopIterations:0}));
  assert.equal(ignored.call('main',[[1]]),7);
});

test('virtual billion-element rotation and full-range boundary use no loop or memory import',async()=>{
  const source=`export fn main = (n:Num) -> (cut:Num) -> do {
    let {left,right}=split_at (range n) cut;
    let rotated=concat right left;
    {size:count rotated,first:if n>0 then at rotated 0 else (-1)}
  };`;
  // A scalar entry point avoids even an indirect result descriptor.
  const scalar=source.replace('{size:count rotated,first:if n>0 then at rotated 0 else (-1)}','if n>0 then at rotated 0 else (-1)');
  const c=compile(scalar,{maxLoopIterations:0}),f=(await instantiate(c)).exports.main;
  assert.equal(stats(c).loops,0);assert.equal(c.stats.needsMemory,false);assert.equal(c.stats.intermediateBufferBytes,0);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)),[]);
  assert.equal(f(1_000_000_000,600_000_000),600_000_000);
  assert.equal(f(2147483647,2147483646),2147483646);
  assert.equal(f(4,4),0);assert.equal(f(4,0),0);
  // The inactive branch does not demand its view, hence does not validate cut.
  assert.equal(f(0,-1),-1);
  const sizes='export fn main = (a:Num) -> (b:Num) -> count (concat (range a) (range b));';
  const g=(await instantiate(compile(sizes,{maxLoopIterations:0}))).exports.main;
  assert.equal(g(2147483646,1),2147483647);
  assert.throws(()=>g(2147483647,1),WebAssembly.RuntimeError);
  assert.throws(()=>g(2147483647,2147483647),WebAssembly.RuntimeError);
  assert.equal(g(0,0),0);
});

test('nested cuts reassemble enclosing covers and preserve alignment after type-changing maps',async()=>{
  const source=`export fn main = (xs:[Num]) -> (k:Num) -> do {
    let {left,right}=split_at xs k;
    let {left:a,right:b}=split_at left (floor (k/2));
    let repaired=concat (concat (map a (x -> x+1)) (map b (x -> x*2))) right;
    zip xs repaired (original -> value -> value-original)
  };`;
  const c=compile(source),r=await createRuntime(c);
  assert.equal(c.stats.arrayViews.restoredDomains,2);assert.equal(stats(c).runtimeZipChecks,0);
  for(let k=0;k<=5;k++)assert.deepEqual([...r.call('main',[[1,2,3,4,5],k])],
    [1,2,3,4,5].map((x,i)=>i<Math.floor(k/2)?1:i<k?x:0));
  const typed=rejoin.replace('concat left right','zip xs (concat (map left (x -> x>0)) (map right (x -> x<0))) (x -> flag -> if flag then x else 0)');
  assert.deepEqual([...(await createRuntime(compile(typed))).call('main',[[-1,2,-3,4],2])],[0,2,-3,0]);
  const zipped=rejoin.replace('concat left right','concat (zip left (map left (x -> x*2)) (x -> y -> x+y)) right');
  assert.equal(compile(zipped).stats.arrayViews.restoredDomains,1);
  assert.deepEqual([...(await createRuntime(compile(zipped))).call('main',[[1,2,3],2])],[3,6,3]);
});

test('same extent is not a cover: independent cuts, reversal, duplication and checked zips stay distinct',()=>{
  const sources=[
    'let a=split_at xs k;let b=split_at xs k;concat a.left b.right',
    'let {left,right}=split_at xs k;concat right left',
    'let {left,right}=split_at xs k;concat left left',
    'let {left,right}=split_at xs k;concat (zip_checked left left (x -> y -> x)) right',
    'let {left,right}=split_at xs k;concat (if true then left else left) right',
    'let {left,right}=split_at xs k;concat (sort_by left (x -> x)) right',
  ];
  for(const fragment of sources) {
    const [bindings,result]=[fragment.slice(0,fragment.lastIndexOf(';')+1),fragment.slice(fragment.lastIndexOf(';')+1)];
    const source=`export fn main = (xs:[Num]) -> (k:Num) -> do {${bindings}zip xs (${result}) (x -> y -> x+y)};`;
    reject(source,'E_DOMAIN');
  }
  reject('export fn main = (xs:[Num]) -> (ys:[Num]) -> zip xs (concat xs ys) (x -> y -> x+y);','E_DOMAIN');
});

test('certificate verification rejects forged cuts, incorrect parents, order and restored domains',()=>{
  const c=compile(rejoin),steps=c.certificate.steps;
  assert(verifyCertificate(JSON.parse(JSON.stringify(steps))));
  const variants=[
    s=>{delete s[1].obligation;},s=>{s[1].parents=[1];},s=>{s[2].parents=[1,1];},
    s=>{s[2].parents=[0,0];},s=>{s[3].parents.reverse();},s=>{s[3].parents=[1,1];},
    s=>{s[3].domain=3;},s=>{s[1].seekable=false;},s=>{s[0].dense=false;},
  ];
  for(const alter of variants){const s=structuredClone(steps);alter(s);assert.throws(()=>verifyCertificate(s));}
  const mapped=compile(rejoin.replace('concat left right','concat (map left (x -> x)) right')).certificate.steps;
  const wrong=structuredClone(mapped);wrong[2].parents=[0,3];assert.throws(()=>verifyCertificate(wrong));
  const other=compile(rotate).certificate.steps;other.at(-1).rule='rejoin';assert.throws(()=>verifyCertificate(other));
});

test('indexed restriction rejects implicit causal replay and sparse allocation guesses',()=>{
  const sources=[
    ['split_at (scan xs 0 (s -> x -> s+x)) 0','E_VIEW_ACCESS'],
    ['concat xs (scan xs 0 (s -> x -> s+x))','E_VIEW_ACCESS'],
    ['split_at (filter xs (x -> x>0)) 0','E_VIEW_DENSE'],
    ['concat (filter xs (x -> x>0)) xs','E_VIEW_DENSE'],
    ['split_at (transduce xs 0 (s -> x -> {state:s+x,value:x,emit:true})) 0','E_VIEW_DENSE'],
  ];
  for(const [body,code] of sources)reject(`export fn main = (xs:[Num]) -> ${body};`,code);
});

test('source guards are structural but unselected element graphs remain lazy',async()=>{
  for(const mode of modes) {
    for(const bad of ['require false (range 0)','range (-1)']) {
      const c=compile(`export fn main = () -> at (concat (range 1) (${bad})) 0;`,mode);
      const r=await createRuntime(c);assert.throws(()=>r.call('main',[{}]),WebAssembly.RuntimeError);
    }
    const source=`export fn main = () -> at (concat (range 1) (map (range 2) (x -> require false x))) 0;`;
    assert.equal((await createRuntime(compile(source,mode))).call('main',[{}]),0);
    const count=source.replace('at (concat','count (concat').replace('))) 0;',')));');
    assert.equal((await createRuntime(compile(count,mode))).call('main',[{}]),3);
    const selected=source.replace('))) 0;','))) 1;');
    const r=await createRuntime(compile(selected,mode));assert.throws(()=>r.call('main',[{}]),WebAssembly.RuntimeError);
    const empty=await createRuntime(compile('export fn main = () -> concat (map (range 0) (x -> require false x)) (range 0);',mode));
    assert.deepEqual([...empty.call('main',[{}])],[]);
  }
});

test('stopping after a joined prefix does not evaluate invalid suffix elements',async()=>{
  const source=`export fn main = (xs:[Num]) -> do {
    let {left,right}=split_at xs 2;
    concat left (map right (x -> require (x>=0) x))
    |> scan 0 (s -> x -> s+x)
    |> fold_until 0 (s -> x -> {state:x,done:x>=5})
  };`;
  for(const mode of modes) {
    const r=await createRuntime(compile(source,{...mode,maxLoopIterations:2}));
    assert.deepEqual(r.call('main',[[2,3,-99]]),{state:5,steps:2,done:true});
    assert.throws(()=>r.call('main',[[1,1,-99]]),WebAssembly.RuntimeError);
    assert.deepEqual(r.call('main',[[5,0,-99]]),{state:5,steps:1,done:true});
  }
});

test('scanning a rotation preserves its sequential f64 order and empty-seed demand',async()=>{
  const source=files.get('rotate_scan');
  for(const mode of modes) {
    const r=await createRuntime(compile(source,mode));
    for(const xs of [[],[-0],[1e16,1,-1e16,1],[NaN,1],[Infinity,-Infinity]])for(let k=0;k<=xs.length;k++) {
      let total=0;const expected=xs.slice(k).concat(xs.slice(0,k)).map(x=>total=total+x);
      assert.deepEqual([...r.call('rotate_scan',[xs,k])],expected);
    }
    const lazy=await createRuntime(compile(source.replace('scan 0','scan (require false 0)'),mode));
    assert.deepEqual([...lazy.call('rotate_scan',[[],0])],[]);
    assert.throws(()=>lazy.call('rotate_scan',[[1],0]),WebAssembly.RuntimeError);
  }
});

test('direct concat trees flatten to a bounded balanced dispatch, including empty segments',async()=>{
  const declarations=Array.from({length:32},(_,i)=>`let part${i}=map (range ${i%3}) (x -> x+${i*10});`).join('\n');
  const sequence=Array.from({length:32},(_,i)=>`part${i}`);
  const left=sequence.reduce((a,b)=>a?`concat (${a}) ${b}`:b,'');
  const balanced=(lo,hi)=>hi-lo===1?sequence[lo]:`concat (${balanced(lo,Math.floor((lo+hi)/2))}) (${balanced(Math.floor((lo+hi)/2),hi)})`;
  const expected=Array.from({length:32},(_,i)=>Array.from({length:i%3},(_,j)=>j+i*10)).flat();
  for(const body of [left,balanced(0,32)]) {
    const c=compile(`export fn main = () -> do {${declarations}${body}};`),r=await createRuntime(c);
    assert.equal(c.stats.arrayViews.maxJoinSegments,32);assert.equal(stats(c).loops,1);
    assert.equal(c.stats.intermediateBufferBytes,0);assert.deepEqual([...r.call('main',[{}])],expected);
  }
  const hidden='export fn main = () -> concat (map (concat (range 2) (range 3)) (x -> x+10)) (range 1);';
  assert.deepEqual([...(await createRuntime(compile(hidden))).call('main',[{}])],[10,11,10,11,12,0]);
});

test('segment/depth expansion is bounded without relaxing existing compiler limits',()=>{
  const program=n=>{
    const bindings=['let p0=range 1;'];
    for(let i=1;i<n;i++)bindings.push(`let p${i}=concat p${i-1} (range 1);`);
    return `export fn main = () -> do {${bindings.join('')}count p${n-1}};`;
  };
  assert.equal(compile(program(64)).stats.arrayViews.maxJoinSegments,64);
  reject(program(65),'E_LIMIT');
  const chain=n=>`export fn main = (xs:[Num]) -> do {let p0=xs;${Array.from({length:n},(_,i)=>`let p${i+1}=(split_at p${i} 0).right;`).join('')}count p${n}};`;
  assert(WebAssembly.validate(compile(chain(64)).bytes));reject(chain(65),'E_LIMIT');
  assert.throws(()=>compile(rejoin,{maxExpansion:5}),e=>e.code==='E_LIMIT');
});

test('inner runtime cuts and joins do not reuse another iteration’s captures',async()=>{
  const source=`export fn main = (xs:[Num]) ->
    fold (range (count xs+1)) 0 (total -> k -> do {
      let {left,right}=split_at xs k;
      total+sum (concat (map left (x -> x+k)) right)
    });`;
  for(const mode of modes) {
    const r=await createRuntime(compile(source,mode));
    for(const xs of [[],[1],[1,2,3,4]]) {
      let expected=0;for(let k=0;k<=xs.length;k++)expected+=xs.reduce((s,x,i)=>s+x+(i<k?k:0),0);
      assert.equal(r.call('main',[xs]),expected);assert.equal(reference(source,'main',[xs]),expected);
    }
  }
});

test('record views preserve static symbols and let-bound staged helper protocols internally',async()=>{
  const source=`symbol secret;
    fn route = xs -> k -> do {let {left,right}=split_at xs k;concat right left};
    export fn main = (xs:[Num]) -> do {
      let rows=map xs (x -> {payload:{number:x,flag:x>0},[secret]:x*x});
      route rows 1 |> map (row -> row.payload.number+row[secret])
    };`;
  assert.deepEqual([...(await createRuntime(compile(source))).call('main',[[1,2,-3]])],[6,6,2]);
  reject(source.replace('route rows 1 |> map (row -> row.payload.number+row[secret])','route rows 1'),'E_ABI');
});

test('sorted views retain the full sorting barrier and its one shared scratch reservation',async()=>{
  const source=`export fn main = (xs:[Num]) -> do {
    let sorted=sort_by xs (x -> x);
    let {left,right}=split_at sorted 0;
    {empty:count left,first:at (concat right left) 0}
  };`;
  for(const mode of modes) {
    const c=compile(source,{...mode,maxLoopIterations:14}),r=await createRuntime(c);
    assert.equal(c.abi.version,2);assert.equal(c.stats.scratchReservationSites,1);
    assert.deepEqual(r.call('main',[[3,1,2]],{scratchBytes:96}),{empty:0,first:1});
    assert.throws(()=>r.call('main',[[3,1,2]],{scratchBytes:95}),WebAssembly.RuntimeError);
    assert.throws(()=>r.call('main',[[1,NaN,2]]),WebAssembly.RuntimeError);
    const onlyCount=await createRuntime(compile(source.replace('{empty:count left,first:at (concat right left) 0}','count left'),mode));
    assert.throws(()=>onlyCount.call('main',[[NaN]]),WebAssembly.RuntimeError);
    assert.equal(onlyCount.call('main',[[]],{scratchBytes:0}),0);
  }
});

test('later tuple keys can index a view without losing dependent sort discovery',async()=>{
  const source=`export fn main = (xs:[Num]) -> do {
    let sorted=sort_by xs (x -> -x);
    let {right}=split_at sorted 1;
    sort_by xs (x -> (abs x,at right 0))
  };`;
  const c=compile(source),r=await createRuntime(c);
  assert.equal(c.stats.scratchReservationSites,2);
  assert.deepEqual([...r.call('main',[[3,-1,2]],{scratchBytes:240})],[-1,2,3]);
});

test('raw output layout, odd Bool alignment, exact capacities and canaries stay intact',async()=>{
  const source='export fn main = (xs:[Bool]) -> (k:Num) -> split_at xs k;';
  const c=compile(source),memory=new WebAssembly.Memory({initial:1,maximum:1});
  new Uint8Array(memory.buffer).fill(0xa5);
  const arena=new Arena(memory),frame=prepareCall(arena,c.abi.exports[0],[[true,false,true,false,true],3],{outputBytes:24});
  const before=new Uint8Array(memory.buffer).slice(),instance=await instantiate(c,{memory});
  const end=instance.exports.main(...frame.slots),view=new DataView(memory.buffer);
  assert.deepEqual(plain(frame.lift(end)),{left:[true,false,true],right:[false,true]});
  assert.equal(end,frame.outputStart+24);
  const fields=c.abi.exports[0].result.layout.fields;
  const a=view.getUint32(frame.resultPointer+fields[0].offset,true),b=view.getUint32(frame.resultPointer+fields[1].offset,true);
  assert.equal(a,frame.outputStart);assert.equal(b,frame.outputStart+16);assert.equal(b%8,0);
  assert.deepEqual(new Uint8Array(memory.buffer,frame.slots[0],20),before.subarray(frame.slots[0],frame.slots[0]+20));
  assert(new Uint8Array(memory.buffer,end,16).every(x=>x===0xa5));
  assert(new Uint8Array(memory.buffer,a+12,4).every(x=>x===0xa5));
  const r=await createRuntime(c);
  assert.throws(()=>r.call('main',[[true,false,true,false,true],3],{outputBytes:23}),WebAssembly.RuntimeError);
  assert.deepEqual(r.call('main',[[true],0]),{left:[],right:[true]});
});

test('rotated raw payload bits survive and invalid descriptors cannot overwrite input',async()=>{
  const c=compile(rotate),memory=new WebAssembly.Memory({initial:1,maximum:1});
  new Uint8Array(memory.buffer).fill(0xa5);
  const arena=new Arena(memory),frame=prepareCall(arena,c.abi.exports[0],[[0,0,0,0],2],{outputBytes:32});
  const view=new DataView(memory.buffer),bits=[0x7ff8000000000042n,0x8000000000000000n,0x7ff0000000000000n,0n];
  bits.forEach((b,i)=>view.setBigUint64(frame.slots[0]+i*8,b,true));
  const instance=await instantiate(c,{memory});const before=new Uint8Array(memory.buffer).slice();
  const [ret,out,cap]=c.abi.exports[0].result.slots;
  for(const alter of [s=>{s[out]=s[0];},s=>{s[ret]=s[0];},s=>{s[cap]=-1;},s=>{s[out]++;},s=>{s[1]=2147483647;}]) {
    const slots=[...frame.slots];alter(slots);assert.throws(()=>instance.exports.main(...slots),WebAssembly.RuntimeError);
    assert.deepEqual(new Uint8Array(memory.buffer),before);
  }
  const end=instance.exports.main(...frame.slots),pointer=view.getUint32(frame.resultPointer,true);
  assert.deepEqual(Array.from({length:4},(_,i)=>view.getBigUint64(pointer+8*i,true)),[...bits.slice(2),...bits.slice(0,2)]);
  assert(new Uint8Array(memory.buffer,end,16).every(x=>x===0xa5));
});

test('views do not speculatively load inactive sides or vectorize across a segment boundary',async()=>{
  const source='export fn main = (xs:[Num]) -> (ys:[Num]) -> concat xs ys;';
  for(const mode of modes) {
    const c=compile(source,mode),r=await createRuntime(c);
    assert.equal(stats(c).simd.vectorizedLoops,0);
    for(const [a,b] of [[[],[1]],[[2],[]],[[2],[3]],[[1,2,3],[4,5]]])assert.deepEqual([...r.call('main',[a,b])],[...a,...b]);
    const malformed=compile('export fn main = (xs:[Bool]) -> at (concat (map (range 1) (x -> true)) xs) 0;',mode);
    const memory=new WebAssembly.Memory({initial:1}),arena=new Arena(memory);
    const frame=prepareCall(arena,malformed.abi.exports[0],[[true]]);
    new DataView(memory.buffer).setUint32(frame.slots[0],2,true);
    assert.equal((await instantiate(malformed,{memory})).exports.main(...frame.slots),1);
  }
});

test('prepared inputs, scalar cut overrides, caches and output ownership survive traps',async()=>{
  const compiler=createCompiler();compiler.compile(rotate).bytes.fill(0);const c=compiler.compile(rotate);assert(c.cache.hit);
  const r=await createRuntime(c),xs=[1,2,3],lease=r.prepare('main',[xs,1],{outputBytes:24});
  try {
    const a=lease.run();xs[0]=99;assert.deepEqual([...a],[2,3,1]);
    assert.deepEqual([...lease.run({cut:2})],[3,1,2]);
    assert.throws(()=>lease.run({cut:4}),WebAssembly.RuntimeError);
    assert.deepEqual([...lease.run()],[2,3,1]);a[0]=99;assert.equal(lease.run()[0],2);
  } finally {lease.dispose();}
  assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
  assert.throws(()=>r.call('main',[[1,2,3],1],{outputBytes:23}),WebAssembly.RuntimeError);
  assert.deepEqual([...r.call('main',[[3],0])],[3]);
});

test('effect authority, source order and file-local diagnostics remain explicit',async()=>{
  const source=`host fn audit:Num -> Bool;export fn main = (xs:[Num]) -> effect {
    perform audit 1;let {left,right}=split_at xs 1;perform audit 2;concat left right
  };`;
  const r=await createRuntime(compile(source,{maxLoopIterations:0})),seen=[];
  assert.throws(()=>r.call('main',[[1]]),e=>e.code==='E_CAPABILITY');
  const capability=createCapability({audit:{parameters:['Num'],result:'Bool',call:x=>(seen.push(x),true)}},{maxCalls:2});
  assert.throws(()=>r.call('main',[[1]],{capability}),WebAssembly.RuntimeError);assert.deepEqual(seen,[1,2]);
  reject('host fn cut:Num -> Num;export fn main = (xs:[Num]) -> split_at xs (cut 1);','E_EFFECT');
  const sourceBad='export fn main = (xs:[Num]) -> split_at xs missing;';
  const d=checkSources([{name:'client.ass',source:sourceBad}]).diagnostics[0];
  assert.equal(d.code,'E_NAME');assert.equal(d.sourceName,'client.ass');assert.equal(d.range.start.offset,sourceBad.indexOf('missing'));
  const sparse='export fn main = (xs:[Num]) -> split_at (filter xs (x -> x>0)) 0;';
  const sd=checkSources([{name:'client.ass',source:sparse}]).diagnostics[0];assert.equal(sd.code,'E_VIEW_DENSE');
  assert.equal(sd.sourceName,'client.ass');assert.equal(sd.range.start.offset,sparse.indexOf('split_at'));
  const sources=[{name:'helpers.ass',source:'fn rotate = xs -> cut -> do {let {left,right}=split_at xs cut;concat right left};'},
    {name:'main.ass',source:'export fn main = (xs:[Num]) -> rotate xs 1;'}];
  assert.deepEqual([...(await createRuntime(compileSources(sources))).call('main',[[1,2,3]])],[2,3,1]);
});

test('seeded piecewise programs match independent loops in all lowering modes',async t=>{
  let state=72031,cases=0;const random=()=>state=(Math.imul(state,1664525)+1013904223)>>>0;
  for(const mode of modes) {
    const r=await createRuntime(compile(files.get('section_report'),mode));
    for(let trial=0;trial<100;trial++) {
      const xs=Array.from({length:random()%24},()=>random()%21-10);
      const settings={cut:random()%(xs.length+1),leftGain:random()%7-3,rightGain:random()%7-3};
      assert.deepEqual(plain(r.call('section_report',[xs,settings])),oracle(xs,settings));cases++;
    }
  }
  assert.equal(cases,800);t.diagnostic(JSON.stringify({independentCausalReports:cases}));
});

test('example source formatting, documented blocks, CLI and comparison remain executable',async()=>{
  for(const [name,s] of files) {
    const compact=s.replace(/\/\/[^\n]*/g,'').replace(/\s+/g,' ');
    assert.deepEqual(compile(s).bytes,compile(compact).bytes);assert.deepEqual(compile(s).bytes,compile(s.replaceAll('\n','\r\n')).bytes);
  }
  const docs=await readFile(new URL('../docs/ARRAY-VIEWS.md',import.meta.url),'utf8');
  const blocks=[...docs.matchAll(/<!-- array-view-example: (\w+) -->\n```ass\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length,3);for(const [,name,s] of blocks)assert.equal(s+'\n',files.get(name));
  const p=spawnSync(process.execPath,['examples/interop/array-views.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(p.status,0,p.stderr);const result=JSON.parse(p.stdout);
  assert.equal(result.sectionReport.loops,1);assert.equal(result.virtualRange.loops,0);
  const cli=spawnSync(process.execPath,['examples/case-studies/app.mjs','view-rotate-scan'],
    {cwd:new URL('../',import.meta.url),input:'[[1,2,3,4],2]',encoding:'utf8',timeout:15000});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),[3,7,8,10]);
});


test('balanced fragment selection is logarithmic and prefix arithmetic is an outer obligation',()=>{
  const bindings=['let p0=map (range 1) (x -> x+0);'];
  for(let i=1;i<32;i++)bindings.push(`let p${i}=concat p${i-1} (map (range 1) (x -> x+${i}));`);
  const source=`export fn main = () -> do {${bindings.join('')}p31};`;
  const ast=parse(source),plan=stage(ast,infer(ast)).kernels[0].result;
  const height=n=>n.op==='if'?1+Math.max(height(n.args[1]),height(n.args[2])):0;
  assert.equal(plan.viewPieces.parts.length,32);assert.equal(height(plan.item),5);
  const outer=new Set();
  const visit=n=>{if(outer.has(n.id))return;outer.add(n.id);n.args.forEach(visit);};
  plan.guards.forEach(visit);
  const walk=n=>{if(n.op!=='if')return;assert(outer.has(n.args[0].args[1].id));walk(n.args[1]);walk(n.args[2]);};
  walk(plan.item);
});

test('browser view assertions also execute in Node',async()=>{
  const report={checks:0,cases:[]};
  await runArrayViewBrowserChecks({compile,check},createRuntime,report);
  assert.equal(report.checks,67);assert.equal(report.cases.length,1);
});


test('reassembly erases element routing but keeps cuts and nested cursor scopes',async()=>{
  const ast=parse(rejoin),plan=stage(ast,infer(ast)).kernels[0].result;
  assert.equal(plan.item.op,'load');
  const source=`export fn main = (xs:[Num]) -> do {
    let {left,right}=split_at xs 1;
    fold xs 0 (total -> outer -> total+sum (map (concat left right) (inner -> inner+outer)))
  };`;
  for(const mode of modes) {
    const r=await createRuntime(compile(source,mode));
    assert.equal(r.call('main',[[1,2,3]]),36);
    assert.equal(r.call('main',[[2,4]]),24);
  }
  const checked=await createRuntime(compile(rejoin));
  assert.throws(()=>checked.call('main',[[1],2]),WebAssembly.RuntimeError);
});
