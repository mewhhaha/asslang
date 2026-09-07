import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileSources, CompileError } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';
const modes = [false,true].flatMap(simd => [false,true].flatMap(reductionFusion =>
  [false,true].map(memoizeReductions => ({simd,reductionFusion,memoizeReductions}))));

for (const options of modes) test(`finite callables preserve demand ${JSON.stringify(options)}`, async () => {
  const source = `fn strategy = flag -> bias ->
    if flag then (x -> x*x+bias) else (x -> require (x>=0) (x+bias));
    export fn main = (flag:Bool) -> (bias:Num) -> (x:Num) -> strategy flag bias x;`;
  const c=compile(source,options), r=await createRuntime(c);
  let seed=17;
  for(let i=0;i<128;i++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const x=(seed%101)-50, bias=i-30, flag=i%2===0;
    if(!flag && x<0) assert.throws(()=>r.call('main',[flag,bias,x]),WebAssembly.RuntimeError);
    else assert.equal(r.call('main',[flag,bias,x]),flag?x*x+bias:x+bias);
  }
  assert.equal(c.stats.kernelHeapAllocationSites,0);
  const module = new WebAssembly.Module(c.bytes);
  assert.equal(WebAssembly.Module.imports(module).some(i=>i.kind==='table'||i.kind==='function'),false);
});

test('guarded higher-order values stay lazy and propagate through returned callables', async () => {
  const r=await createRuntime(compile(`fn guarded = ok -> require ok (x -> y -> x+y);
    export fn main = (ok:Bool) -> (use:Bool) -> do {
      let f=guarded ok 4; if use then f 3 else 9
    };`));
  assert.equal(r.call('main',[false,false]),9);
  assert.equal(r.call('main',[true,true]),7);
  assert.throws(()=>r.call('main',[false,true]),WebAssembly.RuntimeError);
});

test('policy captures vary per causal transition rather than being cached as invariant', async () => {
  for(const options of modes) {
    const r=await createRuntime(compile(`export fn main = (xs:[Num]) ->
      scan xs 0 (s -> x -> do {
        let f=if s>0 then (y -> s-y) else (y -> s+y);
        f x
      });`,options));
    assert.deepEqual(Array.from(r.call('main',[[2,3,4,5]])),[2,-1,3,-2]);
  }
});

test('finite callables do not escape the ABI or gain host authority', () => {
  for(const source of [
    'export fn main = (b:Bool) -> if b then (x -> x+1) else (x -> x*2);',
    'export fn main = (b:Bool) -> {f:if b then abs else sqrt};',
    'host fn h: Num -> Num; export fn main = (b:Bool) -> (x:Num) -> (if b then h else abs) x;',
  ]) assert.throws(()=>compile(source),CompileError);
});

test('callable branch type errors retain linked file coordinates', () => {
  const source='export fn main = (b:Bool) -> (if b then abs else (x -> true)) 2;';
  assert.throws(()=>compileSources([{name:'helper.ass',source:'fn id = x -> x;'},
    {name:'policy.ass',source}]),error=>error instanceof CompileError && error.code==='E_TYPE'
      && error.sourceName==='policy.ass' && error.offset>=0);
});

test('specialization is bounded, not a runtime fallback or unbounded unroll', () => {
  const source='fn twice = f -> x -> f (f x); export fn main = (b:Bool) -> (x:Num) -> '+
    'twice (twice (twice (if b then abs else sqrt))) x;';
  assert.throws(()=>compile(source,{maxExpansion:20}),error=>error.code==='E_LIMIT');
});

test('choosing stateful-returning functions does not forge a merged causal history', () => {
  assert.throws(()=>compile(`export fn main = (b:Bool) -> (xs:[Num]) ->
    (if b then (ys -> scan ys 0 (s -> x -> s+x))
          else (ys -> scan ys 1 (s -> x -> s*x))) xs;`),error=>error.code==='E_STATE_BRANCH');
});
