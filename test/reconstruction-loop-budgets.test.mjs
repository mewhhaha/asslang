import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compile, compileSources, checkSources, createCompiler, reconstructionSource,
  verifyCertificate,
} from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const chain = reconstructionSource('observations', {
  nodes: ['n', 'first', 'second'],
  edges: [
    { from: 'n', to: 'first', map: 'sumRange' },
    { from: 'first', to: 'second', map: 'sumRange' },
  ],
});
const chainApp = `export fn main = (n:Num) ->
  ((observations {sumRange:x -> sum (range x)}).restore {n}).second;`;
const files = (generated, source) => [generated, { name: 'app.ass', source }];
const build = (generated, source, options) => compileSources(files(generated, source), options);

const checked = reconstructionSource('checked_observations', {
  nodes: ['n', 'total'],
  edges: [{ from: 'n', to: 'total', map: 'sumRange' }],
}, { observed: ['n', 'total'] });
const checkApp = result => `
  fn equal = x -> y -> sum (range 2) == 1 && x == y;
  export fn main = (n:Num) -> (total:Num) -> do {
    let p = checked_observations {sumRange:x -> sum (range x)};
    let value = p.restore {n,total};
    let valid = p.check {total:equal} value;
    ${result}
  };`;

test('scalar reconstruction stages away and spends zero loop units', async () => {
  const generated = reconstructionSource('scalar_observations', {
    nodes: ['a', 'b', 'total'],
    edges: [
      { from: 'a', to: 'b', map: 'flip' },
      { from: 'b', to: 'a', map: 'flip' },
      { from: 'a', to: 'total', map: 'zero' },
    ],
  }, { observed: ['b'] });
  const source = `export fn main = (b:Num) ->
    (scalar_observations {flip:x -> -x,zero:x -> 0}).restore {b};`;
  const direct = 'export fn main = (b:Num) -> {a:-b,b,total:0};';
  for (const mode of modes) for (const maxLoopIterations of [undefined, 0]) {
    const options = { ...mode, maxLoopIterations };
    const c = build(generated, source, options);
    assert.deepEqual(c.bytes, compile(direct, options).bytes);
    assert.equal(c.stats.functions[0].loops, 0);
    const r = await createRuntime(c);
    assert.deepEqual(r.call('main', [3]), { a: -3, b: 3, total: 0 });
  }
});

test('generated arrows share one allowance with raw enforcement and per-call reset', async () => {
  // n=4: the first traversal takes 4 steps and yields 6; the second takes
  // another 6 steps and yields 15. An arrow call must not reset the counter.
  const direct = `export fn main = (n:Num) -> do {
    let first = sum (range n); sum (range first)
  };`;
  for (const mode of modes) {
    for (const maxLoopIterations of [undefined, 9, 10]) {
      const options = { ...mode, maxLoopIterations };
      const c = build(chain, chainApp, options);
      assert.deepEqual(c.bytes, compile(direct, options).bytes);
      assert.equal(verifyCertificate(c.certificate.steps), true);
      const module = new WebAssembly.Module(c.bytes);
      assert.deepEqual(WebAssembly.Module.imports(module), []);
      const raw = new WebAssembly.Instance(module).exports.main;
      if (maxLoopIterations === 9) assert.throws(() => raw(4), WebAssembly.RuntimeError);
      else assert.equal(raw(4), 15);
      if (maxLoopIterations !== undefined) {
        assert.throws(() => raw(5), WebAssembly.RuntimeError);
        assert.equal(raw(3), 3);
        assert.equal(c.executionLimits.maxLoopIterations, maxLoopIterations);
      }
    }
  }
});

test('explicit coherence maps and equality predicates consume the same budget', async () => {
  // Both coordinates are retained, so restoration is free. The check traverses
  // range(4) in its arrow and range(2) in its equality predicate: six units.
  for (const mode of modes) {
    const options = { ...mode, maxLoopIterations: 6 };
    const r = await createRuntime(build(checked, checkApp('valid'), options));
    assert.equal(r.call('main', [4, 6]), true);
    assert.equal(r.call('main', [4, 7]), false);
    const tooSmall = await createRuntime(build(checked, checkApp('valid'),
      { ...mode, maxLoopIterations: 5 }));
    assert.throws(() => tooSmall.call('main', [4, 6]), WebAssembly.RuntimeError);
    assert.equal(tooSmall.call('main', [3, 3]), true);
    const enforced = await createRuntime(build(checked,
      checkApp('require valid value.total'), options));
    assert.equal(enforced.call('main', [4, 6]), 6);
    assert.throws(() => enforced.call('main', [4, 7]), WebAssembly.RuntimeError);
  }
});

