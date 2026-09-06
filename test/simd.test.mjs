import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { compile, createCompiler, check } from '../src/compiler.mjs';
import { supportsSIMD, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

const map = 'export fn main = (xs:[Num]) -> map xs (x -> x*x+2);';
const modes = [false,true].flatMap(simd => [false,true].map(reductionFusion => ({simd,reductionFusion})));
const plain = x => ArrayBuffer.isView(x) ? Array.from(x) : Array.isArray(x) ? x.map(plain) :
  x && typeof x==='object' ? Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])) : x;
const same = (actual,expected) => assert.deepEqual(plain(actual),plain(expected));

test('SIMD is explicit, validates binaries, preserves ABI/proofs and reports real vector loops', () => {
  assert.equal(supportsSIMD(),true);
  const a=compile(map), b=compile(map,{simd:true});
  assert.equal(a.stats.functions[0].simd.vectorizedLoops,0);
  assert.equal(b.stats.functions[0].simd.vectorizedLoops,1);
  assert.ok(b.stats.functions[0].simd.vectorInstructions>=4);
  assert.ok(WebAssembly.validate(b.bytes));
  assert.deepEqual(a.abi,b.abi); assert.deepEqual(a.certificate,b.certificate);
  assert.equal(verifyCertificate(b.certificate.steps),true);
  assert.notDeepEqual(a.bytes,b.bytes);
  assert.equal(b.stats.kernelHeapAllocationSites,0);
  assert.equal(b.stats.intermediateBufferBytes,0);
});

for (const expression of ['x','-x','abs x','sqrt (abs x)','floor x','x+2','x-2','x*x','x/2','min x 0','max x 0'])
  test(`SIMD lane operation: ${expression}`, async () => {
    const source=`export fn main = (xs:[Num]) -> map xs (x -> ${expression});`;
    const inputs=[[],[-0],[1,-2,3],[0,-0,NaN,Infinity,-Infinity,Number.MIN_VALUE,-Number.MIN_VALUE,1.5,-1.5]];
    const scalar=await createRuntime(compile(source,{simd:false}));
    for(const options of modes) {
      const c=compile(source,options),runtime=await createRuntime(c);
      if(options.simd)assert.equal(c.stats.functions[0].simd.vectorizedLoops,1);
      for(const xs of inputs)same(runtime.call('main',[xs]),scalar.call('main',[xs]));
    }
  });

test('ordered SIMD sums retain cancellation, signed zero, infinity and NaN behavior', async () => {
  for(const term of ['x','x*x','x/3']) {
    const source=`export fn main = (xs:[Num]) -> sum (map xs (x -> ${term}));`;
    const scalar=await createRuntime(compile(source,{simd:false}));
    for(const options of modes) {
      const c=compile(source,options),r=await createRuntime(c);
      if(options.simd)assert.equal(c.stats.functions[0].simd.vectorizedLoops,1);
      for(const xs of [[],[-0],[1e16,1,-1e16,1],[Infinity,1],[-Infinity,Infinity],[NaN],[1,NaN,3],[Number.MIN_VALUE,-Number.MIN_VALUE]])
        same(r.call('main',[xs]),scalar.call('main',[xs]));
    }
  }
});

test('500 seeded vector maps, checked zips and sums match scalar execution exactly', async () => {
  const source='export fn main = (xs:[Num]) -> (ys:[Num]) -> (scale:Num) -> {values:zip_checked xs ys (x -> y -> x*scale+y),total:sum (map xs (x -> (x*x+2)/3))};';
  const runtimes=await Promise.all(modes.map(o=>createRuntime(compile(source,o))));
  let seed=0x932fee11;const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<500;i++) {
    const n=random()%34,args=[Array.from({length:n},()=>((random()%2001)-1000)/7),Array.from({length:n},()=>((random()%1001)-500)/3),((random()%101)-50)/9];
    const expected=runtimes[0].call('main',args);
    for(const runtime of runtimes.slice(1))same(runtime.call('main',args),expected);
  }
});

test('raw SIMD maps accept 8-byte alignment, exact output capacity and memory-edge tails', async () => {
  const c=compile(map,{simd:true}),memory=new WebAssembly.Memory({initial:1,maximum:1});
  const {instance}=await WebAssembly.instantiate(c.bytes,{env:{memory}}), f=instance.exports.main;
  for(const [pointer,values] of [[8,[2,3,4]],[65512,[2,3,4]],[65528,[5]]]) {
    new Float64Array(memory.buffer,pointer,values.length).set(values);
    assert.equal(f(pointer,values.length,32,64,values.length*8),64+values.length*8);
    same(new Float64Array(memory.buffer,64,values.length),values.map(x=>x*x+2));
  }
  assert.equal(f(8,0,32,64,0),64);
  for(const args of [[4,2,32,64,16],[65528,2,32,64,16],[8,3,32,64,23],[8,3,32,16,24],[8,2,32,65528,16]])
    assert.throws(()=>f(...args),WebAssembly.RuntimeError);
});

