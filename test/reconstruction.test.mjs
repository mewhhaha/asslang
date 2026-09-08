import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileSources, planReconstruction, reconstructionSource, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

const edge = (from, to, map = 'id') => ({ from, to, map });
const six = {
  nodes: ['a0', 'a1', 'b0', 'b1', 'b2', 'sink'],
  edges: [edge('a0', 'a1', 'flip'), edge('a1', 'a0', 'flip'),
    edge('b0', 'b1'), edge('b1', 'b2'), edge('b2', 'b0'),
    edge('a0', 'sink', 'zero'), edge('b0', 'sink', 'zero')],
};
const maps = '{id:x -> x, flip:x -> -x, zero:x -> 0}';
const equal = 'fn equal = x -> y -> x == y;';
const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const build = (generated, source, options) => compileSources([generated, { name: 'app.ass', source }], options);
const runtime = async (generated, source, options) => createRuntime(build(generated, source, options));

// This oracle uses a transitive-closure matrix, not the planner's SCC algorithm.
function closure(graph) {
  const { nodes, edges } = graph;
  const reach = nodes.map((_, i) => nodes.map((_, j) => i === j));
  for (const { from, to } of edges) reach[nodes.indexOf(from)][nodes.indexOf(to)] = true;
  for (let k = 0; k < nodes.length; k++) for (let i = 0; i < nodes.length; i++)
    for (let j = 0; j < nodes.length; j++) reach[i][j] ||= reach[i][k] && reach[k][j];
  return reach;
}

test('exhaustive 4,166 small graphs and 66,067 observation sets agree with independent reachability', () => {
  let graphs = 0, covers = 0;
  for (let n = 0; n <= 4; n++) {
    const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
    const possible = nodes.flatMap(a => nodes.filter(b => b !== a).map(b => edge(a, b)));
    for (let mask = 0; mask < 2 ** possible.length; mask++) {
      const graph = { nodes, edges: possible.filter((_, i) => mask & (1 << i)) };
      const reach = closure(graph), sources = [], assigned = new Set();
      for (let i = 0; i < n; i++) {
        if (assigned.has(i)) continue;
        const group = nodes.map((_, j) => j).filter(j => reach[i][j] && reach[j][i]);
        for (const j of group) assigned.add(j);
        if (nodes.every((_, j) => !reach[j][i] || group.includes(j))) sources.push(group.map(j => nodes[j]));
      }
      const defaultPlan = planReconstruction(graph);
      assert.deepEqual(defaultPlan.sourceComponents, sources);
      assert.deepEqual(defaultPlan.basis, sources.map(group => group[0]));
      assert.equal(defaultPlan.minimumDistance, n ? Math.min(...sources.map(group => group.length)) : null);
      assert.equal(defaultPlan.complete, true);
      // A Boolean-on-one-source/singleton-elsewhere diagram realizes the bound.
      if (n) {
        const smallest = sources.reduce((a, b) => a.length <= b.length ? a : b);
        const inside = new Set(smallest), left = nodes.map(() => 0), right = nodes.map(x => +inside.has(x));
        for (const { from, to } of graph.edges) for (const values of [left, right]) {
          const mapped = inside.has(to) ? values[nodes.indexOf(from)] : 0;
          assert.equal(mapped, values[nodes.indexOf(to)]);
        }
        assert.equal(right.filter((x, i) => x !== left[i]).length, defaultPlan.minimumDistance);
      }
      for (let retained = 0; retained < 2 ** n; retained++) {
        const observed = nodes.filter((_, i) => retained & (1 << i));
        const expected = nodes.filter((_, j) => observed.some(a => reach[nodes.indexOf(a)][j]));
        const plan = planReconstruction(graph, { observed });
        assert.equal(plan.complete, expected.length === n);
        assert.deepEqual(plan.missingComponents, sources.filter(group => !group.some(x => observed.includes(x))));
        const rebuilt = new Set(plan.basis);
        for (const step of plan.steps) {
          assert(rebuilt.has(step.from)); assert(!rebuilt.has(step.to));
          rebuilt.add(step.to);
        }
        assert.deepEqual(nodes.filter(x => rebuilt.has(x)), expected);
        covers++;
      }
      graphs++;
    }
  }
  assert.equal(graphs, 4166); assert.equal(covers, 66067);
});

