import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

async function runtime(source, options) { return createRuntime(compile(source, options), { pages: 4 }); }
const options = [
  { memoizeReductions: false, experimentalReductionFusion: false },
  { memoizeReductions: true, experimentalReductionFusion: false },
  { memoizeReductions: false, experimentalReductionFusion: true },
  { memoizeReductions: true, experimentalReductionFusion: true },
];
const search = 'export fn find(xs:[Num], key:Num) = fold_until(xs, -1, (s,x) => {state:x, done:x==key});';

test('fold_until returns final state, accepted steps, and an unambiguous completion flag', async () => {
  const compiled = compile(search);
  assert.equal(compiled.stats.functions[0].shortCircuitFolds, 1);
  assert.equal(compiled.stats.functions[0].loops, 1);
  assert.ok(verifyCertificate(compiled.certificate.steps));
  const r = await createRuntime(compiled);
  assert.deepEqual(r.call('find', [[], 2]), {state:-1,steps:0,done:false});
  assert.deepEqual(r.call('find', [[2,3,4], 2]), {state:2,steps:1,done:true});
  assert.deepEqual(r.call('find', [[1,2,3], 3]), {state:3,steps:3,done:true});
  assert.deepEqual(r.call('find', [[1,2,3], 9]), {state:3,steps:3,done:false});
});

test('a stopping fold never demands a mapped, filtered, or causal suffix', async () => {
  for (const configuration of options) {
    for (const stream of [
      'map(xs, x => require(x < 3, x))',
      'filter(xs, x => require(x < 3, true))',
      'scan(xs, 0, (s,x) => require(x < 3, x))',
      'transduce(xs, 0, (s,x) => {state:require(x<3,x),emit:true,value:x})',
    ]) {
      const r = await runtime(`export fn main(xs:[Num])=fold_until(${stream},0,(s,x)=>{state:x,done:x==2});`, configuration);
      assert.deepEqual(r.call('main', [[1,2,3,4]]), {state:2,steps:2,done:true});
      assert.throws(() => r.call('main', [[1,3,4]]), WebAssembly.RuntimeError);
    }
  }
});

test('steps count accepted events, not source positions, with simultaneous nested state', async () => {
  const r = await runtime(`export fn main(xs:[Num]) = xs
    |> filter(x => x > 0)
    |> fold_until({pair:{a:0,b:1},total:0}, (s,x) => {
      state:{pair:{a:s.pair.b,b:s.pair.a+s.pair.b},total:s.total+x},
      done:s.total+x>=5,
    });`);
  assert.deepEqual(r.call('main', [[-5,0,2,-3,3,100]]), {state:{pair:{a:1,b:2},total:5},steps:2,done:true});
  assert.deepEqual(r.call('main', [[-5,0,-3]]), {state:{pair:{a:0,b:1},total:0},steps:0,done:false});
});

test('empty and filtered-out sources do not initialize causal state', async () => {
  const r = await runtime(`export fn main(xs:[Num]) = xs |> filter(x=>false)
    |> scan(require(false,0),(s,x)=>s+x)
    |> fold_until(7,(s,x)=>{state:x,done:true});`);
  assert.deepEqual(r.call('main', [[1,2]]), {state:7,steps:0,done:false});
});

test('short-circuiting never drops zip_checked obligations or initializes dead sink bodies', async () => {
  const r = await runtime(`export fn main(xs:[Num],ys:[Num])=fold_until(
    zip_checked(xs,ys,(x,y)=>x+y),0,(s,x)=>{state:x,done:true});`);
  assert.throws(() => r.call('main', [[],[1]]), WebAssembly.RuntimeError);
  const dead = await runtime('export fn main(xs:[Num])=fold_until(xs,0,(s,x)=>{state:sum(range(-1)),done:true});');
  assert.deepEqual(dead.call('main',[[]]), {state:0,steps:0,done:false});
  assert.throws(() => dead.call('main',[[1]]), WebAssembly.RuntimeError);
});