test('SIMD checked zip rejects mismatches even when one side is empty', async () => {
  const source='export fn main = (xs:[Num]) -> (ys:[Num]) -> sum (zip_checked xs ys (x -> y -> x*y));';
  const c=compile(source,{simd:true}),r=await createRuntime(c);
  assert.equal(c.stats.functions[0].simd.vectorizedLoops,1);
  for(const args of [[[],[1]],[[1],[]],[[1,2],[3]]])assert.throws(()=>r.call('main',args),WebAssembly.RuntimeError);
  assert.equal(r.call('main',[[1,2,3],[4,5,6]]),32);
});

test('guards, predicates, causal state and random access fall back without speculative demand', async () => {
  for(const body of [
    'map (filter xs (x -> false)) (x -> at xs 100)',
    'map xs (x -> if x>0 then at xs 100 else 0)',
    'scan xs 0 (s -> x -> s+x)',
    'map xs (x -> require (x<=0) x)',
  ]) {
    const source=`export fn main = (xs:[Num]) -> ${body};`,c=compile(source,{simd:true});
    assert.equal(c.stats.functions[0].simd.vectorizedLoops,0);
    const r=await createRuntime(c);same(r.call('main',[[]]),[]);
    same(r.call('main',[[-1,-2]]),(await createRuntime(compile(source))).call('main',[[-1,-2]]));
  }
  const c=compile('export fn main = (xs:[Num]) -> count (map xs (x -> require false x));',{simd:true});
  assert.equal(c.stats.functions[0].simd.vectorizedLoops,0);
  assert.equal((await createRuntime(c)).call('main',[[1,2,3]]),3);
});

test('fusion takes precedence for shared sinks; SIMD still handles separate numeric outputs', async () => {
  const source='export fn main = (xs:[Num]) -> {total:sum xs,energy:sum (map xs (x -> x*x)),values:map xs (x -> x+2)};';
  const c=compile(source,{simd:true}),stats=c.stats.functions[0];
  assert.equal(stats.reductionFusion.eliminatedLoops,1);
  assert.equal(stats.simd.vectorizedLoops,1);
  same((await createRuntime(c)).call('main',[[1,2,3]]),{total:6,energy:14,values:[3,4,5]});
});

test('mixed Bool and SIMD Num output streams retain descriptor alignment and ownership', async () => {
  const source='export fn main = (xs:[Num]) -> {a:map xs (x -> x>0),b:map xs (x -> x*2)};';
  const r=await createRuntime(compile(source,{simd:true}));
  const value=r.call('main',[[-1,2,3]]);r.call('main',[[9]]);
  same(value,{a:[false,true,true],b:[-2,4,6]});
});

test('all new options validate and compiler sessions separate SIMD/scalar and normalize fusion aliases', () => {
  for(const field of ['simd','reductionFusion'])for(const value of [null,1,'yes',{},[]])
    assert.throws(()=>compile(map,{[field]:value}),TypeError);
  assert.throws(()=>compile(map,{reductionFusion:true,experimentalReductionFusion:false}),/Conflicting/);
  const session=createCompiler();
  assert.equal(session.compile(map).cache.hit,false);
  assert.equal(session.compile(map,{experimentalReductionFusion:true}).cache.hit,true);
  assert.equal(session.compile(map,{simd:true}).cache.hit,false);
  assert.equal(session.compile(map,{simd:true,reductionFusion:true}).cache.hit,true);
  assert.equal(session.compile(map,{simd:true,reductionFusion:false}).cache.hit,false);
});

test('unsupported SIMD engines produce a target diagnostic rather than a compiler-bug claim', () => {
  const validate=WebAssembly.validate;
  try {
    WebAssembly.validate=()=>false;
    const result=check(map,{simd:true});
    assert.equal(result.ok,false);assert.equal(result.diagnostics[0].code,'E_TARGET');
    assert.equal(result.diagnostics[0].phase,'validate');
  } finally { WebAssembly.validate=validate; }
});

test('CLI supports SIMD and a fusion opt-out and rejects conflicting aliases', () => {
  const run=args=>spawnSync(process.execPath,['src/cli.mjs','examples/simd/saxpy.ass',...args],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  const result=run(['--simd','--no-reduction-fusion','--check','--explain']);
  assert.equal(result.status,0,result.stderr);
  const c=JSON.parse(result.stdout);assert.equal(c.stats.functions[0].simd.vectorizedLoops,1);
  assert.equal(c.stats.functions[0].reductionFusion.enabled,false);
  assert.equal(run(['--no-reduction-fusion','--experimental-reduction-fusion','--check']).status,1);
});
