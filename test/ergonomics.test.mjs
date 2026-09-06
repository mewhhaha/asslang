import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compile, compileSources, createCompiler, CompileError } from '../src/compiler.mjs';
import { createRuntime, Arena, lowerValue, liftFlat, ABIError } from '../src/abi.mjs';

const simple = 'export fn main(x:Num)=x+1;';
async function run(source, args = []) { return (await createRuntime(compile(source))).call('main', args); }

test('qualified and parenthesized pipes lower to ordinary static calls', async () => {
  const source = `fn maker(n)={ops:{scale:x=>x*n}};
    export fn main(x:Num)={let kit=maker(3); x |> kit.ops.scale |> (y=>y+2)};`;
  assert.equal(await run(source, [4]), 14);
  assert.equal(await run('export fn main(x:Num)=x |> (y=>y*2) |> (y=>y+1);',[4]), 9);
  assert.equal(await run('fn add(x,y)=x+y;export fn main(x:Num)={let ops={add:add};x |> ops.add(3)};',[4]), 7);
});

test('trailing commas and record puns preserve the existing singleton block syntax', async () => {
  assert.deepEqual(await run('export fn main(x:Num,)={x, extra:true,};',[4]), {x:4,extra:true});
  assert.deepEqual(await run('export fn main(x:Num)={x,};',[4]), {x:4});
  assert.equal(await run('export fn main(x:Num)={x};',[4]), 4);
  assert.deepEqual(await run('export fn main(x:{a:Num,b:Bool,},)={let a=x.a;let b=x.b;{a,b}};',[{a:2,b:true}]), {a:2,b:true});
  assert.equal(await run('export fn main(n:Num)=range(n,) |> fold(0,(s,x,)=>s+x,);',[4]), 6);
});

test('new syntax still rejects duplicate names and malformed lists', () => {
  for (const source of [
    'export fn main(x:Num)={x,x:2};',
    'export fn main(x:Num,x:Num,)=x;',
    'fn a(x)=x;fn a(x)=x;export fn main(x:Num)=x;',
  ]) assert.throws(() => compile(source), e=>e.code==='E_NAME');
  for (const source of [
    'export fn main(x:Num)=max(,x);',
    'export fn main(x:Num)=max(x,,);',
    'export fn main(x:Num)={,x};',
    'export fn main(x:Num)=x |> ;',
  ]) assert.throws(() => compile(source), e=>e.code==='E_PARSE');
});

test('source linking supports forward references, polymorphic helpers and end-of-file comments', async () => {
  const files = [
    {name:'app.ass',source:'export fn main(x:Num)={n:id(x),b:id(true)};'},
    {name:'helpers.ass',source:'fn id(x)=x; // no final newline'},
  ];
  const c = compileSources(files);
  assert.equal(c.sourceFiles[1].start, files[0].source.length+1);
  assert.deepEqual((await createRuntime(c)).call('main',[3]), {n:3,b:true});
  assert.ok(WebAssembly.validate(c.bytes));
});

test('linked errors have correct file-local offsets, including duplicate definitions', () => {
  const files = [{name:'helper.ass',source:'fn id(x)=x;\n'}, {name:'bad.ass',source:'export fn main(x:Num)=missing(x);'}];
  assert.throws(() => compileSources(files), e => {
    assert.ok(e instanceof CompileError);
    assert.equal(e.code,'E_NAME'); assert.equal(e.sourceName,'bad.ass');
    assert.equal(e.offset,files[1].source.indexOf('missing'));
    assert.equal(e.absoluteOffset,files[0].source.length+1+e.offset);
    assert.match(e.format(files[1].source), /^E_NAME at bad\.ass:1:23:/);
    return true;
  });
  assert.throws(() => compileSources([{name:'a',source:'fn id(x)=x;'}, {name:'b',source:'fn id(x)=x;export fn main(x:Num)=x;'}]), e=>e.code==='E_NAME'&&e.sourceName==='b');
});

test('source composition validates names, input shapes and aggregate resource limits', () => {
  for (const files of [[],null,[{name:'',source:simple}],[{name:'bad\nname',source:simple}],
    [{name:'a',source:4}],[{name:'a',source:simple},{name:'a',source:simple}]])
    assert.throws(()=>compileSources(files),TypeError);
  assert.throws(()=>compileSources([{name:'large',source:' '.repeat(1_000_001)}]),e=>e.code==='E_LIMIT');
  assert.throws(()=>compileSources(Array.from({length:129},(_,i)=>({name:String(i),source:simple}))),TypeError);
});