test('terminating sinks remain separate from full reductions, including under opt-in fusion', async () => {
  const source = `export fn main(xs:[Num])={
    let s=scan(xs,0,(s,x)=>require(x<3,x));
    {first:fold_until(s,0,(s,x)=>{state:x,done:x==2}),total:sum(s)}
  };`;
  for (const configuration of options) {
    const c = compile(source, configuration);
    assert.equal(c.stats.functions[0].loops, 2);
    assert.equal(c.stats.functions[0].reductionFusion.eliminatedLoops, 0);
    const r = await createRuntime(c);
    assert.throws(() => r.call('main', [[1,2,3]]), WebAssembly.RuntimeError);
  }
});

async function cases(source, name, args, expected) {
  for (const configuration of options) {
    const r = await runtime(source, configuration);
    assert.deepEqual(r.call(name, args), expected);
  }
}

test('nested stopping folds rebind cursors and track outer values through memoization', async () => {
  const source = `export fn main(xs:[Num])=map(xs,x=>fold_until(xs,0,(s,y)=>{
    state:s+x*y,done:y>=x
  }).state);`;
  for (const configuration of options) {
    const r = await runtime(source, configuration);
    assert.deepEqual(Array.from(r.call('main', [[1,2,3]])), [1,6,18]);
  }
  await cases(`export fn main(xs:[Num])=fold_until(xs,0,(s,x)=>{
    state:s+fold_until(xs,0,(t,y)=>{state:t+y,done:y>=x}).state,done:x>=2
  });`, 'main', [[1,2,3]], {state:4,steps:2,done:true});
});

test('at substitution preserves early-exit conditions and captured indices', async () => {
  const source = `export fn main(xs:[Num],i:Num)=at(map(xs,x=>fold_until(xs,0,(s,y)=>{
    state:s+y,done:y>=x
  }).state),i);`;
  await cases(source, 'main', [[1,2,3],2], 6);
});

test('invariant terminating reductions are memoized without speculative traps', async () => {
  for (const configuration of options) {
    const r = await runtime('export fn main(n:Num)=range(n) |> map(x=>fold_until(range(-1),0,(s,y)=>{state:y,done:true}).state);', configuration);
    assert.deepEqual(Array.from(r.call('main',[0])), []);
    assert.throws(() => r.call('main',[1]), WebAssembly.RuntimeError);
  }
});

test('fold_until checks state, predicate, and nonescaping representation', () => {
  for (const source of [
    'export fn main(xs:[Num])=fold_until(xs,0,(s,x)=>{state:true,done:false});',
    'export fn main(xs:[Num])=fold_until(xs,0,(s,x)=>{state:s+x,done:1});',
    'export fn main(xs:[Num])=fold_until(xs,0,(s,x)=>s+x);',
  ]) assert.throws(() => compile(source), error => error.code==='E_TYPE');
});

test('stopping transitions are strict even when only done or one state field is observed', async () => {
  for(const configuration of options) {
    const r=await runtime(`export fn main(xs:[Num])=fold_until(xs,{a:0,b:0},(s,x)=>{
      state:{a:x,b:require(x>0,x)},done:true
    }).done;`,configuration);
    assert.equal(r.call('main',[[]]),false);
    assert.throws(()=>r.call('main',[[-1,2]]),WebAssembly.RuntimeError);
    assert.equal(r.call('main',[[1,-2]]),true);
  }
});

test('empty record and Boolean states do not need an invented numeric accumulator', async () => {
  const r=await runtime(`export fn main(xs:[Num])=fold_until(xs,{},(s,x)=>{state:{},done:x>0});`);
  assert.deepEqual(r.call('main',[[-1,0,2,-3]]),{state:{},steps:3,done:true});
  const b=await runtime(`export fn main(xs:[Num])=fold_until(xs,false,(s,x)=>{state:x>0,done:x>0});`);
  assert.deepEqual(b.call('main',[[-1,2,3]]),{state:true,steps:2,done:true});
});