test('unused reconstructed coordinates and undemanded checks spend no allowance', async () => {
  const source = `export fn main = (n:Num) -> do {
    let p = observations {sumRange:x -> sum (range x)};
    let value = p.restore {n};
    let equal = x -> y -> sum (range 2) == 1 && x == y;
    {valid:p.check {first:equal,second:equal} value,value:value.n}.value
  };`;
  for (const mode of modes) {
    const c = build(chain, source, { ...mode, maxLoopIterations: 0 });
    assert.equal(c.stats.functions[0].loops, 0);
    assert.equal((await createRuntime(c)).call('main', [2147483647]), 2147483647);
  }
});

test('reconstructed causal streams retain exact loop costs and certificates', async () => {
  const generated = reconstructionSource('stream_observations', {
    nodes: ['xs', 'prefix'],
    edges: [{ from: 'xs', to: 'prefix', map: 'scan' }],
  });
  const source = `export fn main = (xs:[Num]) ->
    sum ((stream_observations {scan:ys -> scan ys 0 (s -> x -> s+x)}).restore {xs}).prefix;`;
  const direct = 'export fn main = (xs:[Num]) -> sum (scan xs 0 (s -> x -> s+x));';
  for (const mode of modes) for (const maxLoopIterations of [0, 3, 4]) {
    const options = { ...mode, maxLoopIterations };
    const c = build(generated, source, options);
    assert.deepEqual(c.bytes, compile(direct, options).bytes);
    assert.equal(verifyCertificate(c.certificate.steps), true);
    const r = await createRuntime(c);
    assert.equal(r.call('main', [[]]), 0);
    if (maxLoopIterations < 4)
      assert.throws(() => r.call('main', [[1, 2, 3, 4]]), WebAssembly.RuntimeError);
    else assert.equal(r.call('main', [[1, 2, 3, 4]]), 20);
    assert.equal(r.call('main', [[]]), 0);
  }
});

test('named generated sources retain session cache isolation and non-executing checks', async () => {
  const session = createCompiler();
  const sources = files(chain, chainApp);
  const first = session.compileSources(sources, { maxLoopIterations: 10 });
  const small = session.compileSources(sources, { maxLoopIterations: 9 });
  assert.equal(first.cache.hit, false);
  assert.equal(small.cache.hit, false);
  first.bytes.fill(0);
  first.executionLimits.maxLoopIterations = 999;
  const cached = session.compileSources(sources, { maxLoopIterations: 10 });
  assert.equal(cached.cache.hit, true);
  assert.equal(cached.executionLimits.maxLoopIterations, 10);
  assert.equal((await createRuntime(cached)).call('main', [4]), 15);
  const r = await createRuntime(small);
  assert.throws(() => r.call('main', [4]), WebAssembly.RuntimeError);
  assert.equal(checkSources(sources, { maxLoopIterations: 0 }).ok, true);
  assert.equal(session.checkSources(sources, { maxLoopIterations: 0 }).ok, true);
});

test('metered generated protocols preserve source-local diagnostics and causal restrictions', () => {
  const source = '// local error\nexport fn main = (n:Num) -> ((observations {sumRange:x -> missing x}).restore {n}).second;';
  const result = checkSources(files(chain, source), { maxLoopIterations: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'E_NAME');
  assert.equal(result.diagnostics[0].sourceName, 'app.ass');
  assert.equal(result.diagnostics[0].range.start.offset, source.indexOf('missing'));
  const generated = reconstructionSource('stream_observations', {
    nodes: ['xs', 'prefix'], edges: [{ from: 'xs', to: 'prefix', map: 'scan' }],
  });
  assert.throws(() => build(generated, `export fn main = (xs:[Num]) ->
    at ((stream_observations {scan:ys -> scan ys 0 (s -> x -> s+x)}).restore {xs}).prefix 0;`,
  { maxLoopIterations: 0 }), e => e.code === 'E_CAUSAL_ACCESS');
});