test('the six-coordinate source components give exact covers, distance, and ordered forests', () => {
  const p = planReconstruction(six, { observed: ['b2', 'a1'] });
  assert.deepEqual(p.sourceComponents, [['a0', 'a1'], ['b0', 'b1', 'b2']]);
  assert.deepEqual(p.basis, ['a1', 'b2']); assert.equal(p.minimumDistance, 2);
  assert.deepEqual(p.steps, [edge('a1', 'a0', 'flip'), edge('b2', 'b0'),
    edge('a0', 'sink', 'zero'), edge('b0', 'b1')]);
  const incomplete = planReconstruction(six, { observed: ['a0', 'sink'] });
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.missingComponents, [['b0', 'b1', 'b2']]);
  assert.throws(() => reconstructionSource('model', six, { observed: ['sink'] }),
    /miss source components: \[a0, a1\]; \[b0, b1, b2\]/);
});

test('self-loops, duplicate arrows, isolates, and empty graphs retain their meanings', async () => {
  const graph = { nodes: ['loop', 'alone'], edges: [edge('loop', 'loop'), edge('loop', 'loop')] };
  assert.deepEqual(planReconstruction(graph).sourceComponents, [['loop'], ['alone']]);
  assert.equal(planReconstruction(graph).minimumDistance, 1);
  const empty = reconstructionSource('empty', { nodes: [], edges: [] });
  assert.equal(empty.plan.minimumDistance, null); assert.deepEqual(empty.plan.basis, []);
  const r = await runtime(empty, `export fn main = () -> do {
    let p = empty {}; {value:p.restore {}, valid:p.check {} {}}
  };`);
  assert.deepEqual(r.call('main', [{}]), { value: {}, valid: true });
});

test('plans own deeply frozen snapshots without freezing or retaining mutable caller records', () => {
  const graph = structuredClone(six), observed = ['a1', 'b2'];
  const p = planReconstruction(graph, { observed }), snapshot = structuredClone(p);
  graph.nodes[0] = 'other'; graph.edges[0].map = 'changed'; observed[0] = 'sink';
  assert.deepEqual(p, snapshot);
  for (const modify of [() => p.basis.push('sink'), () => p.edges[0].map = 'changed',
    () => p.sourceComponents[0].push('sink'), () => p.steps[0].to = 'sink', () => p.complete = false])
    assert.throws(modify, TypeError);
  const generated = reconstructionSource('model', six);
  assert(Object.isFrozen(generated)); assert.equal(generated.name, 'model.generated.ass');
});

test('invalid API shapes, duplicate/unknown names, reserved words, and injection attempts are rejected', () => {
  const graph = { nodes: ['a', 'b'], edges: [edge('a', 'b')] };
  for (const bad of [null, [], 'x', { nodes: [], edges: null }, { nodes: new Array(1), edges: [] },
    { nodes: ['a', 'a'], edges: [] }, { nodes: ['a'], edges: [null] },
    { nodes: ['a'], edges: new Array(1) }, { nodes: ['a'], edges: [edge('a', 'b')] }])
    assert.throws(() => planReconstruction(bad), TypeError);
  for (const name of ['', 'do', 'perform', 'fn', 'a.b', 'a; export fn hacked', 'a\nb', 'x'.repeat(65), 4]) {
    assert.throws(() => reconstructionSource(name, graph), TypeError);
    assert.throws(() => planReconstruction({ nodes: [name], edges: [] }), TypeError);
    assert.throws(() => planReconstruction({ ...graph, edges: [edge('a', 'b', name)] }), TypeError);
  }
  for (const options of [null, [], { observed: 'a' }, { observed: [null] },
    { observed: ['unknown'] }, { observed: ['a', 'a'] }, { observed: ['a', 'b', 'a'] },
    { observed: new Array(1) }]) assert.throws(() => planReconstruction(graph, options), TypeError);
  assert.throws(() => planReconstruction({ nodes: Array(257).fill('a'), edges: [] }), RangeError);
  assert.throws(() => planReconstruction({ nodes: ['a'], edges: Array(2049).fill(edge('a', 'a')) }), RangeError);
});