test('compiler sessions return independent bytes, ABI, statistics and proofs on misses and hits', () => {
  const c = createCompiler();
  const first = c.compile(simple), expected = compile(simple);
  assert.equal(first.cache.hit,false);
  first.bytes.fill(0); first.abi.exports[0].name='corrupted'; first.stats.functions[0].loops=999;
  const second = c.compile(simple);
  assert.equal(second.cache.hit,true); assert.deepEqual(second.bytes,expected.bytes);
  assert.equal(second.abi.exports[0].name,'main'); assert.equal(second.stats.functions[0].loops,0);
  second.certificate.steps.push({forged:true}); second.bytes[0]=7;
  assert.deepEqual(c.compile(simple).certificate,expected.certificate);
  assert.deepEqual(c.compile(simple).bytes,expected.bytes);
  assert.equal(c.stats.entries,1); assert.ok(c.stats.retainedBytes>0);
});

test('cache keys include all semantic compiler options and normalize defaults', () => {
  const c = createCompiler();
  const source='export fn main(xs:[Num])=sum(xs)+sum(map(xs,x=>x*x));';
  const a=c.compile(source,{reductionFusion:false}),b=c.compile(source);
  assert.equal(a.cache.hit,false);assert.equal(b.cache.hit,false);
  assert.equal(a.stats.functions[0].loops,2);assert.equal(b.stats.functions[0].loops,1);
  assert.equal(c.compile(source,{memoizeReductions:true,maxExpansion:100000,experimentalReductionFusion:false}).cache.hit,true);
  assert.throws(()=>c.compile(source,{memoizeReductions:'yes'}),TypeError);
  assert.throws(()=>c.compile(source,{experimentalReductionFusion:1}),TypeError);
  assert.throws(()=>c.compile(source,{maxExpansion:0}),TypeError);
});

test('LRU hits promote entries; failures and oversized artifacts are not cached', () => {
  const c=createCompiler({maxEntries:2});
  const a=simple,b=simple.replace('+1','+2'),d=simple.replace('+1','+3');
  c.compile(a);c.compile(b);assert.equal(c.compile(a).cache.hit,true);c.compile(d);
  assert.equal(c.compile(b).cache.hit,false);assert.equal(c.stats.entries,2);
  assert.equal(c.clear(),2);assert.deepEqual(c.stats,{hits:0,misses:0,entries:0,retainedBytes:0});
  const tiny=createCompiler({maxBytes:1});assert.equal(tiny.compile(simple).cache.stored,false);
  assert.equal(tiny.compile(simple).cache.hit,false);assert.equal(tiny.stats.retainedBytes,0);
  for(let i=0;i<2;i++)assert.throws(()=>c.compile('not source'),CompileError);
  assert.equal(c.stats.entries,0);assert.equal(c.stats.misses,2);
  for(const limits of [{maxEntries:0},{maxEntries:1.5},{maxEntries:1025},{maxBytes:-1},{maxBytes:Infinity}])
    assert.throws(()=>createCompiler(limits),TypeError);
});

test('cached multi-file builds keep each caller\'s manifest without hidden source loading', () => {
  const c=createCompiler();
  const a=c.compileSources([{name:'a',source:simple}]);
  const b=c.compileSources([{name:'b',source:simple}]);
  assert.equal(a.cache.hit,false);assert.equal(b.cache.hit,true);assert.equal(b.sourceFiles[0].name,'b');
  b.sourceFiles[0].name='changed';assert.equal(c.compileSources([{name:'a',source:simple}]).sourceFiles[0].name,'a');
});

test('native Wasm modules can be reused across independent private runtimes', async () => {
  const module=await WebAssembly.compile(compile('export fn main(xs:[Num])=map(xs,x=>x*2);').bytes);
  const a=await createRuntime(module),b=await createRuntime(module);
  const lease=a.prepare('main',[Float64Array.of(1,2)]);
  assert.deepEqual(Array.from(b.call('main',[Float64Array.of(3,4)])),[6,8]);
  assert.deepEqual(Array.from(lease.run()),[2,4]);lease.dispose();
});