test('maximum-size chains plan iteratively and maximum-edge checkers compile with bounded nesting', async () => {
  const nodes = Array.from({ length: 256 }, (_, i) => `n${i}`);
  const graph = { nodes, edges: nodes.slice(1).map((x, i) => edge(nodes[i], x)) };
  const generated = reconstructionSource('chain', graph);
  assert.equal(generated.plan.steps.length, 255);
  const r = await runtime(generated, 'export fn main = (x:Num) -> ((chain {id:y -> y}).restore {n0:x}).n255;');
  assert.equal(r.call('main', [42]), 42);
  const dense = reconstructionSource('dense', { nodes: ['a'], edges: Array.from({ length: 2048 }, () => edge('a', 'a')) });
  const checker = await runtime(dense, `${equal} export fn main = (a:Num) -> (dense {id:x -> x}).check {a:equal} {a};`);
  assert.equal(checker.call('main', [3]), true);
  assert.equal(checker.call('main', [NaN]), false);
});

for (const options of modes) test(`cyclic reconstruction erases to handwritten scalar Wasm ${JSON.stringify(options)}`, async () => {
  const generated = reconstructionSource('observations', six, { observed: ['a1', 'b2'] });
  const source = `export fn main = (a:Num) -> (b:Num) -> (observations ${maps}).restore {a1:a,b2:b};`;
  const direct = 'export fn main = (a:Num) -> (b:Num) -> {a0:-a,a1:a,b0:b,b1:b,b2:b,sink:0};';
  const c = build(generated, source, options), handwritten = compile(direct, options);
  assert.deepEqual(c.bytes, handwritten.bytes);
  assert.equal(c.stats.kernelHeapAllocationSites, 0); assert.equal(c.stats.intermediateBufferBytes, 0);
  assert.equal(verifyCertificate(c.certificate.steps), true);
  const r = await createRuntime(c);
  for (let a = -8; a <= 8; a++) assert.deepEqual(r.call('main', [a, 7]),
    { a0: -a, a1: a, b0: 7, b1: 7, b2: 7, sink: 0 });
});

test('restore and explicit all-edge checking work with different coordinate types and lexical captures', async () => {
  const graph = { nodes: ['pair', 'swapped', 'positive'], edges: [edge('pair', 'swapped', 'swap'),
    edge('swapped', 'pair', 'swap'), edge('pair', 'positive', 'above')] };
  const generated = reconstructionSource('model', graph, { observed: ['swapped'] });
  const source = `${equal}
    export fn main = (x:Num) -> (y:Num) -> (threshold:Num) -> do {
      let protocol = model {swap:p -> (p._1,p._0), above:p -> p._0 > threshold};
      let value = protocol.restore {swapped:(y,x)};
      let pair_equal = a -> b -> a._0 == b._0 && a._1 == b._1;
      {value,valid:protocol.check {pair:pair_equal,swapped:pair_equal,positive:a -> b -> if a then b else !b} value}
    };`;
  for (const options of modes) {
    const r = await runtime(generated, source, options);
    assert.deepEqual(r.call('main', [5, 2, 3]), {
      value: { pair: { _0: 5, _1: 2 }, swapped: { _0: 2, _1: 5 }, positive: true }, valid: true,
    });
  }
});

test('the checker catches incompatible cycles and respects exact floating-point equations', async () => {
  const graph = { nodes: ['a', 'b'], edges: [edge('a', 'b', 'up'), edge('b', 'a', 'down')] };
  const generated = reconstructionSource('model', graph);
  const r = await runtime(generated, `${equal} export fn main = (a:Num) -> do {
    let p=model {up:x -> x+1,down:x -> x-1};
    let value=p.restore {a}; {value,valid:p.check {a:equal,b:equal} value}
  };`);
  assert.equal(r.call('main', [3]).valid, true);
  assert.equal(r.call('main', [0.1]).valid, false);
  const impossible = await runtime(generated, `${equal} export fn main = (a:Num) -> do {
    let p=model {up:x -> x+1,down:x -> x+1}; let value=p.restore {a};
    require (p.check {a:equal,b:equal} value) value
  };`);
  assert.throws(() => impossible.call('main', [0]), WebAssembly.RuntimeError);
});

test('non-tree parallel arrows, self-loops, and conflicting observed values are checked', async () => {
  for (const [graph, options, dictionary, seeds, expected] of [
    [{ nodes: ['a', 'b'], edges: [edge('a', 'b', 'up'), edge('a', 'b', 'double')] }, {},
      '{up:x -> x+1,double:x -> x*2}', '{a:3}', false],
    [{ nodes: ['a'], edges: [edge('a', 'a', 'flip')] }, {}, '{flip:x -> -x}', '{a:1}', false],
    [{ nodes: ['a', 'b'], edges: [edge('a', 'b')] }, { observed: ['a', 'b'] }, '{id:x -> x}', '{a:1,b:2}', false],
    [{ nodes: ['a', 'b', 'c'], edges: [edge('a', 'c'), edge('b', 'c')] }, {}, '{id:x -> x}', '{a:1,b:2}', false],
    [{ nodes: ['a', 'b'], edges: [edge('a', 'b')] }, { observed: ['a', 'b'] }, '{id:x -> x}', '{a:2,b:2}', true],
  ]) {
    const generated = reconstructionSource('model', graph, options);
    const same = `{${graph.nodes.map(n => `${n}:equal`).join(',')}}`;
    const r = await runtime(generated, `${equal} export fn main = () -> do {
      let p=model ${dictionary}; p.check ${same} (p.restore ${seeds})
    };`);
    assert.equal(r.call('main', [{}]), expected);
  }
});

test('all-node observations are preserved rather than silently repaired', async () => {
  const graph = { nodes: ['a', 'b'], edges: [edge('a', 'b')] };
  const generated = reconstructionSource('model', graph, { observed: ['b', 'a'] });
  assert.deepEqual(generated.plan.steps, []);
  const r = await runtime(generated, 'export fn main = () -> (model {id:x -> x}).restore {a:1,b:2};');
  assert.deepEqual(r.call('main', [{}]), { a: 1, b: 2 });
});

test('generated field identifiers cannot capture local protocol bindings', async () => {
  const nodes = ['maps', 'seed', 'same', 'value', 'v0'];
  const generated = reconstructionSource('seed', { nodes, edges: nodes.slice(1).map(x => edge('maps', x, 'v0')) });
  const r = await runtime(generated, 'export fn main = () -> (seed {v0:x -> x}).restore {maps:9};');
  assert.deepEqual(r.call('main', [{}]), Object.fromEntries(nodes.map(x => [x, 9])));
});

test('unused restored fields and unchecked constraints do not demand trapping maps', async () => {
  const generated = reconstructionSource('model', { nodes: ['a', 'b', 'c'],
    edges: [edge('a', 'b', 'bad'), edge('a', 'c')] });
  for (const options of modes) {
    const r = await runtime(generated, 'export fn main = (a:Num) -> ((model {bad:x -> require false x,id:x -> x}).restore {a}).c;', options);
    assert.equal(r.call('main', [7]), 7);
    const checked = await runtime(generated, `${equal} export fn main = (a:Num) -> do {
      let p=model {bad:x -> require false x,id:x -> x}; let value=p.restore {a};
      {valid:p.check {b:equal,c:equal} value,value:value.c}.value
    };`, options);
    assert.equal(checked.call('main', [7]), 7);
  }
});