test('bulk f64 lowering and lifting preserve special values and never expose borrowed views', async () => {
  const values=Float64Array.of(0,-0,Infinity,-Infinity,NaN,Number.MIN_VALUE,Number.MAX_VALUE);
  const r=await createRuntime(compile('export fn main(xs:[Num])=xs;'));
  const lease=r.prepare('main',[values]);values.fill(7);
  const first=lease.run();assert.ok(Object.is(first[1],-0));assert.ok(Number.isNaN(first[4]));
  assert.deepEqual(first,Float64Array.of(0,-0,Infinity,-Infinity,NaN,Number.MIN_VALUE,Number.MAX_VALUE));
  first.fill(9);assert.equal(lease.run()[0],0);lease.dispose();
  assert.equal(first[0],9);
});

test('typed array subviews use intrinsic lengths, not user iterators or shadow accessors', () => {
  const memory=new WebAssembly.Memory({initial:1}),arena=new Arena(memory);
  const value=Float64Array.of(1,2,3,4).subarray(1,3);
  Object.defineProperty(value,'length',{get(){throw new Error('length getter must not run');}});
  value[Symbol.iterator]=()=>{throw new Error('iterator must not run');};
  const schema={kind:'Stream',element:{kind:'Num'}},slots=lowerValue(arena,schema,value);
  assert.deepEqual(slots,[0,2]);assert.deepEqual(Array.from(liftFlat(memory,schema,slots)),[2,3]);
});

test('bulk copies have overlap-safe semantics and retain ordinary array validation', () => {
  const memory=new WebAssembly.Memory({initial:1}),arena=new Arena(memory);
  new Float64Array(memory.buffer,0,4).set([1,2,3,4]);arena.offset=8;
  const schema={kind:'Stream',element:{kind:'Num'}};
  assert.deepEqual(lowerValue(arena,schema,new Float64Array(memory.buffer,0,3)),[8,3]);
  assert.deepEqual(Array.from(new Float64Array(memory.buffer,0,4)),[1,1,2,3]);
  for(const values of [[1,,3],['1'],[true]])assert.throws(()=>lowerValue(arena,schema,values),ABIError);
  let touched=false;const getter=[];Object.defineProperty(getter,'0',{get(){touched=true;return 1;}});
  assert.throws(()=>lowerValue(arena,schema,getter),ABIError);assert.equal(touched,false);
});

test('local declaration run-length encoding preserves large local indices and deterministic binaries', async () => {
  const source='export fn main(x:Num)=x'+Array.from({length:200},(_,i)=>`+${i+1}`).join('')+';';
  const c=compile(source),d=compile(source);
  assert.deepEqual(c.bytes,d.bytes);assert.ok(c.stats.functions[0].wasmLocals>127);
  assert.ok(c.stats.functions[0].wasmLocalDeclarationGroups<c.stats.functions[0].wasmLocals);
  assert.equal((await createRuntime(c)).call('main',[1]),20101);
});

test('CLI links libraries, runs JSON arguments, diagnoses source files and protects input aliases', async () => {
  const directory=await mkdtemp(join(tmpdir(),'asslang-cli-'));
  const cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url));
  const command=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
  try {
    const helper=join(directory,'helper.ass'),app=join(directory,'app.ass'),output=join(directory,'out.wasm');
    await writeFile(helper,'fn twice(x)=x*2;');await writeFile(app,'export fn main(x:Num)=twice(x);');
    const run=command(app,'--lib',helper,'--run','main','--args','[4]');
    assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.trim(),'8');
    const build=command(app,'--lib',helper,'-o',output);assert.equal(build.status,0,build.stderr);
    assert.ok(WebAssembly.validate(await readFile(output)));
    assert.equal(JSON.parse(await readFile(output+'.json','utf8')).sourceFiles.length,2);
    const alias=join(directory,'alias.ass');await symlink(helper,alias);
    const protectedRun=command(app,'--lib',helper,'-o',alias);
    assert.equal(protectedRun.status,1);assert.match(protectedRun.stderr,/must not overwrite source/);
    assert.equal(await readFile(helper,'utf8'),'fn twice(x)=x*2;');
    const hardlink=join(directory,'hardlink.ass');await link(helper,hardlink);
    const hardlinkRun=command(app,'--lib',helper,'-o',hardlink);
    assert.equal(hardlinkRun.status,1);assert.match(hardlinkRun.stderr,/must not overwrite source/);
    await writeFile(app,'export fn main(x:Num)=missing(x);');
    const bad=command(app,'--lib',helper,'--check');assert.equal(bad.status,1);assert.ok(bad.stderr.includes(app+':1:'));
    assert.equal(command(app,'--run','main','--check').status,1);
    assert.equal(command(app,'--args','[]').status,1);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