test('balanced checker conjunctions preserve short-circuit guard demand', async () => {
  const generated = reconstructionSource('model', { nodes: ['a', 'b'],
    edges: [edge('a', 'b'), edge('a', 'b', 'bad'), edge('b', 'b', 'bad')] });
  for (const options of modes) {
    const r = await runtime(generated, `${equal} export fn main = () ->
      (model {id:x -> x,bad:x -> require false x}).check {b:equal} {a:1,b:2};`, options);
    assert.equal(r.call('main', [{}]), false);
  }
});

test('maps, comparisons, seeds, and protocol ABI escapes remain checked by the existing pipeline', () => {
  const generated = reconstructionSource('model', { nodes: ['a', 'b'], edges: [edge('a', 'b')] });
  for (const [source, code] of [
    ['export fn main = () -> (model {}).restore {a:1};', 'E_TYPE'],
    ['export fn main = () -> (model {id:x -> x}).restore {b:1};', 'E_TYPE'],
    ['export fn main = () -> (model {id:x -> x}).check {b:x -> y -> x+y} {a:1,b:1};', 'E_TYPE'],
    ['export fn main = () -> model {id:x -> x};', 'E_ABI'],
    ['host fn audit:Num -> Num; export fn main = (a:Num) -> ((model {id:audit}).restore {a}).b;', 'E_EFFECT'],
  ]) assert.throws(() => build(generated, source), e => e.code === code, source);
});

test('source-local diagnostics survive composition, and generated-name collisions are ordinary errors', () => {
  const generated = reconstructionSource('model', { nodes: ['a', 'b'], edges: [edge('a', 'b')] });
  const source = '// local diagnostic\nexport fn main = () -> (model {id:x -> unknown x}).restore {a:1};';
  assert.throws(() => build(generated, source), e => e.code === 'E_NAME' &&
    e.sourceName === 'app.ass' && e.offset === source.indexOf('unknown'));
  assert.throws(() => build(generated, 'fn model = x -> x; export fn main = () -> 1;'), e => e.code === 'E_NAME');
});

test('reconstructed streams retain provenance, guards, and causal access restrictions', async () => {
  const generated = reconstructionSource('model', { nodes: ['xs', 'prefix'], edges: [edge('xs', 'prefix', 'scan')] });
  const protocol = 'model {scan:xs -> scan xs 0 (s -> x -> s+x)}';
  for (const options of modes) {
    const c = build(generated, `export fn main = (xs:[Num]) -> do {
      let values=(${protocol}).restore {xs}; zip values.xs values.prefix (x -> total -> x+total)
    };`, options);
    assert.equal(verifyCertificate(c.certificate.steps), true);
    assert.equal(c.observations.main.access, 'sequential');
    const r = await createRuntime(c);
    assert.deepEqual(Array.from(r.call('main', [[1, 2, 3]])), [2, 5, 9]);
    assert.deepEqual(Array.from(r.call('main', [[]])), []);
    assert.throws(() => build(generated, `export fn main = (xs:[Num]) -> at ((${protocol}).restore {xs}).prefix 1;`, options), e => e.code === 'E_CAUSAL_ACCESS');
  }
  const independent = reconstructionSource('separate', { nodes: ['a', 'b'], edges: [] });
  assert.throws(() => build(independent, `export fn main = (a:[Num]) -> (b:[Num]) -> do {
    let v=(separate {}).restore {a,b}; zip v.a v.b (x -> y -> x+y)
  };`), e => e.code === 'E_DOMAIN');
});


test('checking also requires isolated coordinates, without demanding their pure values', async () => {
  const generated = reconstructionSource('model', { nodes: ['a', 'b', 'alone'], edges: [edge('a', 'b')] });
  assert.throws(() => build(generated, `${equal} export fn main = () ->
    (model {id:x -> x}).check {b:equal} {a:1,b:1};`), e => e.code === 'E_TYPE');
  const r = await runtime(generated, `${equal} export fn main = () ->
    (model {id:x -> x}).check {b:equal} {a:1,b:1,alone:require false 3};`);
  assert.equal(r.call('main', [{}]), true);
});
